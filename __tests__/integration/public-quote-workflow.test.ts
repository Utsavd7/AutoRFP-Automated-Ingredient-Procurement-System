import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  getPublicQuoteRequest,
  PublicQuoteStorageCorruptionError,
  submitPublicSupplierQuote,
} from '@/lib/quotes/public-quote-service';
import type { QuoteRevisionV1 } from '@/lib/quotes/quote-revisions';
import { digestOpaqueToken } from '@/lib/security/tokens';
import { deactivateSupplier } from '@/lib/suppliers/supplier-service';

import { withMigratedPostgres } from './setup/postgres';

const tokenA = 'Q'.repeat(43);
const tokenB = 'R'.repeat(43);
const emptyQuoteRevisions = { v: 1, revisions: [] };
const farFuture = new Date('2099-09-01T00:00:00.000Z');

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

function item(
  id: string,
  unit: 'KILOGRAM' | 'PACK',
  sourcingOverride: object | null,
) {
  return {
    id,
    itemKey: id,
    name: id.replaceAll('-', ' '),
    quantity: unit === 'KILOGRAM' ? '10' : '4',
    unit,
    specification: {
      v: 1,
      category: 'VEGETABLES',
      description: `${id} specification`,
      preferredBrand: null,
      packSize: null,
      qualityGrade: 'A',
      notes: null,
      referenceUrl: null,
      thumbnailWebpBase64: null,
    },
    sourcingOverride,
  };
}

function currentSelection(supplierIds: string[]) {
  return {
    v: 1,
    modes: ['CURRENT'],
    currentSupplierIds: supplierIds,
    selectedNewSupplierIds: [],
    acceptVerifiedApplications: false,
  };
}

const requestItems = {
  v: 1,
  items: [
    item('item-a', 'KILOGRAM', null),
    item('item-b', 'KILOGRAM', currentSelection(['supplier-b'])),
    item(
      'item-shared',
      'PACK',
      currentSelection(['supplier-a', 'supplier-b']),
    ),
  ],
};
const requestSourcing = {
  v: 1,
  default: currentSelection(['supplier-a']),
};

function quotedLine(requestItemId: string, unit: 'KILOGRAM' | 'PACK') {
  return {
    requestItemId,
    noQuote: false,
    availableQuantity: unit === 'KILOGRAM' ? '10' : '4',
    unit,
    unitRateInr: unit === 'KILOGRAM' ? '42' : '25',
    gstPercent: '5',
    taxInclusive: false,
    suppliedBrand: `${requestItemId} brand`,
    suppliedPackSize: unit === 'PACK' ? '500 g pack' : null,
    suppliedQualityGrade: 'A',
    substitution: null,
  };
}

function submission(
  expectedLatestRevision: number,
  supplier: 'A' | 'B',
  freightInr = '10',
) {
  const ids = supplier === 'A'
    ? ([['item-a', 'KILOGRAM'], ['item-shared', 'PACK']] as const)
    : ([['item-b', 'KILOGRAM'], ['item-shared', 'PACK']] as const);
  return {
    expectedLatestRevision,
    deliveryDate: '2099-09-02',
    validUntil: '2099-09-01',
    minimumOrder: 'Minimum invoice ₹2,500',
    freightInr,
    commercialTerms: 'Payment within 15 days',
    notes: null,
    items: ids.map(([id, unit]) => quotedLine(id, unit)),
  };
}

test('embedded public quotes preserve privacy, exact revisions, corruption boundaries, and row-local concurrency', async () => {
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
            create: [
              {
                id: 'supplier-a',
                businessName: 'Alpha Fresh Foods',
                relationshipType: 'CURRENT',
                verificationStatus: 'VERIFIED',
                verifiedAt: new Date('2026-08-28T09:00:00.000Z'),
                verifiedByUserId: 'quote-owner',
                capabilities: { v: 1, categories: [], items: [] },
              },
              {
                id: 'supplier-b',
                businessName: 'Beta Fresh Foods',
                relationshipType: 'CURRENT',
                verificationStatus: 'VERIFIED',
                verifiedAt: new Date('2026-08-28T09:00:00.000Z'),
                verifiedByUserId: 'quote-owner',
                capabilities: { v: 1, categories: [], items: [] },
              },
            ],
          },
          procurementRequests: {
            create: {
              id: 'quote-request',
              title: 'Private split-source request',
              status: 'OPEN',
              openedAt: new Date('2026-08-28T10:00:00.000Z'),
              items: requestItems,
              sourcing: requestSourcing,
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
              createdByUserId: 'quote-owner',
            },
          },
        },
      });
      await admin.supplierRequest.createMany({
        data: [
          {
            id: 'supplier-request-a',
            tenantId: 'quote-tenant',
            requestId: 'quote-request',
            supplierId: 'supplier-a',
            tokenDigest: digestOpaqueToken('supplier-request', tokenA),
            expiresAt: farFuture,
            quoteRevision: 0,
            quoteRevisions: emptyQuoteRevisions,
          },
          {
            id: 'supplier-request-b',
            tenantId: 'quote-tenant',
            requestId: 'quote-request',
            supplierId: 'supplier-b',
            tokenDigest: digestOpaqueToken('supplier-request', tokenB),
            expiresAt: farFuture,
            quoteRevision: 0,
            quoteRevisions: emptyQuoteRevisions,
          },
        ],
      });
      await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
      app = new PrismaClient({
        datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
      });
      await app.$connect();

      const beforeView = await admin.supplierRequest.findUniqueOrThrow({
        where: { id: 'supplier-request-a' },
      });
      expect(beforeView.viewedAt).toBeNull();
      expect(beforeView.tokenDigest).toBe(
        digestOpaqueToken('supplier-request', tokenA),
      );
      expect(beforeView.tokenDigest).not.toContain(tokenA);

      const supplierView = await getPublicQuoteRequest({ token: tokenA }, app);
      expect(supplierView.items.map(({ id }) => id)).toEqual([
        'item-a',
        'item-shared',
      ]);
      expect(supplierView.items[0]).toEqual(expect.objectContaining({
        itemKey: 'item-a',
        specification: expect.objectContaining({ qualityGrade: 'A' }),
      }));
      expect(supplierView.latestQuote).toBeNull();
      const serializedView = JSON.stringify(supplierView);
      for (const privateValue of [
        'item-b',
        'supplier-b',
        'currentSupplierIds',
        'selectedNewSupplierIds',
        'tokenDigest',
        'quoteRevisions',
      ]) {
        expect(serializedView).not.toContain(privateValue);
      }
      expect((await admin.supplierRequest.findUniqueOrThrow({
        where: { id: 'supplier-request-a' },
      })).viewedAt).toEqual(expect.any(Date));

      const submitStartedAt = Date.now();
      const raced = await Promise.allSettled([
        submitPublicSupplierQuote(
          { token: tokenA, quote: submission(0, 'A', '10') },
          app,
        ),
        submitPublicSupplierQuote(
          { token: tokenA, quote: submission(0, 'A', '20') },
          app,
        ),
      ]);
      const fulfilled = raced.filter(
        (result): result is PromiseFulfilledResult<QuoteRevisionV1> =>
          result.status === 'fulfilled',
      );
      const rejected = raced.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({
            code: 'QUOTE_REVISION_CONFLICT',
            status: 409,
          }),
        }),
      ]);
      expect(Date.parse(fulfilled[0]!.value.submittedAt)).toBeGreaterThanOrEqual(
        submitStartedAt,
      );
      expect(Date.parse(fulfilled[0]!.value.submittedAt)).toBeLessThanOrEqual(
        Date.now(),
      );

      const storedAfterFirst = await admin.supplierRequest.findUniqueOrThrow({
        where: { id: 'supplier-request-a' },
      });
      expect(storedAfterFirst.quoteRevision).toBe(1);
      const firstDocument = storedAfterFirst.quoteRevisions as {
        v: number;
        revisions: QuoteRevisionV1[];
      };
      expect(firstDocument).toEqual({ v: 1, revisions: [fulfilled[0]!.value] });
      const immutableFirstBytes = JSON.stringify(firstDocument.revisions[0]);

      const second = await submitPublicSupplierQuote(
        { token: tokenA, quote: submission(1, 'A', '30') },
        app,
      );
      expect(second).toEqual(expect.objectContaining({ revision: 2 }));
      const storedAfterSecond = await admin.supplierRequest.findUniqueOrThrow({
        where: { id: 'supplier-request-a' },
      });
      const secondDocument = storedAfterSecond.quoteRevisions as {
        v: number;
        revisions: QuoteRevisionV1[];
      };
      expect(storedAfterSecond.quoteRevision).toBe(2);
      expect(secondDocument.revisions).toHaveLength(2);
      expect(JSON.stringify(secondDocument.revisions[0])).toBe(immutableFirstBytes);

      const latestOnly = await getPublicQuoteRequest({ token: tokenA }, app);
      expect(latestOnly.latestQuote).toEqual(second);
      expect(latestOnly).not.toHaveProperty('quoteRevisions');
      expect(JSON.stringify(latestOnly)).not.toContain(immutableFirstBytes);

      expect(await admin.auditEvent.findMany({
        where: { action: 'quote.submitted' },
        orderBy: { createdAt: 'asc' },
        select: {
          actorUserId: true,
          entityType: true,
          entityId: true,
          metadata: true,
        },
      })).toEqual([
        {
          actorUserId: null,
          entityType: 'SupplierRequest',
          entityId: 'supplier-request-a',
          metadata: { revision: 1, itemCount: 2 },
        },
        {
          actorUserId: null,
          entityType: 'SupplierRequest',
          entityId: 'supplier-request-a',
          metadata: { revision: 2, itemCount: 2 },
        },
      ]);

      await admin.supplierRequest.update({
        where: { id: 'supplier-request-a' },
        data: { quoteRevision: 3 },
      });
      await expect(getPublicQuoteRequest({ token: tokenA }, app)).rejects
        .toBeInstanceOf(PublicQuoteStorageCorruptionError);
      await admin.supplierRequest.update({
        where: { id: 'supplier-request-a' },
        data: { quoteRevision: 2 },
      });
      await admin.supplierRequest.update({
        where: { id: 'supplier-request-a' },
        data: {
          quoteRevisions: {
            ...secondDocument,
            unexpected: true,
          },
        },
      });
      await expect(getPublicQuoteRequest({ token: tokenA }, app)).rejects
        .toBeInstanceOf(PublicQuoteStorageCorruptionError);
      await admin.supplierRequest.update({
        where: { id: 'supplier-request-a' },
        data: { quoteRevisions: secondDocument },
      });

      let releaseRowA!: () => void;
      let reportRowALocked!: () => void;
      const rowAReleased = new Promise<void>((resolve) => {
        releaseRowA = resolve;
      });
      const rowALocked = new Promise<void>((resolve) => {
        reportRowALocked = resolve;
      });
      const rowAHolder = admin.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "SupplierRequest"
          WHERE "id" = 'supplier-request-a'
          FOR UPDATE
        `;
        reportRowALocked();
        await rowAReleased;
      });
      await rowALocked;
      const independent = submitPublicSupplierQuote(
        { token: tokenB, quote: submission(0, 'B') },
        app,
      );
      let independentTimer: ReturnType<typeof setTimeout> | undefined;
      const independentResult = await Promise.race([
        independent,
        new Promise<never>((_resolve, reject) => {
          independentTimer = setTimeout(
            () => reject(new Error('Distinct SupplierRequest submission blocked.')),
            1_500,
          );
        }),
      ]);
      if (independentTimer) clearTimeout(independentTimer);
      expect(independentResult.revision).toBe(1);
      releaseRowA();
      await rowAHolder;

      let releaseRevoke!: () => void;
      let reportRevokeLocked!: () => void;
      const revokeReleased = new Promise<void>((resolve) => {
        releaseRevoke = resolve;
      });
      const revokeLocked = new Promise<void>((resolve) => {
        reportRevokeLocked = resolve;
      });
      const revoker = admin.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "SupplierRequest"
          WHERE "id" = 'supplier-request-b'
          FOR UPDATE
        `;
        reportRevokeLocked();
        await revokeReleased;
        await transaction.supplierRequest.update({
          where: { id: 'supplier-request-b' },
          data: { revokedAt: new Date() },
        });
      });
      await revokeLocked;
      const afterRevoke = submitPublicSupplierQuote(
        { token: tokenB, quote: submission(1, 'B') },
        app,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseRevoke();
      await revoker;
      await expect(afterRevoke).rejects.toMatchObject({
        code: 'PUBLIC_QUOTE_UNAVAILABLE',
        status: 410,
      });

      const deactivated = await deactivateSupplier(
        {
          actor: { tenantId: 'quote-tenant', userId: 'quote-owner' },
          supplierId: 'supplier-a',
        },
        app,
      );
      expect(deactivated.isActive).toBe(false);
      expect((await admin.supplierRequest.findUniqueOrThrow({
        where: { id: 'supplier-request-a' },
      })).revokedAt).toEqual(expect.any(Date));
      await expect(getPublicQuoteRequest({ token: tokenA }, app)).rejects
        .toMatchObject({ code: 'PUBLIC_QUOTE_UNAVAILABLE', status: 410 });
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
