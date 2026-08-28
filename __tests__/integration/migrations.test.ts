import { PrismaClient } from '@prisma/client';

import { withMigratedPostgres } from './setup/postgres';

const expectedTables = [
  'AuditEvent',
  'Award',
  'AwardLine',
  'ExternalIdentity',
  'Ingredient',
  'Invitation',
  'Menu',
  'ProcurementRequest',
  'RateLimitBucket',
  'Recipe',
  'RequestItem',
  'Supplier',
  'SupplierQuote',
  'SupplierQuoteItem',
  'SupplierRequest',
  'Tenant',
  'User',
];

test('deploys every migration to an empty PostgreSQL database without schema drift', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    try {
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;
      const migrations = await prisma.$queryRaw<
        Array<{
          migration_name: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>
      >`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at
      `;

      expect(tables.map(({ tablename }) => tablename).sort()).toEqual([
        ...expectedTables,
        '_prisma_migrations',
      ].sort());
      expect(migrations).toEqual([
        expect.objectContaining({
          migration_name: '20260827000100_lean_baseline',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000200_launch_schema',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
