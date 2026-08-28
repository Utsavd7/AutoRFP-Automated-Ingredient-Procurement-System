import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { withTenant } from '@/lib/db/tenant-transaction';

import { withMigratedPostgres } from './setup/postgres';

const tenantTables = [
  'AuditEvent',
  'Award',
  'AwardLine',
  'ExternalIdentity',
  'Ingredient',
  'Invitation',
  'Menu',
  'ProcurementRequest',
  'Recipe',
  'RequestItem',
  'Supplier',
  'SupplierQuote',
  'SupplierQuoteItem',
  'SupplierRequest',
  'Tenant',
  'User',
] as const;

const runtimeTables = [...tenantTables, 'RateLimitBucket'].sort();

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

async function provisionAppClient(admin: PrismaClient, databaseUrl: string) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(
    `ALTER ROLE autorfp_app PASSWORD '${password}'`,
  );
  const client = new PrismaClient({
    datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
  });
  await client.$connect();
  return client;
}

async function seedTenant(admin: PrismaClient, id: string, suffix: string) {
  return admin.tenant.create({
    data: {
      id,
      name: `${suffix} Kitchen`,
      addressLine: `${suffix} Road`,
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001',
      phone: `90000000${suffix === 'A' ? '01' : '02'}`,
      users: {
        create: {
          id: `owner-${suffix.toLowerCase()}`,
          name: `${suffix} Owner`,
          email: `owner-${suffix.toLowerCase()}@example.test`,
          role: 'OWNER',
        },
      },
      suppliers: {
        create: {
          id: `supplier-${suffix.toLowerCase()}`,
          businessName: `${suffix} Produce`,
        },
      },
    },
  });
}

test('forced RLS isolates every tenant transaction under the restricted runtime role', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    let app: PrismaClient | undefined;

    try {
      await seedTenant(admin, 'tenant-a', 'A');
      await seedTenant(admin, 'tenant-b', 'B');
      app = await provisionAppClient(admin, databaseUrl);

      await expect(assertRuntimeDatabaseRole(app)).resolves.toBeUndefined();
      await expect(assertRuntimeDatabaseRole(admin)).rejects.toMatchObject({
        code: 'UNSAFE_DATABASE_ROLE',
      });
      const adminCallback = jest.fn();
      await expect(
        withTenant('tenant-a', adminCallback, admin),
      ).rejects.toMatchObject({ code: 'UNSAFE_DATABASE_ROLE' });
      expect(adminCallback).not.toHaveBeenCalled();

      const [role] = await admin.$queryRaw<
        Array<{
          rolname: string;
          rolsuper: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolcanlogin: boolean;
          rolbypassrls: boolean;
        }>
      >`
        SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin,
               rolbypassrls
        FROM pg_roles
        WHERE rolname = 'autorfp_app'
      `;
      expect(role).toEqual({
        rolname: 'autorfp_app',
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolcanlogin: true,
        rolbypassrls: false,
      });

      await admin.$executeRawUnsafe(
        'CREATE ROLE inherited_runtime_bypass NOLOGIN BYPASSRLS',
      );
      await admin.$executeRawUnsafe(
        'GRANT inherited_runtime_bypass TO autorfp_app',
      );
      const inheritedClient = await provisionAppClient(admin, databaseUrl);
      await expect(
        assertRuntimeDatabaseRole(inheritedClient),
      ).rejects.toMatchObject({ code: 'UNSAFE_DATABASE_ROLE' });
      const inheritedCallback = jest.fn();
      await expect(
        withTenant('tenant-a', inheritedCallback, inheritedClient),
      ).rejects.toMatchObject({ code: 'UNSAFE_DATABASE_ROLE' });
      expect(inheritedCallback).not.toHaveBeenCalled();
      await inheritedClient.$disconnect();
      await admin.$executeRawUnsafe(
        'REVOKE inherited_runtime_bypass FROM autorfp_app',
      );
      await admin.$executeRawUnsafe('DROP ROLE inherited_runtime_bypass');

      const protectedTables = await admin.$queryRaw<
        Array<{ table_name: string; enabled: boolean; forced: boolean }>
      >`
        SELECT c.relname AS table_name,
               c.relrowsecurity AS enabled,
               c.relforcerowsecurity AS forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY(${tenantTables as unknown as string[]}::text[])
        ORDER BY c.relname
      `;
      expect(protectedTables).toEqual(
        [...tenantTables].sort().map((table_name) => ({
          table_name,
          enabled: true,
          forced: true,
        })),
      );
      const policies = await admin.$queryRaw<
        Array<{
          tablename: string;
          policyname: string;
          roles: string[];
          cmd: string;
        }>
      >`
        SELECT tablename, policyname, roles, cmd
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY(${tenantTables as unknown as string[]}::text[])
        ORDER BY tablename
      `;
      expect(policies).toEqual(
        [...tenantTables].sort().map((tablename) => ({
          tablename,
          policyname: 'tenant_isolation',
          roles: ['autorfp_app'],
          cmd: 'ALL',
        })),
      );

      const grantedTables = await admin.$queryRaw<Array<{ table_name: string }>>`
        SELECT DISTINCT table_name
        FROM information_schema.role_table_grants
        WHERE grantee = 'autorfp_app'
          AND table_schema = 'public'
        ORDER BY table_name
      `;
      expect(grantedTables.map(({ table_name }) => table_name)).toEqual(
        runtimeTables,
      );
      await expect(
        app.$queryRaw`SELECT migration_name FROM "_prisma_migrations"`,
      ).rejects.toThrow(/permission denied/i);

      await expect(app.tenant.findMany()).resolves.toEqual([]);
      await expect(app.user.findMany()).resolves.toEqual([]);
      await expect(app.supplier.findMany()).resolves.toEqual([]);

      const tenantAView = await withTenant(
        'tenant-a',
        (tx) => tx.supplier.findMany({ orderBy: { businessName: 'asc' } }),
        app,
      );
      expect(tenantAView.map(({ id }) => id)).toEqual(['supplier-a']);

      await expect(
        withTenant(
          'tenant-a',
          (tx) =>
            tx.supplier.create({
              data: {
                id: 'cross-tenant-insert',
                tenantId: 'tenant-b',
                businessName: 'Forbidden Produce',
              },
            }),
          app,
        ),
      ).rejects.toThrow(/row-level security/i);

      const crossTenantUpdate = await withTenant(
        'tenant-a',
        (tx) =>
          tx.supplier.updateMany({
            where: { id: 'supplier-b' },
            data: { businessName: 'Changed by A' },
          }),
        app,
      );
      expect(crossTenantUpdate.count).toBe(0);

      const crossTenantDelete = await withTenant(
        'tenant-a',
        (tx) => tx.supplier.deleteMany({ where: { id: 'supplier-b' } }),
        app,
      );
      expect(crossTenantDelete.count).toBe(0);

      await withTenant(
        'tenant-a',
        async (tx) => {
          await tx.supplier.create({
            data: {
              id: 'supplier-a-temporary',
              tenantId: 'tenant-a',
              businessName: 'Temporary Produce',
            },
          });
          await tx.supplier.update({
            where: { id: 'supplier-a-temporary' },
            data: { businessName: 'Updated Produce' },
          });
          await tx.supplier.delete({ where: { id: 'supplier-a-temporary' } });
        },
        app,
      );

      const parallelReads = await Promise.all(
        Array.from({ length: 16 }, (_, index) => {
          const tenantId = index % 2 === 0 ? 'tenant-a' : 'tenant-b';
          const expectedSupplier = index % 2 === 0 ? 'supplier-a' : 'supplier-b';
          return withTenant(
            tenantId,
            async (tx) => {
              const rows = await tx.supplier.findMany();
              return { expectedSupplier, ids: rows.map(({ id }) => id) };
            },
            app,
          );
        }),
      );
      for (const result of parallelReads) {
        expect(result.ids).toEqual([result.expectedSupplier]);
      }

      await expect(app.supplier.findMany()).resolves.toEqual([]);
      expect(await admin.supplier.findUnique({ where: { id: 'supplier-b' } }))
        .toEqual(expect.objectContaining({ businessName: 'B Produce' }));
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
