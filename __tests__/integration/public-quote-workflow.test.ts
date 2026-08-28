import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  getPublicQuoteRequest,
  submitPublicSupplierQuote,
} from '@/lib/quotes/public-quote-service';
import { digestOpaqueToken } from '@/lib/security/tokens';

import { withMigratedPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

const token = 'Q'.repeat(43);

function submission(expectedLatestRevision: number, freightInr = '450') {
  return {
    expectedLatestRevision,
    deliveryDate: '2099-09-02',
    validUntil: '2099-09-01',
    freightInr,
    commercialTerms: 'Payment within 15 days',
    notes: 'Deliver before 8 AM',
    items: [
      {
        requestItemId: 'quote-item-tomato',
        noQuote: false,
        availableQuantity: '100',
        unitRateInr: '42',
        gstPercent: '5',
        taxInclusive: false,
        substitution: null,
      },
      {
        requestItemId: 'quote-item-paneer',
        noQuote: false,
        availableQuantity: '25.5',
        unitRateInr: '320',
        gstPercent: '5',
        taxInclusive: true,
        substitution: 'Fresh paneer, 1 kg packs',
      },
      { requestItemId: 'quote-item-mint', noQuote: true },
    ],
  };
}

test('public supplier quote workflow is tenant-safe, calculated, immutable, and revision-locked', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = randomBytes(24).toString('hex');
    let app: PrismaClient | undefined;

    try {
      await admin.tenant.create({
        data: {
          id: 'quote-tenant',
          name: 'Monsoon Table Pune',
          addressLine: '18 Koregaon Park Road',
          city: 'Pune',
          state: 'Maharashtra',
          pin: '411001',
          phone: '9000000000',
          users: {
            create: {
              id: 'quote-owner',
              name: 'Ananya Rao',
              email: 'quote-owner@example.test',
              role: 'OWNER',
            },
          },
          suppliers: {
            create: {
              id: 'quote-supplier',
              businessName: 'Shakti Fresh Foods',
            },
          },
          procurementRequests: {
            create: {
              id: 'quote-request',
              title: 'Weekly vegetables and dairy',
              status: 'OPEN',
              openedAt: new Date('2026-08-28T10:00:00.000Z'),
              deliveryDetails: {
                addressLine: '18 Koregaon Park Road',
                city: 'Pune',
                state: 'Maharashtra',
                pin: '411001',
                instructions: 'Use the service entrance',
              },
              deliveryDate: new Date('2099-09-02T00:00:00.000Z'),
              quoteDeadline: new Date('2099-09-01T00:00:00.000Z'),
              commercialTerms: 'Rates must include packing.',
              createdByUserId: 'quote-owner',
              items: {
                create: [
                  {
                    id: 'quote-item-tomato',
                    name: 'Tomato',
                    quantity: '100',
                    unit: 'KILOGRAM',
                  },
                  {
                    id: 'quote-item-paneer',
                    name: 'Paneer',
                    quantity: '25.5',
                    unit: 'KILOGRAM',
                  },
                  {
                    id: 'quote-item-mint',
                    name: 'Mint',
                    quantity: '10',
                    unit: 'KILOGRAM',
                  },
                ],
              },
            },
          },
        },
      });
      await admin.supplierRequest.create({
        data: {
          id: 'quote-supplier-request',
          tenantId: 'quote-tenant',
          requestId: 'quote-request',
          supplierId: 'quote-supplier',
          tokenDigest: digestOpaqueToken('supplier-request', token),
          expiresAt: new Date('2099-09-01T00:00:00.000Z'),
        },
      });
      await admin.$executeRawUnsafe(
        `ALTER ROLE autorfp_app PASSWORD '${password}'`,
      );
      app = new PrismaClient({
        datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
      });
      await app.$connect();

      await expect(getPublicQuoteRequest({ token }, app)).resolves.toEqual(
        expect.objectContaining({
          restaurantName: 'Monsoon Table Pune',
          supplierName: 'Shakti Fresh Foods',
          title: 'Weekly vegetables and dairy',
          deliveryDate: '2099-09-02',
          quoteDeadline: '2099-09-01T00:00:00.000Z',
          latestQuote: null,
          items: expect.arrayContaining([
            expect.objectContaining({ id: 'quote-item-tomato', quantity: '100' }),
            expect.objectContaining({ id: 'quote-item-paneer', quantity: '25.5' }),
            expect.objectContaining({ id: 'quote-item-mint', quantity: '10' }),
          ]),
        }),
      );
      expect(await admin.rateLimitBucket.count()).toBe(1);
      expect(await admin.rateLimitBucket.findFirst()).toEqual(
        expect.objectContaining({ count: 1 }),
      );

      const [first, raced] = await Promise.allSettled([
        submitPublicSupplierQuote({ token, quote: submission(0) }, app),
        submitPublicSupplierQuote({ token, quote: submission(0, '500') }, app),
      ]);
      expect([first, raced].filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect([first, raced].filter(({ status }) => status === 'rejected')).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ code: 'QUOTE_REVISION_CONFLICT', status: 409 }),
        }),
      ]);

      const storedFirst = await admin.supplierQuote.findFirstOrThrow({
        where: { supplierRequestId: 'quote-supplier-request' },
        include: { items: { orderBy: { requestItemId: 'asc' } } },
      });
      expect(storedFirst.revision).toBe(1);
      expect([BigInt(1_302_000), BigInt(1_307_000)]).toContain(
        storedFirst.totalPaise,
      );
      expect(storedFirst.items).toHaveLength(3);
      expect(storedFirst.items.find(({ requestItemId }) => requestItemId === 'quote-item-mint')).toEqual(
        expect.objectContaining({
          noQuote: true,
          availableQuantity: null,
          unitRatePaise: null,
          gstBasisPoints: null,
          subtotalPaise: BigInt(0),
          gstPaise: BigInt(0),
          totalPaise: BigInt(0),
        }),
      );

      const second = await submitPublicSupplierQuote(
        { token, quote: submission(1, '600') },
        app,
      );
      expect(second).toEqual(
        expect.objectContaining({ revision: 2, totalPaise: '1317000' }),
      );
      const quotes = await admin.supplierQuote.findMany({
        where: { supplierRequestId: 'quote-supplier-request' },
        orderBy: { revision: 'asc' },
      });
      expect(quotes.map(({ revision }) => revision)).toEqual([1, 2]);
      expect(quotes[0]!.totalPaise).toBe(storedFirst.totalPaise);

      const latest = await getPublicQuoteRequest({ token }, app);
      expect(latest.latestQuote).toEqual(
        expect.objectContaining({ revision: 2, totalPaise: '1317000' }),
      );
      expect(await admin.auditEvent.findMany({
        where: { action: 'quote.submitted' },
        orderBy: { createdAt: 'asc' },
        select: { actorUserId: true, entityType: true, metadata: true },
      })).toEqual([
        {
          actorUserId: null,
          entityType: 'SupplierQuote',
          metadata: { revision: 1, itemCount: 3 },
        },
        {
          actorUserId: null,
          entityType: 'SupplierQuote',
          metadata: { revision: 2, itemCount: 3 },
        },
      ]);

      await admin.$executeRaw`
        UPDATE "ProcurementRequest"
        SET "quoteDeadline" = pg_catalog.clock_timestamp() + INTERVAL '1500 milliseconds'
        WHERE "tenantId" = 'quote-tenant' AND "id" = 'quote-request'
      `;
      await admin.$executeRaw`
        UPDATE "SupplierRequest"
        SET "expiresAt" = pg_catalog.clock_timestamp() + INTERVAL '1500 milliseconds'
        WHERE "tenantId" = 'quote-tenant' AND "id" = 'quote-supplier-request'
      `;
      let releaseRequestLock!: () => void;
      let reportRequestLocked!: () => void;
      const releaseRequest = new Promise<void>((resolve) => {
        releaseRequestLock = resolve;
      });
      const requestLocked = new Promise<void>((resolve) => {
        reportRequestLocked = resolve;
      });
      const lockHolder = admin.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "ProcurementRequest"
          WHERE "tenantId" = 'quote-tenant' AND "id" = 'quote-request'
          FOR UPDATE
        `;
        reportRequestLocked();
        await releaseRequest;
      });
      await requestLocked;
      const afterDeadline = getPublicQuoteRequest({ token }, app);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      releaseRequestLock();
      await lockHolder;
      await expect(afterDeadline).rejects.toMatchObject({
        code: 'PUBLIC_QUOTE_UNAVAILABLE',
        status: 410,
      });

      await admin.procurementRequest.update({
        where: { tenantId_id: { tenantId: 'quote-tenant', id: 'quote-request' } },
        data: { quoteDeadline: new Date('2099-09-01T00:00:00.000Z') },
      });
      await admin.supplierRequest.update({
        where: {
          tenantId_id: {
            tenantId: 'quote-tenant',
            id: 'quote-supplier-request',
          },
        },
        data: { expiresAt: new Date('2099-09-01T00:00:00.000Z') },
      });

      await admin.procurementRequest.create({
        data: {
          id: 'quote-request-maximum',
          tenantId: 'quote-tenant',
          title: 'Maximum supported request',
          status: 'OPEN',
          openedAt: new Date('2026-08-28T10:00:00.000Z'),
          deliveryDetails: { addressLine: '18 Koregaon Park Road' },
          deliveryDate: new Date('2099-09-02T00:00:00.000Z'),
          quoteDeadline: new Date('2099-09-01T00:00:00.000Z'),
          createdByUserId: 'quote-owner',
        },
      });
      await admin.requestItem.createMany({
        data: Array.from({ length: 250 }, (_, index) => ({
          id: `maximum-item-${String(index).padStart(4, '0')}`,
          tenantId: 'quote-tenant',
          requestId: 'quote-request-maximum',
          name: `Ingredient ${index + 1}`,
          quantity: '1',
          unit: 'KILOGRAM' as const,
        })),
      });
      const maximumToken = 'M'.repeat(43);
      await admin.supplierRequest.create({
        data: {
          id: 'quote-supplier-request-maximum',
          tenantId: 'quote-tenant',
          requestId: 'quote-request-maximum',
          supplierId: 'quote-supplier',
          tokenDigest: digestOpaqueToken('supplier-request', maximumToken),
          expiresAt: new Date('2099-09-01T00:00:00.000Z'),
        },
      });
      await expect(
        submitPublicSupplierQuote(
          {
            token: maximumToken,
            quote: {
              expectedLatestRevision: 0,
              deliveryDate: '2099-09-02',
              validUntil: '2099-09-01',
              freightInr: '0',
              commercialTerms: null,
              notes: null,
              items: Array.from({ length: 250 }, (_, index) => ({
                requestItemId: `maximum-item-${String(index).padStart(4, '0')}`,
                noQuote: true,
              })),
            },
          },
          app,
        ),
      ).resolves.toEqual(expect.objectContaining({ revision: 1, totalPaise: '0' }));
      expect(
        await admin.supplierQuoteItem.count({
          where: { tenantId: 'quote-tenant', quote: { supplierRequestId: 'quote-supplier-request-maximum' } },
        }),
      ).toBe(250);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
