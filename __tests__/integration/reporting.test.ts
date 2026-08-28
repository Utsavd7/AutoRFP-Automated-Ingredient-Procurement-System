import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { listProcurementHistory } from '@/lib/reporting/reporting-service';

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
  const client = new PrismaClient({ datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } } });
  await client.$connect();
  return client;
}

async function seedHistory(admin: PrismaClient, suffix: string) {
  const tenantId = `tenant-${suffix}`;
  const userId = `user-${suffix}`;
  await admin.tenant.create({
    data: {
      id: tenantId,
      name: `${suffix} Kitchen`,
      addressLine: '1 Market Road',
      city: suffix === 'a' ? 'Mumbai' : 'Private City',
      state: 'Maharashtra',
      pin: suffix === 'a' ? '400001' : '499999',
      phone: '9000000000',
      users: { create: { id: userId, name: `${suffix} Buyer`, email: `${suffix}@example.test`, role: 'MEMBER' } },
    },
  });
  const supplier = await admin.supplier.create({
    data: { id: `supplier-${suffix}`, tenantId, businessName: `${suffix} Fresh Foods` },
  });
  const request = await admin.procurementRequest.create({
    data: {
      id: `request-${suffix}`, tenantId, title: `${suffix} Produce`, status: 'OPEN',
      deliveryDetails: { addressLine: '1 Market Road' },
      deliveryDate: new Date('2026-09-05T00:00:00.000Z'),
      quoteDeadline: new Date('2026-09-03T08:00:00.000Z'),
      openedAt: new Date('2026-08-28T08:00:00.000Z'),
      createdAt: new Date('2026-08-28T07:00:00.000Z'),
      createdByUserId: userId,
    },
  });
  const grant = await admin.supplierRequest.create({
    data: {
      id: `grant-${suffix}`, tenantId, requestId: request.id, supplierId: supplier.id,
      tokenDigest: randomBytes(32).toString('hex'),
      expiresAt: new Date('2026-09-03T08:00:00.000Z'),
    },
  });
  const quoteCount = suffix === 'a' ? 2 : 1;
  for (let revision = 1; revision <= quoteCount; revision += 1) {
    await admin.supplierQuote.create({
      data: {
        id: `quote-${suffix}-${revision}`, tenantId, supplierRequestId: grant.id, revision,
        subtotalPaise: 80_000 + revision, gstPaise: 4_000, freightPaise: 500,
        totalPaise: 84_500 + revision,
        deliveryDate: new Date('2026-09-05T00:00:00.000Z'),
        validUntil: new Date('2026-09-04T00:00:00.000Z'),
        submittedAt: new Date(Date.UTC(2026, 7, 28, 8 + revision)),
      },
    });
  }
  if (suffix === 'a') {
    await admin.procurementRequest.update({
      where: { id: request.id },
      data: {
        status: 'AWARDED',
        awardedAt: new Date('2026-08-28T11:00:00.000Z'),
      },
    });
    await admin.award.create({
      data: {
        id: 'award-a',
        tenantId,
        requestId: request.id,
        supplierSnapshots: [{
          supplierId: supplier.id,
          supplierName: supplier.businessName,
          email: 'private-snapshot@example.test',
          phone: '9999999999',
        }],
        deliverySnapshot: { requestTitle: request.title },
        totalPaise: 84_502,
        awardedByUserId: userId,
        createdAt: new Date('2026-08-28T11:00:00.000Z'),
      },
    });
    await admin.procurementRequest.create({
      data: {
        id: 'draft-a', tenantId, title: 'Unissued private draft', status: 'DRAFT',
        deliveryDetails: { addressLine: '1 Market Road' },
        deliveryDate: new Date('2026-09-06T00:00:00.000Z'),
        quoteDeadline: new Date('2026-09-04T08:00:00.000Z'),
        openedAt: null,
        createdAt: new Date('2026-08-28T12:00:00.000Z'),
        createdByUserId: userId,
      },
    });
  }
  await admin.auditEvent.createMany({ data: [
    {
      id: `audit-${suffix}-opened`, tenantId, actorUserId: userId,
      action: 'request.opened', entityType: 'ProcurementRequest', entityId: request.id,
      metadata: { itemCount: 1, supplierCount: 1 },
      createdAt: new Date('2026-08-28T08:00:00.000Z'),
    },
    {
      id: `audit-${suffix}-quote`, tenantId, actorUserId: null,
      action: 'quote.submitted', entityType: 'SupplierQuote', entityId: `quote-${suffix}-${quoteCount}`,
      metadata: { revision: quoteCount, itemCount: 1 },
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    },
  ] });
  return { tenantId, userId };
}

test('history exposes bounded quote revisions and allow-listed activity through tenant RLS', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      const a = await seedHistory(admin, 'a');
      await seedHistory(admin, 'private-b');
      app = await provisionAppClient(admin, databaseUrl);

      const history = await listProcurementHistory({
        actor: { tenantId: a.tenantId, userId: a.userId },
        limit: 25,
      }, app);

      expect(history.requests).toEqual([
        expect.objectContaining({
          id: 'request-a', respondingSupplierCount: 1, quoteRevisionCount: 2,
          award: expect.objectContaining({ supplierCount: 1 }),
        }),
      ]);
      expect(history.recentQuoteRevisions).toHaveLength(2);
      expect(history.recentQuoteRevisions[0]).toMatchObject({
        requestId: 'request-a', supplierName: 'a Fresh Foods', revision: 2,
      });
      expect(history.recentActivity).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Supplier sent quote version 2', actorName: 'Supplier' }),
        expect.objectContaining({ label: 'Request sent to suppliers', actorName: 'a Buyer' }),
      ]));
      expect(JSON.stringify(history)).not.toMatch(
        /private-b|Private City|Unissued private draft|private-snapshot@example\.test|9999999999|supplierSnapshots/,
      );
      expect(history.recentActivity.every((event) => !Object.hasOwn(event, 'metadata'))).toBe(true);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
