import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  AwardConflictError,
  createAward,
} from '@/lib/awards/award-service';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  getQuoteComparison,
  QuoteComparisonNotFoundError,
} from '@/lib/comparison/compare-quotes';
import {
  PublicQuoteUnavailableError,
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

async function provisionAppClient(admin: PrismaClient, databaseUrl: string) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
  const client = new PrismaClient({
    datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
  });
  await client.$connect();
  return client;
}

function namedAppDatabaseUrl(databaseUrl: string, password: string, name: string) {
  const url = new URL(appDatabaseUrl(databaseUrl, password));
  url.searchParams.set('application_name', name);
  return url.toString();
}

async function waitForDatabaseLock(admin: PrismaClient, applicationName: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const waiting = await admin.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_stat_activity
        WHERE application_name = ${applicationName}
          AND wait_event_type = 'Lock'
      ) AS "waiting"
    `;
    if (waiting[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${applicationName} did not reach the expected row lock.`);
}

async function seedTenant(
  admin: PrismaClient,
  input: {
    tenantId: string;
    ownerId: string;
    ownerEmail: string;
    memberId?: string;
    memberEmail?: string;
  },
) {
  await admin.tenant.create({
    data: {
      id: input.tenantId,
      name: `${input.tenantId} Restaurant`,
      addressLine: '12, 100 Feet Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin: '560038',
      phone: '9000000000',
      users: {
        create: [
          {
            id: input.ownerId,
            name: `${input.ownerId} Owner`,
            email: input.ownerEmail,
            role: 'OWNER',
          },
          ...(input.memberId && input.memberEmail
            ? [
                {
                  id: input.memberId,
                  name: `${input.memberId} Member`,
                  email: input.memberEmail,
                  role: 'MEMBER' as const,
                },
              ]
            : []),
        ],
      },
    },
  });
}

type SeedQuoteOptions = {
  expired?: boolean;
  includeHistoricalRevision?: boolean;
};

async function seedOpenRequest(
  admin: PrismaClient,
  input: {
    requestId: string;
    tenantId: string;
    ownerId: string;
    supplierAId: string;
    supplierBId: string;
    options?: SeedQuoteOptions;
  },
) {
  const tomatoId = `${input.requestId}-tomato`;
  const corianderId = `${input.requestId}-coriander`;
  const grantAId = `${input.requestId}-grant-a`;
  const grantBId = `${input.requestId}-grant-b`;
  await admin.procurementRequest.create({
    data: {
      id: input.requestId,
      title: `${input.requestId} weekly produce`,
      status: 'OPEN',
      version: 2,
      deliveryDetails: {
        addressLine: '12, 100 Feet Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pin: '560038',
      },
      deliveryDate: new Date('2099-01-10T00:00:00.000Z'),
      quoteDeadline: new Date('2099-01-09T10:00:00.000Z'),
      commercialTerms: 'Payment in 15 days.',
      openedAt: new Date('2099-01-01T09:00:00.000Z'),
      tenant: { connect: { id: input.tenantId } },
      createdBy: {
        connect: {
          tenantId_id: { tenantId: input.tenantId, id: input.ownerId },
        },
      },
      items: {
        create: [
          {
            id: tomatoId,
            name: 'Tomato',
            quantity: '100',
            unit: 'KILOGRAM',
            tenant: { connect: { id: input.tenantId } },
          },
          {
            id: corianderId,
            name: 'Coriander',
            quantity: '10',
            unit: 'KILOGRAM',
            tenant: { connect: { id: input.tenantId } },
          },
        ],
      },
    },
  });
  await admin.supplierRequest.createMany({
    data: [
      {
        id: grantAId,
        tenantId: input.tenantId,
        requestId: input.requestId,
        supplierId: input.supplierAId,
        tokenDigest: createHash('sha256').update(grantAId).digest('hex'),
        expiresAt: new Date('2099-01-09T10:00:00.000Z'),
      },
      {
        id: grantBId,
        tenantId: input.tenantId,
        requestId: input.requestId,
        supplierId: input.supplierBId,
        tokenDigest: createHash('sha256').update(grantBId).digest('hex'),
        expiresAt: new Date('2099-01-09T10:00:00.000Z'),
      },
    ],
  });

  let staleQuoteId: string | null = null;
  let staleTomatoQuoteItemId: string | null = null;
  if (input.options?.includeHistoricalRevision) {
    const stale = await admin.supplierQuote.create({
      data: {
        id: `${input.requestId}-quote-a-r1`,
        tenantId: input.tenantId,
        supplierRequestId: grantAId,
        revision: 1,
        subtotalPaise: BigInt(8_000_000),
        gstPaise: BigInt(400_000),
        freightPaise: BigInt(50_000),
        totalPaise: BigInt(8_450_000),
        deliveryDate: new Date('2099-01-10T00:00:00.000Z'),
        validUntil: new Date('2099-01-11T00:00:00.000Z'),
        commercialTerms: 'Old revision.',
      },
    });
    staleQuoteId = stale.id;
    staleTomatoQuoteItemId = `${input.requestId}-quote-a-r1-tomato`;
    await admin.supplierQuoteItem.createMany({
      data: [
        {
          id: staleTomatoQuoteItemId,
          tenantId: input.tenantId,
          quoteId: stale.id,
          requestItemId: tomatoId,
          noQuote: false,
          availableQuantity: '100',
          unit: 'KILOGRAM',
          unitRatePaise: BigInt(710_00),
          gstBasisPoints: 500,
          subtotalPaise: BigInt(7_100_000),
          gstPaise: BigInt(355_000),
          totalPaise: BigInt(7_455_000),
        },
        {
          id: `${input.requestId}-quote-a-r1-coriander`,
          tenantId: input.tenantId,
          quoteId: stale.id,
          requestItemId: corianderId,
          noQuote: false,
          availableQuantity: '10',
          unit: 'KILOGRAM',
          unitRatePaise: BigInt(900_00),
          gstBasisPoints: 500,
          subtotalPaise: BigInt(900_000),
          gstPaise: BigInt(45_000),
          totalPaise: BigInt(945_000),
        },
      ],
    });
  }

  const quoteA = await admin.supplierQuote.create({
    data: {
      id: `${input.requestId}-quote-a-latest`,
      tenantId: input.tenantId,
      supplierRequestId: grantAId,
      revision: input.options?.includeHistoricalRevision ? 2 : 1,
      subtotalPaise: BigInt(7_900_000),
      gstPaise: BigInt(395_000),
      freightPaise: BigInt(50_000),
      totalPaise: BigInt(8_345_000),
      deliveryDate: new Date('2099-01-10T00:00:00.000Z'),
      validUntil: input.options?.expired
        ? new Date('2026-08-20T00:00:00.000Z')
        : new Date('2099-01-11T00:00:00.000Z'),
      submittedAt: input.options?.expired
        ? new Date('2026-08-01T00:00:00.000Z')
        : new Date('2099-01-02T00:00:00.000Z'),
      commercialTerms: 'Payment in 15 days.',
      notes: 'Grade A produce.',
    },
  });
  const quoteATomatoItemId = `${input.requestId}-quote-a-tomato`;
  const quoteACorianderItemId = `${input.requestId}-quote-a-coriander`;
  await admin.supplierQuoteItem.createMany({
    data: [
      {
        id: quoteATomatoItemId,
        tenantId: input.tenantId,
        quoteId: quoteA.id,
        requestItemId: tomatoId,
        noQuote: false,
        availableQuantity: '100',
        unit: 'KILOGRAM',
        unitRatePaise: BigInt(700_00),
        gstBasisPoints: 500,
        subtotalPaise: BigInt(7_000_000),
        gstPaise: BigInt(350_000),
        totalPaise: BigInt(7_350_000),
      },
      {
        id: quoteACorianderItemId,
        tenantId: input.tenantId,
        quoteId: quoteA.id,
        requestItemId: corianderId,
        noQuote: false,
        availableQuantity: '10',
        unit: 'KILOGRAM',
        unitRatePaise: BigInt(900_00),
        gstBasisPoints: 500,
        subtotalPaise: BigInt(900_000),
        gstPaise: BigInt(45_000),
        totalPaise: BigInt(945_000),
      },
    ],
  });

  const quoteB = await admin.supplierQuote.create({
    data: {
      id: `${input.requestId}-quote-b-latest`,
      tenantId: input.tenantId,
      supplierRequestId: grantBId,
      revision: 1,
      subtotalPaise: BigInt(3_670_000),
      gstPaise: BigInt(183_500),
      freightPaise: BigInt(25_000),
      totalPaise: BigInt(3_878_500),
      deliveryDate: new Date('2099-01-09T00:00:00.000Z'),
      validUntil: input.options?.expired
        ? new Date('2026-08-20T00:00:00.000Z')
        : new Date('2099-01-11T00:00:00.000Z'),
      submittedAt: input.options?.expired
        ? new Date('2026-08-01T00:00:00.000Z')
        : new Date('2099-01-02T00:00:00.000Z'),
      commercialTerms: 'Payment in 7 days.',
    },
  });
  const quoteBTomatoItemId = `${input.requestId}-quote-b-tomato`;
  const quoteBCorianderItemId = `${input.requestId}-quote-b-coriander`;
  await admin.supplierQuoteItem.createMany({
    data: [
      {
        id: quoteBTomatoItemId,
        tenantId: input.tenantId,
        quoteId: quoteB.id,
        requestItemId: tomatoId,
        noQuote: false,
        availableQuantity: '40',
        unit: 'KILOGRAM',
        unitRatePaise: BigInt(680_00),
        gstBasisPoints: 500,
        subtotalPaise: BigInt(2_720_000),
        gstPaise: BigInt(136_000),
        totalPaise: BigInt(2_856_000),
      },
      {
        id: quoteBCorianderItemId,
        tenantId: input.tenantId,
        quoteId: quoteB.id,
        requestItemId: corianderId,
        noQuote: false,
        availableQuantity: '10',
        unit: 'KILOGRAM',
        unitRatePaise: BigInt(950_00),
        gstBasisPoints: 500,
        subtotalPaise: BigInt(950_000),
        gstPaise: BigInt(47_500),
        totalPaise: BigInt(997_500),
      },
    ],
  });

  return {
    tomatoId,
    corianderId,
    quoteAId: quoteA.id,
    quoteBId: quoteB.id,
    quoteATomatoItemId,
    quoteACorianderItemId,
    quoteBTomatoItemId,
    quoteBCorianderItemId,
    staleQuoteId,
    staleTomatoQuoteItemId,
  };
}

describe('restricted PostgreSQL comparison and awards', () => {
  jest.setTimeout(240_000);

  it('compares latest revisions tenant-safely and commits only exact owner awards', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let app: PrismaClient | undefined;
      try {
        await seedTenant(admin, {
          tenantId: 'tenant-a',
          ownerId: 'owner-a',
          ownerEmail: 'owner-a@example.test',
          memberId: 'member-a',
          memberEmail: 'member-a@example.test',
        });
        await seedTenant(admin, {
          tenantId: 'tenant-b',
          ownerId: 'owner-b',
          ownerEmail: 'owner-b@example.test',
        });
        await admin.supplier.createMany({
          data: [
            {
              id: 'supplier-a',
              tenantId: 'tenant-a',
              businessName: 'Shakti Foods',
              contactName: 'Ravi Kumar',
              phone: '919900000001',
              gstin: '29ABCDE1234F1Z5',
            },
            {
              id: 'supplier-b',
              tenantId: 'tenant-a',
              businessName: 'GreenLeaf Enterprises',
              email: 'quotes@greenleaf.example',
            },
            {
              id: 'supplier-private-a',
              tenantId: 'tenant-b',
              businessName: 'Private Supplier A',
            },
            {
              id: 'supplier-private-b',
              tenantId: 'tenant-b',
              businessName: 'Private Supplier B',
            },
          ],
        });
        const split = await seedOpenRequest(admin, {
          requestId: 'request-split',
          tenantId: 'tenant-a',
          ownerId: 'owner-a',
          supplierAId: 'supplier-a',
          supplierBId: 'supplier-b',
          options: { includeHistoricalRevision: true },
        });
        const concurrent = await seedOpenRequest(admin, {
          requestId: 'request-concurrent',
          tenantId: 'tenant-a',
          ownerId: 'owner-a',
          supplierAId: 'supplier-a',
          supplierBId: 'supplier-b',
        });
        const expired = await seedOpenRequest(admin, {
          requestId: 'request-expired',
          tenantId: 'tenant-a',
          ownerId: 'owner-a',
          supplierAId: 'supplier-a',
          supplierBId: 'supplier-b',
          options: { expired: true },
        });
        const privateRequest = await seedOpenRequest(admin, {
          requestId: 'request-private',
          tenantId: 'tenant-b',
          ownerId: 'owner-b',
          supplierAId: 'supplier-private-a',
          supplierBId: 'supplier-private-b',
        });

        app = await provisionAppClient(admin, databaseUrl);
        const owner = { tenantId: 'tenant-a', userId: 'owner-a' };
        const member = { tenantId: 'tenant-a', userId: 'member-a' };

        const comparison = await getQuoteComparison(
          { actor: member, requestId: 'request-split' },
          app,
        );
        expect(comparison.quotes).toHaveLength(2);
        expect(comparison.quotes.find(({ supplierId }) => supplierId === 'supplier-a'))
          .toMatchObject({ revision: 2, totalPaise: '8345000', fullCoverage: true });
        expect(comparison.quotes.some(({ quoteId }) => quoteId === split.staleQuoteId))
          .toBe(false);
        await expect(
          getQuoteComparison({ actor: owner, requestId: 'request-private' }, app),
        ).rejects.toBeInstanceOf(QuoteComparisonNotFoundError);

        await expect(
          createAward(
            {
              actor: member,
              requestId: 'request-split',
              award: {
                mode: 'WHOLE',
                expectedRequestVersion: 2,
                supplierQuoteId: split.quoteAId,
                rationale: 'Member must not award.',
              },
            },
            app,
          ),
        ).rejects.toBeInstanceOf(AuthorizationError);

        await expect(
          createAward(
            {
              actor: owner,
              requestId: 'request-split',
              award: {
                mode: 'SPLIT',
                expectedRequestVersion: 2,
                rationale: 'This invalid attempt must roll back.',
                selections: [
                  {
                    requestItemId: split.tomatoId,
                    supplierQuoteItemId: split.quoteATomatoItemId,
                    quantity: '60',
                  },
                  {
                    requestItemId: split.corianderId,
                    supplierQuoteItemId: privateRequest.quoteACorianderItemId,
                    quantity: '10',
                  },
                ],
              },
            },
            app,
          ),
        ).rejects.toBeInstanceOf(AwardConflictError);
        expect(await admin.award.count({ where: { requestId: 'request-split' } })).toBe(0);
        expect(
          await admin.awardLine.count({ where: { requestItemId: split.tomatoId } }),
        ).toBe(0);

        await expect(
          createAward(
            {
              actor: owner,
              requestId: 'request-split',
              award: {
                mode: 'WHOLE',
                expectedRequestVersion: 2,
                supplierQuoteId: split.staleQuoteId,
                rationale: 'Old revision must be rejected.',
              },
            },
            app,
          ),
        ).rejects.toBeInstanceOf(AwardConflictError);

        await expect(
          createAward(
            {
              actor: owner,
              requestId: 'request-split',
              award: {
                mode: 'SPLIT',
                expectedRequestVersion: 2,
                rationale: 'This over-award must not commit.',
                selections: [
                  {
                    requestItemId: split.tomatoId,
                    supplierQuoteItemId: split.quoteATomatoItemId,
                    quantity: '61',
                  },
                  {
                    requestItemId: split.tomatoId,
                    supplierQuoteItemId: split.quoteBTomatoItemId,
                    quantity: '40',
                  },
                  {
                    requestItemId: split.corianderId,
                    supplierQuoteItemId: split.quoteBCorianderItemId,
                    quantity: '10',
                  },
                ],
              },
            },
            app,
          ),
        ).rejects.toBeInstanceOf(AwardConflictError);
        expect(await admin.award.count({ where: { requestId: 'request-split' } })).toBe(0);

        const splitAward = await createAward(
          {
            actor: owner,
            requestId: 'request-split',
            award: {
              mode: 'SPLIT',
              expectedRequestVersion: 2,
              rationale: 'Split for exact stock coverage and earlier delivery.',
              selections: [
                {
                  requestItemId: split.tomatoId,
                  supplierQuoteItemId: split.quoteATomatoItemId,
                  quantity: '60',
                },
                {
                  requestItemId: split.tomatoId,
                  supplierQuoteItemId: split.quoteBTomatoItemId,
                  quantity: '40',
                },
                {
                  requestItemId: split.corianderId,
                  supplierQuoteItemId: split.quoteBCorianderItemId,
                  quantity: '10',
                },
              ],
            },
          },
          app,
        );
        expect(splitAward).toMatchObject({
          requestId: 'request-split',
          rationale: 'Split for exact stock coverage and earlier delivery.',
          totalPaise: '8338500',
          splitAward: true,
        });
        expect(splitAward.lines).toHaveLength(3);
        expect(splitAward.suppliers).toEqual(expect.arrayContaining([
          expect.objectContaining({
            supplierId: 'supplier-a',
            supplierName: 'Shakti Foods',
            quoteId: split.quoteAId,
            revision: 2,
            freightPaise: '50000',
          }),
          expect.objectContaining({
            supplierId: 'supplier-b',
            supplierName: 'GreenLeaf Enterprises',
            quoteId: split.quoteBId,
            revision: 1,
            freightPaise: '25000',
          }),
        ]));
        expect(await admin.procurementRequest.findUnique({ where: { id: 'request-split' } }))
          .toMatchObject({ status: 'AWARDED', version: 3 });
        expect(
          await admin.auditEvent.count({
            where: { tenantId: 'tenant-a', action: 'request.awarded', entityId: splitAward.id },
          }),
        ).toBe(1);

        const recorded = await getQuoteComparison(
          { actor: owner, requestId: 'request-split' },
          app,
        );
        expect(recorded.request.award).toMatchObject({
          id: splitAward.id,
          requestId: 'request-split',
          rationale: 'Split for exact stock coverage and earlier delivery.',
          totalPaise: '8338500',
          splitAward: true,
          deliverySnapshot: {
            requestTitle: 'request-split weekly produce',
            requestedDeliveryDate: '2099-01-10',
            deliveryDetails: {
              addressLine: '12, 100 Feet Road',
              city: 'Bengaluru',
              state: 'Karnataka',
              pin: '560038',
            },
            buyer: {
              name: 'tenant-a Restaurant',
              addressLine: '12, 100 Feet Road',
              city: 'Bengaluru',
              state: 'Karnataka',
              pin: '560038',
              phone: '9000000000',
              gstin: null,
            },
          },
          suppliers: expect.arrayContaining([
            expect.objectContaining({
              supplierId: 'supplier-a',
              supplierName: 'Shakti Foods',
              contactName: 'Ravi Kumar',
              gstin: '29ABCDE1234F1Z5',
              freightPaise: '50000',
            }),
            expect.objectContaining({
              supplierId: 'supplier-b',
              supplierName: 'GreenLeaf Enterprises',
              freightPaise: '25000',
            }),
          ]),
          lines: expect.arrayContaining([
            expect.objectContaining({
              requestItemId: split.tomatoId,
              requestItemName: 'Tomato',
              supplierId: 'supplier-a',
              quantity: '60',
              unit: 'KILOGRAM',
              unitRatePaise: '70000',
              gstBasisPoints: 500,
              subtotalPaise: '4200000',
              gstPaise: '210000',
              totalPaise: '4410000',
            }),
          ]),
        });

        await admin.supplier.update({
          where: {
            tenantId_id: { tenantId: 'tenant-a', id: 'supplier-a' },
          },
          data: {
            businessName: 'Renamed After Award',
            contactName: 'Changed Contact',
            gstin: '29ZZZZZ9999Z9Z9',
            isActive: false,
          },
        });
        const afterSupplierEdit = await getQuoteComparison(
          { actor: owner, requestId: 'request-split' },
          app,
        );
        expect(afterSupplierEdit.request.award).toEqual(recorded.request.award);
        expect(
          afterSupplierEdit.quotes.find(({ supplierId }) => supplierId === 'supplier-a'),
        ).toMatchObject({
          supplierName: 'Renamed After Award',
          supplierActive: false,
          awardable: false,
          awardIssues: ['SUPPLIER_INACTIVE'],
        });
        await admin.supplier.update({
          where: {
            tenantId_id: { tenantId: 'tenant-a', id: 'supplier-a' },
          },
          data: {
            businessName: 'Shakti Foods',
            contactName: 'Ravi Kumar',
            gstin: '29ABCDE1234F1Z5',
            isActive: true,
          },
        });

        await expect(
          createAward(
            {
              actor: owner,
              requestId: 'request-expired',
              award: {
                mode: 'WHOLE',
                expectedRequestVersion: 2,
                supplierQuoteId: expired.quoteAId,
                rationale: 'Expired quote must not be awardable.',
              },
            },
            app,
          ),
        ).rejects.toBeInstanceOf(AwardConflictError);

        const concurrentResults = await Promise.allSettled([
          createAward(
            {
              actor: owner,
              requestId: 'request-concurrent',
              award: {
                mode: 'WHOLE',
                expectedRequestVersion: 2,
                supplierQuoteId: concurrent.quoteAId,
                rationale: 'Complete quote with requested delivery.',
              },
            },
            app,
          ),
          createAward(
            {
              actor: owner,
              requestId: 'request-concurrent',
              award: {
                mode: 'WHOLE',
                expectedRequestVersion: 2,
                supplierQuoteId: concurrent.quoteAId,
                rationale: 'Concurrent duplicate decision.',
              },
            },
            app,
          ),
        ]);
        expect(concurrentResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(
          concurrentResults.filter(
            (result) =>
              result.status === 'rejected' && result.reason instanceof AwardConflictError,
          ),
        ).toHaveLength(1);
        expect(await admin.award.count({ where: { requestId: 'request-concurrent' } }))
          .toBe(1);
      } finally {
        await app?.$disconnect();
        await admin.$disconnect();
      }
    });
  });

  it('records a maximum-valid 100-supplier split snapshot above the former 16 KiB ceiling', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let app: PrismaClient | undefined;
      try {
        await seedTenant(admin, {
          tenantId: 'tenant-maximum-award',
          ownerId: 'owner-maximum-award',
          ownerEmail: 'owner-maximum-award@example.test',
        });
        await admin.procurementRequest.create({
          data: {
            id: 'request-maximum-award',
            tenantId: 'tenant-maximum-award',
            title: 'Maximum supplier split',
            status: 'OPEN',
            version: 2,
            deliveryDetails: {
              addressLine: '12, 100 Feet Road',
              city: 'Bengaluru',
              state: 'Karnataka',
              pin: '560038',
            },
            deliveryDate: new Date('2099-01-10T00:00:00.000Z'),
            quoteDeadline: new Date('2099-01-09T10:00:00.000Z'),
            openedAt: new Date('2099-01-01T09:00:00.000Z'),
            createdByUserId: 'owner-maximum-award',
            items: {
              create: {
                id: 'maximum-award-item',
                name: 'Tomato',
                quantity: '100',
                unit: 'KILOGRAM',
              },
            },
          },
        });

        const supplierRows = Array.from({ length: 100 }, (_, index) => ({
          id: `maximum-award-supplier-${String(index).padStart(3, '0')}`,
          tenantId: 'tenant-maximum-award',
          businessName: `Supplier ${index} ${'N'.repeat(120)}`,
          contactName: `Contact ${index} ${'C'.repeat(80)}`,
          phone: `9198${String(index).padStart(8, '0')}`,
          email: `supplier-${index}@maximum-award.example.test`,
          addressLine: `${index}, ${'Market Road '.repeat(18)}`,
          city: 'Bengaluru',
          state: 'Karnataka',
          pin: '560038',
        }));
        await admin.supplier.createMany({ data: supplierRows });
        await admin.supplierRequest.createMany({
          data: supplierRows.map((supplier, index) => ({
            id: `maximum-award-grant-${String(index).padStart(3, '0')}`,
            tenantId: 'tenant-maximum-award',
            requestId: 'request-maximum-award',
            supplierId: supplier.id,
            tokenDigest: createHash('sha256')
              .update(`maximum-award-grant-${index}`)
              .digest('hex'),
            expiresAt: new Date('2099-01-09T10:00:00.000Z'),
          })),
        });
        await admin.supplierQuote.createMany({
          data: supplierRows.map((_, index) => ({
            id: `maximum-award-quote-${String(index).padStart(3, '0')}`,
            tenantId: 'tenant-maximum-award',
            supplierRequestId: `maximum-award-grant-${String(index).padStart(3, '0')}`,
            revision: 1,
            subtotalPaise: BigInt(100),
            gstPaise: BigInt(0),
            freightPaise: BigInt(0),
            totalPaise: BigInt(100),
            deliveryDate: new Date('2099-01-10T00:00:00.000Z'),
            validUntil: new Date('2099-01-11T00:00:00.000Z'),
            commercialTerms: 'T'.repeat(2_000),
            notes: 'N'.repeat(4_000),
            submittedAt: new Date('2099-01-02T00:00:00.000Z'),
          })),
        });
        await admin.supplierQuoteItem.createMany({
          data: supplierRows.map((_, index) => ({
            id: `maximum-award-quote-item-${String(index).padStart(3, '0')}`,
            tenantId: 'tenant-maximum-award',
            quoteId: `maximum-award-quote-${String(index).padStart(3, '0')}`,
            requestItemId: 'maximum-award-item',
            noQuote: false,
            availableQuantity: '1',
            unit: 'KILOGRAM' as const,
            unitRatePaise: BigInt(100),
            gstBasisPoints: 0,
            subtotalPaise: BigInt(100),
            gstPaise: BigInt(0),
            totalPaise: BigInt(100),
          })),
        });

        app = await provisionAppClient(admin, databaseUrl);
        const award = await createAward(
          {
            actor: {
              tenantId: 'tenant-maximum-award',
              userId: 'owner-maximum-award',
            },
            requestId: 'request-maximum-award',
            award: {
              mode: 'SPLIT',
              expectedRequestVersion: 2,
              rationale: 'Exact coverage across the maximum supported supplier list.',
              selections: supplierRows.map((_, index) => ({
                requestItemId: 'maximum-award-item',
                supplierQuoteItemId:
                  `maximum-award-quote-item-${String(index).padStart(3, '0')}`,
                quantity: '1',
              })),
            },
          },
          app,
        );

        expect(award.suppliers).toHaveLength(100);
        expect(award.lines).toHaveLength(100);
        const [snapshot] = await admin.$queryRaw<Array<{ bytes: number }>>`
          SELECT octet_length("supplierSnapshots"::TEXT)::INTEGER AS "bytes"
          FROM "Award"
          WHERE "tenantId" = 'tenant-maximum-award'
            AND "requestId" = 'request-maximum-award'
        `;
        expect(snapshot?.bytes).toBeGreaterThan(16_384);
        expect(snapshot?.bytes).toBeLessThanOrEqual(2_097_152);
      } finally {
        await app?.$disconnect();
        await admin.$disconnect();
      }
    });
  });

  it('serializes concurrent supplier submission and owner award without leaking a deadlock error', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const password = randomBytes(24).toString('hex');
      let awardApp: PrismaClient | undefined;
      let quoteApp: PrismaClient | undefined;
      let releaseUserLock!: () => void;
      let reportUserLocked!: () => void;
      const releaseUser = new Promise<void>((resolve) => {
        releaseUserLock = resolve;
      });
      const userLocked = new Promise<void>((resolve) => {
        reportUserLocked = resolve;
      });
      try {
        await seedTenant(admin, {
          tenantId: 'tenant-submit-award-race',
          ownerId: 'owner-submit-award-race',
          ownerEmail: 'owner-submit-award-race@example.test',
        });
        await admin.supplier.create({
          data: {
            id: 'supplier-submit-award-race',
            tenantId: 'tenant-submit-award-race',
            businessName: 'Race-safe Foods',
          },
        });
        await admin.procurementRequest.create({
          data: {
            id: 'request-submit-award-race',
            tenantId: 'tenant-submit-award-race',
            title: 'Concurrent award request',
            status: 'OPEN',
            version: 2,
            deliveryDetails: { addressLine: '12, 100 Feet Road' },
            deliveryDate: new Date('2099-01-10T00:00:00.000Z'),
            quoteDeadline: new Date('2099-01-09T10:00:00.000Z'),
            openedAt: new Date('2099-01-01T09:00:00.000Z'),
            createdByUserId: 'owner-submit-award-race',
            items: {
              create: {
                id: 'item-submit-award-race',
                name: 'Tomato',
                quantity: '1',
                unit: 'KILOGRAM',
              },
            },
          },
        });
        const raceToken = 'R'.repeat(43);
        await admin.supplierRequest.create({
          data: {
            id: 'grant-submit-award-race',
            tenantId: 'tenant-submit-award-race',
            requestId: 'request-submit-award-race',
            supplierId: 'supplier-submit-award-race',
            tokenDigest: digestOpaqueToken('supplier-request', raceToken),
            expiresAt: new Date('2099-01-09T10:00:00.000Z'),
          },
        });
        await admin.supplierQuote.create({
          data: {
            id: 'quote-submit-award-race-r1',
            tenantId: 'tenant-submit-award-race',
            supplierRequestId: 'grant-submit-award-race',
            revision: 1,
            subtotalPaise: BigInt(10_000),
            gstPaise: BigInt(500),
            freightPaise: BigInt(0),
            totalPaise: BigInt(10_500),
            deliveryDate: new Date('2099-01-10T00:00:00.000Z'),
            validUntil: new Date('2099-01-11T00:00:00.000Z'),
            commercialTerms: 'Payment in 15 days.',
            items: {
              create: {
                id: 'quote-item-submit-award-race-r1',
                requestItemId: 'item-submit-award-race',
                noQuote: false,
                availableQuantity: '1',
                unit: 'KILOGRAM',
                unitRatePaise: BigInt(10_000),
                gstBasisPoints: 500,
                subtotalPaise: BigInt(10_000),
                gstPaise: BigInt(500),
                totalPaise: BigInt(10_500),
              },
            },
          },
        });

        await admin.$executeRawUnsafe(
          `ALTER ROLE autorfp_app PASSWORD '${password}'`,
        );
        awardApp = new PrismaClient({
          datasources: {
            db: {
              url: namedAppDatabaseUrl(databaseUrl, password, 'award-race'),
            },
          },
        });
        quoteApp = new PrismaClient({
          datasources: {
            db: {
              url: namedAppDatabaseUrl(databaseUrl, password, 'quote-race'),
            },
          },
        });
        await Promise.all([awardApp.$connect(), quoteApp.$connect()]);

        const userLockHolder = admin.$transaction(async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id"
            FROM "User"
            WHERE "tenantId" = 'tenant-submit-award-race'
              AND "id" = 'owner-submit-award-race'
            FOR UPDATE
          `;
          reportUserLocked();
          await releaseUser;
        });
        await userLocked;

        const awardResult = createAward(
          {
            actor: {
              tenantId: 'tenant-submit-award-race',
              userId: 'owner-submit-award-race',
            },
            requestId: 'request-submit-award-race',
            award: {
              mode: 'WHOLE',
              expectedRequestVersion: 2,
              supplierQuoteId: 'quote-submit-award-race-r1',
              rationale: 'Complete valid quote at the requested delivery date.',
            },
          },
          awardApp,
        );
        await waitForDatabaseLock(admin, 'award-race');

        const quoteResult = submitPublicSupplierQuote(
          {
            token: raceToken,
            quote: {
              expectedLatestRevision: 1,
              deliveryDate: '2099-01-10',
              validUntil: '2099-01-11',
              freightInr: '0',
              commercialTerms: 'Payment in 15 days.',
              notes: null,
              items: [
                {
                  requestItemId: 'item-submit-award-race',
                  noQuote: false,
                  availableQuantity: '1',
                  unitRateInr: '99',
                  gstPercent: '5',
                  taxInclusive: false,
                  substitution: null,
                },
              ],
            },
          },
          quoteApp,
        );
        await waitForDatabaseLock(admin, 'quote-race');
        releaseUserLock();
        await userLockHolder;

        const [awardSettled, quoteSettled] = await Promise.allSettled([
          awardResult,
          quoteResult,
        ]);
        expect(awardSettled.status).toBe('fulfilled');
        expect(quoteSettled).toEqual(
          expect.objectContaining({
            status: 'rejected',
            reason: expect.any(PublicQuoteUnavailableError),
          }),
        );
        expect(
          await admin.award.count({
            where: { requestId: 'request-submit-award-race' },
          }),
        ).toBe(1);
        expect(
          await admin.supplierQuote.count({
            where: { supplierRequestId: 'grant-submit-award-race' },
          }),
        ).toBe(1);
      } finally {
        releaseUserLock?.();
        await awardApp?.$disconnect();
        await quoteApp?.$disconnect();
        await admin.$disconnect();
      }
    });
  });
});
