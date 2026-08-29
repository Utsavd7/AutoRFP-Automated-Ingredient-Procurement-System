import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { withMigratedPostgres, withPostgres } from './setup/postgres';

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
        expect.objectContaining({
          migration_name: '20260827000300_forced_rls',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000400_member_invitations',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000500_menu_recipe_retirement',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000600_public_supplier_grants',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000700_quote_integrity',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000800_award_snapshot_capacity',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000900_minimal_launch_columns',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827001000_backup_role',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });
});

function ownerGuard(migration: string) {
  const sql = readFileSync(
    path.resolve(__dirname, `../../prisma/migrations/${migration}/migration.sql`),
    'utf8',
  );
  return sql.slice(
    sql.indexOf('DO $migration_owner$'),
    sql.indexOf('$migration_owner$;') + '$migration_owner$;'.length,
  );
}

test('early owner guards accept inherited bypass capability without provider usernames', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    await migrateTo('20260827000200_launch_schema');
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await admin.$executeRawUnsafe(
        'CREATE ROLE neon_superuser_compat NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOLOGIN',
      );
      await admin.$executeRawUnsafe(
        'CREATE ROLE neon_launch_owner NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOLOGIN',
      );
      await admin.$executeRawUnsafe(
        'GRANT neon_superuser_compat TO neon_launch_owner',
      );
      await admin.$executeRawUnsafe(
        'CREATE SCHEMA autorfp_private AUTHORIZATION neon_launch_owner',
      );
      for (const table of expectedTables) {
        await admin.$executeRawUnsafe(
          `ALTER TABLE public."${table}" OWNER TO neon_launch_owner`,
        );
      }

      for (const migration of [
        '20260827000300_forced_rls',
        '20260827000400_member_invitations',
        '20260827000500_menu_recipe_retirement',
        '20260827000600_public_supplier_grants',
      ]) {
        await expect(
          admin.$transaction(async (transaction) => {
            await transaction.$executeRawUnsafe('SET LOCAL ROLE neon_launch_owner');
            await transaction.$executeRawUnsafe(ownerGuard(migration));
          }),
        ).resolves.toBeUndefined();
      }
    } finally {
      await admin.$disconnect();
    }
  });
});

test('forced-RLS migration runs as a managed Postgres owner without true superuser', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo, applyMigrationAs }) => {
    await migrateTo('20260827000200_launch_schema');
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = 'managed_owner_test_password';
    const managedOwnerUrl = new URL(databaseUrl);
    managedOwnerUrl.username = 'managed_migration_owner';
    managedOwnerUrl.password = password;

    try {
      await admin.$executeRawUnsafe(
        `CREATE ROLE managed_migration_owner LOGIN NOSUPERUSER NOCREATEDB CREATEROLE INHERIT NOREPLICATION BYPASSRLS PASSWORD '${password}'`,
      );
      await admin.$executeRawUnsafe(
        'ALTER SCHEMA public OWNER TO managed_migration_owner',
      );
      const [{ database_name }] = await admin.$queryRaw<
        Array<{ database_name: string }>
      >`SELECT current_database() AS database_name`;
      await admin.$executeRawUnsafe(
        `GRANT CREATE ON DATABASE "${database_name.replaceAll('"', '""')}" TO managed_migration_owner`,
      );
      for (const table of expectedTables) {
        await admin.$executeRawUnsafe(
          `ALTER TABLE public."${table}" OWNER TO managed_migration_owner`,
        );
      }

      await expect(
        applyMigrationAs(
          '20260827000300_forced_rls',
          managedOwnerUrl.toString(),
        ),
      ).resolves.toBeUndefined();

      const [runtimeRole] = await admin.$queryRaw<
        Array<{
          rolcanlogin: boolean;
          rolsuper: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolinherit: boolean;
          rolreplication: boolean;
          rolbypassrls: boolean;
        }>
      >`
        SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
               rolreplication, rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname = 'autorfp_app'
      `;

      expect(runtimeRole).toEqual({
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolbypassrls: false,
      });
    } finally {
      await admin.$disconnect();
    }
  });
});

test('all migrations run as a managed Postgres database owner without true superuser', async () => {
  await withPostgres(async ({ databaseUrl, applyMigrationAs }) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = 'managed_database_owner_test_password';
    const managedOwnerUrl = new URL(databaseUrl);
    managedOwnerUrl.username = 'managed_database_owner';
    managedOwnerUrl.password = password;

    try {
      await admin.$executeRawUnsafe(
        `CREATE ROLE managed_database_owner LOGIN NOSUPERUSER NOCREATEDB CREATEROLE INHERIT NOREPLICATION BYPASSRLS PASSWORD '${password}'`,
      );
      await admin.$executeRawUnsafe(
        'CREATE ROLE autorfp_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS',
      );
      await admin.$executeRawUnsafe(
        'GRANT autorfp_backup TO managed_database_owner WITH ADMIN OPTION',
      );
      const [{ database_name }] = await admin.$queryRaw<
        Array<{ database_name: string }>
      >`SELECT current_database() AS database_name`;
      await admin.$executeRawUnsafe(
        `ALTER DATABASE "${database_name.replaceAll('"', '""')}" OWNER TO managed_database_owner`,
      );

      for (const migration of [
        '20260827000100_lean_baseline',
        '20260827000200_launch_schema',
        '20260827000300_forced_rls',
        '20260827000400_member_invitations',
        '20260827000500_menu_recipe_retirement',
        '20260827000600_public_supplier_grants',
        '20260827000700_quote_integrity',
        '20260827000800_award_snapshot_capacity',
        '20260827000900_minimal_launch_columns',
        '20260827001000_backup_role',
      ] as const) {
        await applyMigrationAs(migration, managedOwnerUrl.toString());
      }

      const roles = await admin.$queryRaw<
        Array<{
          rolname: string;
          rolcanlogin: boolean;
          rolsuper: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolinherit: boolean;
          rolreplication: boolean;
          rolbypassrls: boolean;
        }>
      >`
        SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
               rolinherit, rolreplication, rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname IN ('autorfp_app', 'autorfp_backup')
        ORDER BY rolname
      `;

      expect(roles).toEqual([
        {
          rolname: 'autorfp_app',
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
        },
        {
          rolname: 'autorfp_backup',
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: true,
        },
      ]);
    } finally {
      await admin.$disconnect();
    }
  });
});

test('forced-RLS migration rejects a pre-created runtime role with privileged membership', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    await migrateTo('20260827000200_launch_schema');
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await admin.$executeRawUnsafe(
        'CREATE ROLE provider_console_admin NOLOGIN BYPASSRLS',
      );
      await admin.$executeRawUnsafe(
        'CREATE ROLE autorfp_app LOGIN INHERIT NOBYPASSRLS',
      );
      await admin.$executeRawUnsafe(
        'GRANT provider_console_admin TO autorfp_app',
      );

      await expect(
        migrateTo('20260827000300_forced_rls'),
      ).rejects.toThrow(/must not inherit a row-security-bypassing role/i);
    } finally {
      await admin.$disconnect();
    }
  });
});
