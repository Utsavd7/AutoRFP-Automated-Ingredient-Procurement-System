import { randomBytes } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import {
  AwardDocumentStorageCorruptionError,
  validateAwardDocuments,
} from '@/lib/awards/award-document';
import {
  AwardConflictError,
  AwardNotFoundError,
  createAward,
} from '@/lib/awards/award-service';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  getQuoteComparison,
  QuoteComparisonNotFoundError,
} from '@/lib/comparison/compare-quotes';
import {
  appendQuoteRevision,
  type QuoteRequestItem,
  type QuoteRevisionsV1,
} from '@/lib/quotes/quote-revisions';
import {
  PublicQuoteUnavailableError,
  submitPublicSupplierQuote,
} from '@/lib/quotes/public-quote-service';
import { digestOpaqueToken } from '@/lib/security/tokens';

import { withMigratedPostgres } from './setup/postgres';

const farFuture = new Date('2099-09-01T00:00:00.000Z');
const databaseNow = new Date('2026-08-30T10:00:00.123Z');

function appDatabaseUrl(databaseUrl: string, password: string, name?: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  if (name) url.searchParams.set('application_name', name);
  return url.toString();
}

async function appClient(
  admin: PrismaClient,
  databaseUrl: string,
  name?: string,
) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
  const client = new PrismaClient({
    datasources: { db: { url: appDatabaseUrl(databaseUrl, password, name) } },
  });
  await client.$connect();
  return { client, password };
}

function item(
  id: string,
  name: string,
  quantity: string,
): QuoteRequestItem & { sourcingOverride: null } {
  return {
    id,
    itemKey: id,
    name,
    quantity,
    unit: 'KILOGRAM',
    specification: {
      v: 1,
      category: 'VEGETABLES',
      description: `${name} requested specification`,
      preferredBrand: 'Farm Select',
      packSize: '5 kg crate',
      qualityGrade: 'A',
      notes: 'No bruising',
      referenceUrl: null,
      thumbnailWebpBase64: null,
    },
    sourcingOverride: null,
  };
}

const requestItems = [
  item('tomato', 'Tomato', '100'),
  item('coriander', 'Coriander', '10'),
];

function requestDocuments(supplierIds: string[]) {
  return {
    items: { v: 1, items: requestItems },
    sourcing: {
      v: 1,
      default: {
        v: 1,
        modes: ['CURRENT'],
        currentSupplierIds: supplierIds,
        selectedNewSupplierIds: [],
        acceptVerifiedApplications: false,
      },
    },
  };
}

function quoteSubmission(input: {
  supplier: 'A' | 'B';
  validUntil?: string;
  tomatoRateInr?: string;
}) {
  const supplierA = input.supplier === 'A';
  return {
    deliveryDate: '2099-09-02',
    validUntil: input.validUntil ?? '2099-09-01',
    minimumOrder: supplierA ? 'Minimum invoice INR 5,000' : null,
    freightInr: supplierA ? '500' : '250',
    commercialTerms: supplierA
      ? 'Payment within 15 days'
      : 'Payment within 7 days',
    notes: supplierA ? 'Grade A produce' : null,
    items: [
      {
        requestItemId: 'tomato',
        noQuote: false,
        availableQuantity: supplierA ? '100' : '40',
        unit: 'KILOGRAM',
        unitRateInr: input.tomatoRateInr ?? (supplierA ? '700' : '680'),
        gstPercent: '5',
        taxInclusive: false,
        suppliedBrand: supplierA ? 'Harvest House' : 'GreenLeaf',
        suppliedPackSize: '5 kg crate',
        suppliedQualityGrade: supplierA ? 'Premium' : 'A',
        substitution: supplierA ? 'Vine-ripened equivalent' : null,
      },
      {
        requestItemId: 'coriander',
        noQuote: false,
        availableQuantity: '10',
        unit: 'KILOGRAM',
        unitRateInr: supplierA ? '900' : '950',
        gstPercent: '5',
        taxInclusive: false,
        suppliedBrand: null,
        suppliedPackSize: '1 kg bunch',
        suppliedQualityGrade: 'A',
        substitution: null,
      },
    ],
  };
}

function quoteDocument(input: {
  supplier: 'A' | 'B';
  revisions?: number;
  validUntil?: string;
}) {
  let document: QuoteRevisionsV1 = { v: 1, revisions: [] };
  const count = input.revisions ?? 1;
  for (let revision = 0; revision < count; revision += 1) {
    document = appendQuoteRevision(
      document,
      quoteSubmission({
        supplier: input.supplier,
        validUntil: input.validUntil,
        tomatoRateInr:
          input.supplier === 'A' ? String(690 + revision * 10) : undefined,
      }),
      {
        requestItems,
        expectedLatestRevision: revision,
        storedLatestRevision: revision,
        databaseNow: input.validUntil === '2026-08-20'
          ? new Date('2026-08-01T10:00:00.000Z')
          : new Date(databaseNow.getTime() + revision),
      },
    );
  }
  return document;
}

async function seedTenant(
  admin: PrismaClient,
  input: { tenantId: string; ownerId: string; includeMember?: boolean },
) {
  await admin.tenant.create({
    data: {
      id: input.tenantId,
      name: `${input.tenantId} Restaurant`,
      addressLine: '18 Koregaon Park Road',
      city: 'Pune',
      state: 'Maharashtra',
      pin: '411001',
      phone: '9000000000',
      gstin: '27ABCDE1234F1Z5',
      users: {
        create: [
          {
            id: input.ownerId,
            name: `${input.ownerId} Owner`,
            email: `${input.ownerId}@example.test`,
            role: 'OWNER',
          },
          ...(input.includeMember
            ? [
                {
                  id: `${input.tenantId}-member`,
                  name: 'Member',
                  email: `${input.tenantId}-member@example.test`,
                  role: 'MEMBER' as const,
                },
                {
                  id: `${input.tenantId}-deactivated-owner`,
                  name: 'Former owner',
                  email: `${input.tenantId}-former@example.test`,
                  role: 'OWNER' as const,
                  accountState: 'DEACTIVATED' as const,
                },
              ]
            : []),
        ],
      },
    },
  });
}

async function seedSuppliers(
  admin: PrismaClient,
  tenantId: string,
  ownerId: string,
) {
  await admin.supplier.createMany({
    data: [
      {
        id: `${tenantId}-supplier-a`,
        tenantId,
        businessName: 'A Produce',
        contactName: 'Asha Rao',
        phone: '9000000001',
        email: 'orders@aproduce.example',
        addressLine: '1 Market Road',
        city: 'Pune',
        state: 'Maharashtra',
        pin: '411001',
        gstin: '27AAAAA1111A1Z1',
        relationshipType: 'CURRENT',
        verificationStatus: 'VERIFIED',
        verifiedAt: databaseNow,
        verifiedByUserId: ownerId,
        capabilities: { v: 1, categories: [], items: [] },
      },
      {
        id: `${tenantId}-supplier-b`,
        tenantId,
        businessName: 'B Produce',
        contactName: 'Bina Shah',
        relationshipType: 'CURRENT',
        verificationStatus: 'VERIFIED',
        verifiedAt: databaseNow,
        verifiedByUserId: ownerId,
        capabilities: { v: 1, categories: [], items: [] },
      },
      {
        id: `${tenantId}-supplier-inactive`,
        tenantId,
        businessName: 'Inactive Produce',
        isActive: false,
        relationshipType: 'CURRENT',
        verificationStatus: 'VERIFIED',
        verifiedAt: databaseNow,
        verifiedByUserId: ownerId,
        capabilities: { v: 1, categories: [], items: [] },
      },
    ],
  });
}

async function seedRequest(
  admin: PrismaClient,
  input: {
    tenantId: string;
    ownerId: string;
    requestId: string;
    supplierKinds?: Array<'A' | 'B' | 'INACTIVE'>;
    revisionsA?: number;
    expired?: boolean;
    tokenA?: string;
  },
) {
  const supplierKinds = input.supplierKinds ?? ['A', 'B'];
  const supplierIds = supplierKinds.map((kind) =>
    kind === 'A'
      ? `${input.tenantId}-supplier-a`
      : kind === 'B'
        ? `${input.tenantId}-supplier-b`
        : `${input.tenantId}-supplier-inactive`,
  );
  const documents = requestDocuments(supplierIds);
  await admin.procurementRequest.create({
    data: {
      id: input.requestId,
      tenantId: input.tenantId,
      title: `${input.requestId} weekly produce`,
      status: 'OPEN',
      version: 2,
      items: documents.items as unknown as Prisma.InputJsonValue,
      sourcing: documents.sourcing as unknown as Prisma.InputJsonValue,
      deliveryDetails: {
        addressLine: '18 Koregaon Park Road',
        city: 'Pune',
        state: 'Maharashtra',
        pin: '411001',
        instructions: 'Use the service entrance',
      },
      deliveryDate: new Date('2099-09-02T00:00:00.000Z'),
      quoteDeadline: farFuture,
      commercialTerms: 'Rates must include packing.',
      openedAt: databaseNow,
      createdByUserId: input.ownerId,
    },
  });

  const grants = supplierKinds.map((kind, index) => {
    const supplier = kind === 'B' ? 'B' : 'A';
    const revisions = kind === 'A' ? input.revisionsA ?? 1 : 1;
    const id = `${input.requestId}-grant-${kind.toLowerCase()}`;
    const token = kind === 'A' && input.tokenA
      ? input.tokenA
      : `${input.requestId}-${kind}-${index}`.padEnd(43, kind).slice(0, 43);
    return {
      id,
      tenantId: input.tenantId,
      requestId: input.requestId,
      supplierId: supplierIds[index]!,
      tokenDigest: digestOpaqueToken('supplier-request', token),
      expiresAt: farFuture,
      quoteRevision: revisions,
      quoteRevisions: quoteDocument({
        supplier,
        revisions,
        validUntil: input.expired ? '2026-08-20' : undefined,
      }) as unknown as Prisma.InputJsonValue,
    };
  });
  await admin.supplierRequest.createMany({ data: grants });
  return {
    grantAId: `${input.requestId}-grant-a`,
    grantBId: `${input.requestId}-grant-b`,
  };
}

async function waitForDatabaseLock(
  admin: PrismaClient,
  applicationName: string,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [state] = await admin.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_stat_activity
        WHERE application_name = ${applicationName}
          AND wait_event_type = 'Lock'
      ) AS "waiting"
    `;
    if (state?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${applicationName} did not reach the expected lock.`);
}

describe('compact awards with restricted PostgreSQL', () => {
  jest.setTimeout(240_000);

  it('authorizes an active owner and stores one immutable, exactly covered split award', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let app: PrismaClient | undefined;
      try {
        await seedTenant(admin, {
          tenantId: 'tenant-a',
          ownerId: 'owner-a',
          includeMember: true,
        });
        await seedTenant(admin, { tenantId: 'tenant-b', ownerId: 'owner-b' });
        await seedSuppliers(admin, 'tenant-a', 'owner-a');
        await seedSuppliers(admin, 'tenant-b', 'owner-b');
        const split = await seedRequest(admin, {
          tenantId: 'tenant-a',
          ownerId: 'owner-a',
          requestId: 'request-split',
          revisionsA: 2,
        });
        await seedRequest(admin, {
          tenantId: 'tenant-a',
          ownerId: 'owner-a',
          requestId: 'request-expired',
          supplierKinds: ['A'],
          expired: true,
        });
        await seedRequest(admin, {
          tenantId: 'tenant-a',
          ownerId: 'owner-a',
          requestId: 'request-inactive',
          supplierKinds: ['INACTIVE'],
        });
        await seedRequest(admin, {
          tenantId: 'tenant-b',
          ownerId: 'owner-b',
          requestId: 'request-private',
          supplierKinds: ['A'],
        });

        ({ client: app } = await appClient(admin, databaseUrl));
        const owner = { tenantId: 'tenant-a', userId: 'owner-a' };
        const splitInput = {
          mode: 'SPLIT',
          expectedRequestVersion: 2,
          rationale: 'Split for confirmed stock coverage and the required delivery.',
          selections: [
            {
              requestItemId: 'tomato',
              supplierRequestId: split.grantAId,
              quoteRevision: 2,
              quantity: '60',
            },
            {
              requestItemId: 'tomato',
              supplierRequestId: split.grantBId,
              quoteRevision: 1,
              quantity: '40',
            },
            {
              requestItemId: 'coriander',
              supplierRequestId: split.grantBId,
              quoteRevision: 1,
              quantity: '10',
            },
          ],
        } as const;

        for (const userId of [
          'tenant-a-member',
          'tenant-a-deactivated-owner',
        ]) {
          await expect(createAward({
            actor: { tenantId: 'tenant-a', userId },
            requestId: 'request-split',
            award: splitInput,
          }, app)).rejects.toBeInstanceOf(AuthorizationError);
        }
        await expect(createAward({
          actor: owner,
          requestId: 'request-private',
          award: {
            mode: 'WHOLE',
            expectedRequestVersion: 2,
            supplierRequestId: 'request-private-grant-a',
            quoteRevision: 1,
            rationale: 'Cross-tenant request must remain hidden.',
          },
        }, app)).rejects.toBeInstanceOf(AwardNotFoundError);
        await expect(
          getQuoteComparison({ actor: owner, requestId: 'request-private' }, app),
        ).rejects.toBeInstanceOf(QuoteComparisonNotFoundError);

        for (const [requestId, supplierRequestId] of [
          ['request-expired', 'request-expired-grant-a'],
          ['request-inactive', 'request-inactive-grant-inactive'],
        ] as const) {
          await expect(createAward({
            actor: owner,
            requestId,
            award: {
              mode: 'WHOLE',
              expectedRequestVersion: 2,
              supplierRequestId,
              quoteRevision: 1,
              rationale: 'Unavailable quotes cannot be awarded.',
            },
          }, app)).rejects.toBeInstanceOf(AwardConflictError);
        }

        await expect(createAward({
          actor: owner,
          requestId: 'request-split',
          award: {
            mode: 'WHOLE',
            expectedRequestVersion: 2,
            supplierRequestId: split.grantAId,
            quoteRevision: 1,
            rationale: 'A historical embedded revision cannot be awarded.',
          },
        }, app)).rejects.toBeInstanceOf(AwardConflictError);

        for (const invalidSelections of [
          splitInput.selections.slice(0, 2),
          [
            { ...splitInput.selections[0], quantity: '61' },
            splitInput.selections[1],
            splitInput.selections[2],
          ],
        ]) {
          await expect(createAward({
            actor: owner,
            requestId: 'request-split',
            award: { ...splitInput, selections: invalidSelections },
          }, app)).rejects.toBeInstanceOf(AwardConflictError);
        }

        const awarded = await createAward({
          actor: owner,
          requestId: 'request-split',
          award: splitInput,
        }, app);
        expect(awarded).toMatchObject({
          requestId: 'request-split',
          rationale: splitInput.rationale,
          totalPaise: '8338500',
          splitAward: true,
        });
        expect(awarded.lines).toHaveLength(3);
        expect(awarded.suppliers).toHaveLength(2);

        const stored = await admin.award.findUniqueOrThrow({
          where: { requestId: 'request-split' },
        });
        const validated = validateAwardDocuments({
          allocationLines: stored.allocationLines,
          supplierSnapshots: stored.supplierSnapshots,
          deliverySnapshot: stored.deliverySnapshot,
          totalPaise: stored.totalPaise,
        });
        expect(validated).toMatchObject({
          totalPaise: '8338500',
          splitAward: true,
          supplierSnapshots: {
            suppliers: expect.arrayContaining([
              expect.objectContaining({
                supplierId: 'tenant-a-supplier-a',
                supplierRequestId: split.grantAId,
                quoteRevision: 2,
                freightPaise: '50000',
                minimumOrder: 'Minimum invoice INR 5,000',
                lines: [expect.objectContaining({
                  requestItemId: 'tomato',
                  requestedSpecification: expect.objectContaining({
                    description: 'Tomato requested specification',
                    preferredBrand: 'Farm Select',
                    packSize: '5 kg crate',
                    qualityGrade: 'A',
                  }),
                  taxInclusive: false,
                  suppliedBrand: 'Harvest House',
                  suppliedPackSize: '5 kg crate',
                  suppliedQualityGrade: 'Premium',
                  substitution: 'Vine-ripened equivalent',
                })],
              }),
            ]),
          },
        });
        const committedRequest = await admin.procurementRequest.findUniqueOrThrow({
          where: { id: 'request-split' },
        });
        expect(committedRequest).toMatchObject({ status: 'AWARDED', version: 3 });
        expect(committedRequest.awardedAt?.getTime()).toBe(stored.createdAt.getTime());
        const grants = await admin.supplierRequest.findMany({
          where: { requestId: 'request-split' },
          orderBy: { id: 'asc' },
        });
        expect(grants.every(({ revokedAt }) =>
          revokedAt?.getTime() === stored.createdAt.getTime(),
        )).toBe(true);

        const comparisonAfterAward = await getQuoteComparison({
          actor: owner,
          requestId: 'request-split',
        }, app);
        expect(comparisonAfterAward.request.award).toMatchObject({
          id: stored.id,
          requestId: 'request-split',
          rationale: splitInput.rationale,
          totalPaise: '8338500',
          splitAward: true,
          lines: expect.arrayContaining([
            expect.objectContaining({
              requestItemId: 'tomato',
              supplierRequestId: split.grantAId,
              quoteRevision: 2,
              quantity: '60',
            }),
          ]),
        });
        const corruptAllocations = structuredClone(
          stored.allocationLines,
        ) as { v: number; lines: Array<Record<string, unknown>> };
        corruptAllocations.lines[0]!.totalPaise = '1';
        await admin.award.update({
          where: { id: stored.id },
          data: {
            allocationLines: corruptAllocations as Prisma.InputJsonValue,
          },
        });
        await expect(getQuoteComparison({
          actor: owner,
          requestId: 'request-split',
        }, app)).rejects.toBeInstanceOf(AwardDocumentStorageCorruptionError);
        await admin.award.update({
          where: { id: stored.id },
          data: {
            allocationLines: stored.allocationLines as Prisma.InputJsonValue,
          },
        });

        const immutableBytes = JSON.stringify({
          allocationLines: stored.allocationLines,
          supplierSnapshots: stored.supplierSnapshots,
          deliverySnapshot: stored.deliverySnapshot,
          totalPaise: stored.totalPaise.toString(),
        });
        await admin.tenant.update({
          where: { id: 'tenant-a' },
          data: { name: 'Renamed Restaurant' },
        });
        await admin.supplier.update({
          where: { id: 'tenant-a-supplier-a' },
          data: { businessName: 'Renamed Supplier', contactName: 'Changed' },
        });
        await admin.procurementRequest.update({
          where: { id: 'request-split' },
          data: { title: 'Renamed request', commercialTerms: 'Changed terms' },
        });
        const afterLiveEdits = await admin.award.findUniqueOrThrow({
          where: { requestId: 'request-split' },
        });
        expect(JSON.stringify({
          allocationLines: afterLiveEdits.allocationLines,
          supplierSnapshots: afterLiveEdits.supplierSnapshots,
          deliverySnapshot: afterLiveEdits.deliverySnapshot,
          totalPaise: afterLiveEdits.totalPaise.toString(),
        })).toBe(immutableBytes);

        await expect(createAward({
          actor: owner,
          requestId: 'request-split',
          award: splitInput,
        }, app)).rejects.toMatchObject({ code: 'AWARD_CONFLICT', status: 409 });
        expect(await admin.award.count({ where: { requestId: 'request-split' } }))
          .toBe(1);
      } finally {
        await app?.$disconnect();
        await admin.$disconnect();
      }
    });
  });

  it('linearizes quote-first and award-first updates on embedded revisions', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const quoteFirstToken = 'Q'.repeat(43);
      const awardFirstToken = 'A'.repeat(43);
      let quoteApp: PrismaClient | undefined;
      let awardApp: PrismaClient | undefined;
      try {
        await seedTenant(admin, { tenantId: 'race-tenant', ownerId: 'race-owner' });
        await seedSuppliers(admin, 'race-tenant', 'race-owner');
        await seedRequest(admin, {
          tenantId: 'race-tenant',
          ownerId: 'race-owner',
          requestId: 'quote-first-request',
          supplierKinds: ['A'],
          tokenA: quoteFirstToken,
        });
        await seedRequest(admin, {
          tenantId: 'race-tenant',
          ownerId: 'race-owner',
          requestId: 'award-first-request',
          supplierKinds: ['A'],
          tokenA: awardFirstToken,
        });
        const credentials = await appClient(
          admin,
          databaseUrl,
          'quote-first',
        );
        quoteApp = credentials.client;
        awardApp = new PrismaClient({
          datasources: {
            db: {
              url: appDatabaseUrl(
                databaseUrl,
                credentials.password,
                'award-after-quote',
              ),
            },
          },
        });
        await awardApp.$connect();

        let releaseQuoteFirst!: () => void;
        let reportQuoteFirstLocked!: () => void;
        const quoteFirstReleased = new Promise<void>((resolve) => {
          releaseQuoteFirst = resolve;
        });
        const quoteFirstLocked = new Promise<void>((resolve) => {
          reportQuoteFirstLocked = resolve;
        });
        const quoteFirstHolder = admin.$transaction(async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id"
            FROM "SupplierRequest"
            WHERE "id" = 'quote-first-request-grant-a'
            FOR UPDATE
          `;
          reportQuoteFirstLocked();
          await quoteFirstReleased;
        });
        await quoteFirstLocked;
        const quoteFirst = submitPublicSupplierQuote({
          token: quoteFirstToken,
          quote: {
            expectedLatestRevision: 1,
            ...quoteSubmission({ supplier: 'A', tomatoRateInr: '710' }),
          },
        }, quoteApp);
        await waitForDatabaseLock(admin, 'quote-first');
        const staleAward = createAward({
          actor: { tenantId: 'race-tenant', userId: 'race-owner' },
          requestId: 'quote-first-request',
          award: {
            mode: 'WHOLE',
            expectedRequestVersion: 2,
            supplierRequestId: 'quote-first-request-grant-a',
            quoteRevision: 1,
            rationale: 'This revision must become stale while waiting for the grant.',
          },
        }, awardApp);
        await waitForDatabaseLock(admin, 'award-after-quote');
        releaseQuoteFirst();
        await quoteFirstHolder;
        await expect(quoteFirst).resolves.toMatchObject({ revision: 2 });
        await expect(staleAward).rejects.toBeInstanceOf(AwardConflictError);
        expect(await admin.award.count({
          where: { requestId: 'quote-first-request' },
        })).toBe(0);

        await awardApp.$disconnect();
        awardApp = new PrismaClient({
          datasources: {
            db: {
              url: appDatabaseUrl(
                databaseUrl,
                credentials.password,
                'award-first',
              ),
            },
          },
        });
        await awardApp.$connect();

        let releaseSupplier!: () => void;
        let reportSupplierLocked!: () => void;
        const supplierReleased = new Promise<void>((resolve) => {
          releaseSupplier = resolve;
        });
        const supplierLocked = new Promise<void>((resolve) => {
          reportSupplierLocked = resolve;
        });
        const supplierHolder = admin.$transaction(async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id"
            FROM "Supplier"
            WHERE "id" = 'race-tenant-supplier-a'
            FOR UPDATE
          `;
          reportSupplierLocked();
          await supplierReleased;
        });
        await supplierLocked;
        const awardFirst = createAward({
          actor: { tenantId: 'race-tenant', userId: 'race-owner' },
          requestId: 'award-first-request',
          award: {
            mode: 'WHOLE',
            expectedRequestVersion: 2,
            supplierRequestId: 'award-first-request-grant-a',
            quoteRevision: 1,
            rationale: 'The award owns the grant lock before the quote update.',
          },
        }, awardApp);
        await waitForDatabaseLock(admin, 'award-first');
        const quoteAfterAward = submitPublicSupplierQuote({
          token: awardFirstToken,
          quote: {
            expectedLatestRevision: 1,
            ...quoteSubmission({ supplier: 'A', tomatoRateInr: '710' }),
          },
        }, quoteApp);
        await waitForDatabaseLock(admin, 'quote-first');
        releaseSupplier();
        await supplierHolder;
        await expect(awardFirst).resolves.toMatchObject({
          requestId: 'award-first-request',
          splitAward: false,
        });
        await expect(quoteAfterAward).rejects.toBeInstanceOf(
          PublicQuoteUnavailableError,
        );
        expect(await admin.supplierRequest.findUniqueOrThrow({
          where: { id: 'award-first-request-grant-a' },
        })).toMatchObject({ quoteRevision: 1, revokedAt: expect.any(Date) });
      } finally {
        await quoteApp?.$disconnect();
        await awardApp?.$disconnect();
        await admin.$disconnect();
      }
    });
  });
});
