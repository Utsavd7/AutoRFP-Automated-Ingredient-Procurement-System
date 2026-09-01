import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import { createPrismaOverviewOperations } from '@/lib/overview/overview-service';

import { withMigratedPostgres } from './setup/postgres';
import {
  awardDocuments,
  emptyCapabilities,
  quoteRevisions,
  requestItems,
  requestSourcing,
} from './setup/compact-reporting-fixtures';

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

async function seedTenant(
  admin: PrismaClient,
  tenantId: string,
  userId: string,
  email: string,
) {
  await admin.tenant.create({
    data: {
      id: tenantId,
      name: `${tenantId} Kitchen`,
      addressLine: '1 Market Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001',
      phone: '9000000000',
      users: {
        create: {
          id: userId,
          name: `${userId} Name`,
          email,
          role: 'MEMBER',
        },
      },
    },
  });
}

async function seedTenantWork(
  admin: PrismaClient,
  input: { tenantId: string; userId: string; suffix: string; privateNoise?: boolean },
) {
  const supplier = await admin.supplier.create({
    data: {
      id: `supplier-${input.suffix}`,
      tenantId: input.tenantId,
      businessName: `${input.suffix} Produce`,
      capabilities: emptyCapabilities,
    },
  });
  await admin.supplier.create({
    data: {
      id: `supplier-inactive-${input.suffix}`,
      tenantId: input.tenantId,
      businessName: `${input.suffix} Inactive`,
      isActive: false,
      capabilities: emptyCapabilities,
    },
  });
  await admin.menu.createMany({
    data: [
      {
        id: `menu-draft-${input.suffix}`,
        tenantId: input.tenantId,
        name: `${input.suffix} draft menu`,
        status: 'DRAFT',
        document: { v: 1 },
        createdByUserId: input.userId,
      },
      {
        id: `menu-approved-${input.suffix}`,
        tenantId: input.tenantId,
        name: `${input.suffix} approved menu`,
        status: 'APPROVED',
        document: { v: 1 },
        approvedAt: new Date('2026-08-20T08:00:00.000Z'),
        approvedByUserId: input.userId,
        createdByUserId: input.userId,
      },
    ],
  });
  const items = requestItems({ name: 'Produce' });
  const sourcing = requestSourcing(supplier.id);
  await admin.procurementRequest.create({
    data: {
      id: `request-draft-${input.suffix}`,
      tenantId: input.tenantId,
      title: `${input.suffix} draft request`,
      status: 'DRAFT',
      deliveryDetails: { addressLine: '1 Market Road' },
      deliveryDate: new Date('2026-09-04T00:00:00.000Z'),
      quoteDeadline: new Date('2026-09-02T08:00:00.000Z'),
      items,
      sourcing,
      createdAt: new Date('2026-08-28T06:00:00.000Z'),
      createdByUserId: input.userId,
    },
  });
  await admin.procurementRequest.create({
    data: {
      id: `request-open-${input.suffix}`,
      tenantId: input.tenantId,
      title: `${input.suffix} open request`,
      status: 'OPEN',
      deliveryDetails: { addressLine: '1 Market Road' },
      deliveryDate: new Date('2026-09-03T00:00:00.000Z'),
      quoteDeadline: new Date('2026-09-01T08:00:00.000Z'),
      items,
      sourcing,
      openedAt: new Date('2026-08-28T08:00:00.000Z'),
      createdAt: new Date('2026-08-28T07:00:00.000Z'),
      createdByUserId: input.userId,
      supplierRequests: {
        create: {
          id: `grant-${input.suffix}`,
          tenant: { connect: { id: input.tenantId } },
          supplier: {
            connect: {
              tenantId_id: { tenantId: input.tenantId, id: supplier.id },
            },
          },
          tokenDigest: input.suffix.padEnd(64, input.privateNoise ? 'b' : 'a').slice(0, 64),
          expiresAt: new Date('2026-09-01T08:00:00.000Z'),
          quoteRevision: 1,
          quoteRevisions: quoteRevisions({ count: 1 }),
        },
      },
    },
  });
  const awarded = await admin.procurementRequest.create({
    data: {
      id: `request-awarded-${input.suffix}`,
      tenantId: input.tenantId,
      title: `${input.suffix} awarded request`,
      status: 'AWARDED',
      deliveryDetails: { addressLine: '1 Market Road' },
      deliveryDate: new Date('2026-08-31T00:00:00.000Z'),
      quoteDeadline: new Date('2026-08-29T08:00:00.000Z'),
      items,
      sourcing,
      awardedAt: new Date('2026-08-28T10:00:00.000Z'),
      createdAt: new Date('2026-08-28T08:00:00.000Z'),
      createdByUserId: input.userId,
    },
  });
  await admin.award.create({
    data: {
      id: `award-${input.suffix}`,
      tenantId: input.tenantId,
      requestId: awarded.id,
      ...awardDocuments({
        supplierId: supplier.id,
        supplierRequestId: `award-grant-${input.suffix}`,
        supplierName: supplier.businessName,
        totalPaise: input.privateNoise ? '99999999' : '9182949',
        requestTitle: awarded.title,
      }),
      totalPaise: input.privateNoise ? 99_999_999 : 9_182_949,
      awardedByUserId: input.userId,
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    },
  });
}

test('overview reads factual counts and records through tenant RLS without cross-tenant leakage', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      await seedTenant(admin, 'tenant-b', 'member-b', 'b@example.test');
      await seedTenantWork(admin, { tenantId: 'tenant-a', userId: 'member-a', suffix: 'a' });
      await seedTenantWork(admin, {
        tenantId: 'tenant-b',
        userId: 'member-b',
        suffix: 'private-b',
        privateNoise: true,
      });
      app = await provisionAppClient(admin, databaseUrl);
      const operations = createPrismaOverviewOperations(app);

      const overview = await operations.load({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
      });

      expect(overview.counts).toEqual({
        activeSuppliers: 1,
        menus: { draft: 1, approved: 1 },
        requests: { draft: 1, open: 1, awarded: 1 },
        quotesReceivedForOpenRequests: 1,
      });
      expect(overview.deadlines).toEqual([
        expect.objectContaining({
          requestId: 'request-open-a',
          title: 'a open request',
          suppliersInvited: 1,
          quotesReceived: 1,
        }),
      ]);
      expect(overview.recentAwards).toEqual([
        expect.objectContaining({
          requestId: 'request-awarded-a',
          title: 'a awarded request',
          totalPaise: '9182949',
        }),
      ]);
      expect(JSON.stringify(overview)).not.toContain('private-b');
      expect(JSON.stringify(overview)).not.toContain('99999999');

      await expect(
        operations.load({ actor: { tenantId: 'tenant-a', userId: 'member-b' } }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
