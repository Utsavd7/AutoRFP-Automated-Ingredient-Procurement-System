import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import {
  createPrismaPublicSupplierApplicationGrantRepository,
  exchangeSupplierApplicationGrantToken,
} from '@/lib/security/public-grant';
import { digestOpaqueToken } from '@/lib/security/tokens';
import {
  submitPublicSupplierApplication,
} from '@/lib/suppliers/public-application-service';
import {
  decideSupplierVerification,
  SupplierNotFoundError,
  SupplierVerificationConflictError,
} from '@/lib/suppliers/supplier-service';

import { withMigratedPostgres } from './setup/postgres';

const applicationToken = 'A'.repeat(43);
const firstQuoteToken = 'Q'.repeat(43);
const concurrentQuoteToken = 'R'.repeat(43);
const submittedAt = new Date('2027-01-08T09:00:00.000Z');
const quoteDeadline = new Date('2099-09-01T00:00:00.000Z');

const items = {
  v: 1,
  items: [
    {
      id: 'item-1',
      itemKey: 'tomato',
      name: 'Tomato',
      quantity: '10',
      unit: 'KILOGRAM',
      specification: { v: 1, category: 'VEGETABLES' },
      sourcingOverride: null,
    },
  ],
};

const sourcing = {
  v: 1,
  default: {
    v: 1,
    modes: ['VERIFIED_NEW'],
    currentSupplierIds: [],
    selectedNewSupplierIds: [],
    acceptVerifiedApplications: true,
  },
};

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

function quoteTokenFactory(raw: string) {
  return () => ({
    raw,
    digest: digestOpaqueToken('supplier-request', raw),
  });
}

test('restricted application grant creates and atomically decides isolated applicants', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = randomBytes(24).toString('hex');
    let app: PrismaClient | undefined;

    try {
      await admin.tenant.create({
        data: {
          id: 'application-tenant-a',
          name: 'Application Kitchen A',
          addressLine: '1 Market Road',
          city: 'Pune',
          state: 'Maharashtra',
          pin: '411001',
          phone: '9000000000',
          users: {
            create: [
              {
                id: 'application-owner-a',
                name: 'Owner A',
                email: 'application-owner-a@example.test',
                role: 'OWNER',
              },
              {
                id: 'application-member-a',
                name: 'Member A',
                email: 'application-member-a@example.test',
                role: 'MEMBER',
              },
            ],
          },
          procurementRequests: {
            create: {
              id: 'application-request-a',
              title: 'Verified new produce',
              status: 'OPEN',
              items,
              sourcing,
              deliveryDetails: { addressLine: '1 Market Road' },
              deliveryDate: new Date('2099-09-02T00:00:00.000Z'),
              quoteDeadline,
              applicationTokenDigest: digestOpaqueToken(
                'supplier-application',
                applicationToken,
              ),
              applicationExpiresAt: quoteDeadline,
              openedAt: new Date('2027-01-08T08:00:00.000Z'),
              createdByUserId: 'application-owner-a',
            },
          },
        },
      });
      await admin.tenant.create({
        data: {
          id: 'application-tenant-b',
          name: 'Application Kitchen B',
          addressLine: '2 Market Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pin: '400001',
          phone: '9000000001',
          users: {
            create: {
              id: 'application-owner-b',
              name: 'Owner B',
              email: 'application-owner-b@example.test',
              role: 'OWNER',
            },
          },
        },
      });

      await admin.$executeRawUnsafe(
        `ALTER ROLE autorfp_app PASSWORD '${password}'`,
      );
      app = new PrismaClient({
        datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
      });
      await app.$connect();

      const repository =
        createPrismaPublicSupplierApplicationGrantRepository(app);
      const exchange = (input: { token: unknown; now: Date }) =>
        exchangeSupplierApplicationGrantToken(input, repository);

      await expect(exchange({ token: applicationToken, now: submittedAt }))
        .resolves.toEqual({
          tenantId: 'application-tenant-a',
          requestId: 'application-request-a',
        });
      await expect(app.procurementRequest.findMany()).resolves.toEqual([]);

      const submit = (input: {
        businessName: string;
        phone: string;
        categories?: string[];
      }) => submitPublicSupplierApplication(
        {
          application: {
            token: applicationToken,
            businessName: input.businessName,
            phone: input.phone,
            categories: input.categories ?? ['VEGETABLES'],
          },
          now: submittedAt,
        },
        app!,
        { exchange },
      );

      await expect(submit({
        businessName: 'Primary Applicant',
        phone: '9876500001',
        categories: ['FRUITS', 'VEGETABLES'],
      })).resolves.toEqual({ accepted: true });
      await expect(submit({
        businessName: 'Duplicate Attempt',
        phone: '+91 98765 00001',
      })).resolves.toEqual({ accepted: true });

      const primary = await admin.supplier.findFirstOrThrow({
        where: {
          tenantId: 'application-tenant-a',
          phone: '+919876500001',
        },
      });
      expect(primary).toEqual(expect.objectContaining({
        relationshipType: 'APPLICANT',
        verificationStatus: 'PENDING',
        applicationRequestId: 'application-request-a',
        isActive: false,
        verifiedAt: null,
        verifiedByUserId: null,
        capabilities: {
          v: 1,
          categories: [
            { category: 'VEGETABLES', tier: 'BACKUP', rank: 1 },
            { category: 'FRUITS', tier: 'BACKUP', rank: 2 },
          ],
          items: [],
        },
      }));
      expect(await admin.supplier.count({
        where: { tenantId: 'application-tenant-a', phone: '+919876500001' },
      })).toBe(1);

      await expect(decideSupplierVerification(
        {
          actor: {
            tenantId: 'application-tenant-a',
            userId: 'application-member-a',
          },
          supplierId: primary.id,
          decision: 'APPROVE',
        },
        app,
      )).rejects.toBeInstanceOf(AuthorizationError);
      await expect(decideSupplierVerification(
        {
          actor: {
            tenantId: 'application-tenant-b',
            userId: 'application-owner-b',
          },
          supplierId: primary.id,
          decision: 'APPROVE',
        },
        app,
      )).rejects.toBeInstanceOf(SupplierNotFoundError);

      const approved = await decideSupplierVerification(
        {
          actor: {
            tenantId: 'application-tenant-a',
            userId: 'application-owner-a',
          },
          supplierId: primary.id,
          decision: 'APPROVE',
        },
        app,
        {
          tokenFactory: quoteTokenFactory(firstQuoteToken),
          shareBaseUrl: 'https://quoteplate.example',
        },
      );
      expect(approved).toEqual({
        supplier: expect.objectContaining({
          id: primary.id,
          relationshipType: 'SELECTED_NEW',
          verificationStatus: 'VERIFIED',
          isActive: true,
          verifiedByUserId: 'application-owner-a',
          verifiedAt: expect.any(Date),
        }),
        supplierRequest: expect.objectContaining({
          requestId: 'application-request-a',
          supplierId: primary.id,
          quoteRevision: 0,
        }),
        link: expect.objectContaining({
          url: `https://quoteplate.example/quote#token=${firstQuoteToken}`,
        }),
      });
      if (!approved.link) throw new Error('Approval did not return its one-time link.');
      expect(new Date(approved.link.expiresAt).getTime())
        .toBeLessThanOrEqual(quoteDeadline.getTime());
      expect(await admin.supplierRequest.count({
        where: { requestId: 'application-request-a', supplierId: primary.id },
      })).toBe(1);
      const storedPrimaryGrant = await admin.supplierRequest.findFirstOrThrow({
        where: { requestId: 'application-request-a', supplierId: primary.id },
      });
      expect(storedPrimaryGrant).toEqual(expect.objectContaining({
        tokenDigest: digestOpaqueToken('supplier-request', firstQuoteToken),
        quoteRevision: 0,
        quoteRevisions: { v: 1, revisions: [] },
      }));
      await expect(decideSupplierVerification(
        {
          actor: {
            tenantId: 'application-tenant-a',
            userId: 'application-owner-a',
          },
          supplierId: primary.id,
          decision: 'REJECT',
        },
        app,
      )).rejects.toBeInstanceOf(SupplierVerificationConflictError);
      expect(await admin.supplierRequest.count({
        where: { requestId: 'application-request-a', supplierId: primary.id },
      })).toBe(1);

      await submit({ businessName: 'Collision Applicant', phone: '9876500002' });
      const collision = await admin.supplier.findFirstOrThrow({
        where: { tenantId: 'application-tenant-a', phone: '+919876500002' },
      });
      await expect(decideSupplierVerification(
        {
          actor: {
            tenantId: 'application-tenant-a',
            userId: 'application-owner-a',
          },
          supplierId: collision.id,
          decision: 'APPROVE',
        },
        app,
        {
          tokenFactory: quoteTokenFactory(firstQuoteToken),
          shareBaseUrl: 'https://quoteplate.example',
        },
      )).rejects.toMatchObject({ code: 'P2002' });
      expect(await admin.supplier.findUniqueOrThrow({ where: { id: collision.id } }))
        .toEqual(expect.objectContaining({
          relationshipType: 'APPLICANT',
          verificationStatus: 'PENDING',
          isActive: false,
        }));
      expect(await admin.supplierRequest.count({
        where: { supplierId: collision.id },
      })).toBe(0);

      await submit({ businessName: 'Concurrent Applicant', phone: '9876500003' });
      const concurrent = await admin.supplier.findFirstOrThrow({
        where: { tenantId: 'application-tenant-a', phone: '+919876500003' },
      });
      const concurrentDecisions = await Promise.allSettled([
        decideSupplierVerification(
          {
            actor: {
              tenantId: 'application-tenant-a',
              userId: 'application-owner-a',
            },
            supplierId: concurrent.id,
            decision: 'APPROVE',
          },
          app,
          {
            tokenFactory: quoteTokenFactory(concurrentQuoteToken),
            shareBaseUrl: 'https://quoteplate.example',
          },
        ),
        decideSupplierVerification(
          {
            actor: {
              tenantId: 'application-tenant-a',
              userId: 'application-owner-a',
            },
            supplierId: concurrent.id,
            decision: 'REJECT',
          },
          app,
        ),
      ]);
      expect(concurrentDecisions.filter(({ status }) => status === 'fulfilled'))
        .toHaveLength(1);
      expect(concurrentDecisions.filter(({ status }) => status === 'rejected'))
        .toEqual([
          expect.objectContaining({
            reason: expect.any(SupplierVerificationConflictError),
          }),
        ]);
      expect(await admin.supplierRequest.count({
        where: { supplierId: concurrent.id },
      })).toBeLessThanOrEqual(1);
      expect(await admin.auditEvent.count({
        where: {
          entityId: concurrent.id,
          action: { in: ['supplier.verified', 'supplier.rejected'] },
        },
      })).toBe(1);

      await submit({ businessName: 'Close Race Applicant', phone: '9876500004' });
      const closeRace = await admin.supplier.findFirstOrThrow({
        where: { tenantId: 'application-tenant-a', phone: '+919876500004' },
      });
      let releaseRequestLock!: () => void;
      let reportRequestLocked!: () => void;
      const releaseRequest = new Promise<void>((resolve) => {
        releaseRequestLock = resolve;
      });
      const requestLocked = new Promise<void>((resolve) => {
        reportRequestLocked = resolve;
      });
      const closeRequest = admin.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "ProcurementRequest"
          WHERE "tenantId" = 'application-tenant-a'
            AND "id" = 'application-request-a'
          FOR UPDATE
        `;
        await transaction.procurementRequest.update({
          where: {
            tenantId_id: {
              tenantId: 'application-tenant-a',
              id: 'application-request-a',
            },
          },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            applicationRevokedAt: new Date(),
          },
        });
        reportRequestLocked();
        await releaseRequest;
      });
      await requestLocked;
      const racedApproval = decideSupplierVerification(
        {
          actor: {
            tenantId: 'application-tenant-a',
            userId: 'application-owner-a',
          },
          supplierId: closeRace.id,
          decision: 'APPROVE',
        },
        app,
        {
          tokenFactory: quoteTokenFactory('S'.repeat(43)),
          shareBaseUrl: 'https://quoteplate.example',
        },
      );
      releaseRequestLock();
      await closeRequest;
      await expect(racedApproval).rejects.toBeInstanceOf(
        SupplierVerificationConflictError,
      );
      expect(await admin.supplier.findUniqueOrThrow({ where: { id: closeRace.id } }))
        .toEqual(expect.objectContaining({
          relationshipType: 'APPLICANT',
          verificationStatus: 'PENDING',
          isActive: false,
        }));
      expect(await admin.supplierRequest.count({
        where: { supplierId: closeRace.id },
      })).toBe(0);

      await expect(exchange({ token: applicationToken, now: submittedAt }))
        .rejects.toMatchObject({ code: 'GRANT_UNAVAILABLE', status: 410 });
      expect(await admin.rateLimitBucket.count()).toBe(1);
      expect(await admin.auditEvent.findMany({
        where: { action: 'supplier.applied' },
        orderBy: { createdAt: 'asc' },
        select: { actorUserId: true, entityType: true, metadata: true },
      })).toEqual([
        {
          actorUserId: null,
          entityType: 'Supplier',
          metadata: { requestId: 'application-request-a', categoryCount: 2 },
        },
        ...Array.from({ length: 3 }, () => ({
          actorUserId: null,
          entityType: 'Supplier',
          metadata: { requestId: 'application-request-a', categoryCount: 1 },
        })),
      ]);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
