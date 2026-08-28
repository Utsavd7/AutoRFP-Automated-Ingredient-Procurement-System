import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { withMigratedPostgres } from './setup/postgres';

function backupDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_backup';
  url.password = password;
  return url.toString();
}

test('backup role reads every tenant through forced RLS without write access', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let backup: PrismaClient | undefined;

    try {
      await admin.tenant.createMany({
        data: [
          {
            id: 'backup-tenant-a',
            name: 'A Kitchen',
            addressLine: 'A Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            pin: '400001',
            phone: '9000000001',
          },
          {
            id: 'backup-tenant-b',
            name: 'B Kitchen',
            addressLine: 'B Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            pin: '400002',
            phone: '9000000002',
          },
        ],
      });

      const password = randomBytes(24).toString('hex');
      await admin.$executeRawUnsafe(
        `ALTER ROLE autorfp_backup PASSWORD '${password}'`,
      );
      backup = new PrismaClient({
        datasources: { db: { url: backupDatabaseUrl(databaseUrl, password) } },
      });
      await backup.$connect();

      const [role] = await admin.$queryRaw<
        Array<{
          rolname: string;
          rolsuper: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolinherit: boolean;
          rolreplication: boolean;
          rolcanlogin: boolean;
          rolbypassrls: boolean;
          memberships: bigint;
        }>
      >`
        SELECT role.rolname,
               role.rolsuper,
               role.rolcreatedb,
               role.rolcreaterole,
               role.rolinherit,
               role.rolreplication,
               role.rolcanlogin,
               role.rolbypassrls,
               (
                 SELECT COUNT(*)::BIGINT
                 FROM pg_auth_members AS membership
                 WHERE membership.member = role.oid
               ) AS memberships
        FROM pg_roles AS role
        WHERE role.rolname = 'autorfp_backup'
      `;
      expect(role).toEqual({
        rolname: 'autorfp_backup',
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolcanlogin: true,
        rolbypassrls: true,
        memberships: BigInt(0),
      });

      const [tableAccess] = await admin.$queryRaw<
        Array<{ can_select_all: boolean; can_write_any: boolean }>
      >`
        SELECT
          bool_and(
            has_table_privilege('autorfp_backup', relation.oid, 'SELECT')
          ) AS can_select_all,
          bool_or(
            has_table_privilege(
              'autorfp_backup',
              relation.oid,
              'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
            )
          ) AS can_write_any
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      `;
      expect(tableAccess).toEqual({
        can_select_all: true,
        can_write_any: false,
      });

      const [functionAccess] = await admin.$queryRaw<
        Array<{ can_execute_any: boolean }>
      >`
        SELECT COALESCE(
          bool_or(
            has_function_privilege('autorfp_backup', procedure.oid, 'EXECUTE')
          ),
          false
        ) AS can_execute_any
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'autorfp_private'
      `;
      expect(functionAccess.can_execute_any).toBe(false);

      await expect(
        backup.tenant.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
      ).resolves.toEqual([
        { id: 'backup-tenant-a' },
        { id: 'backup-tenant-b' },
      ]);
      await expect(
        backup.$queryRaw`SELECT migration_name FROM "_prisma_migrations" LIMIT 1`,
      ).resolves.toHaveLength(1);
      await expect(
        backup.tenant.updateMany({ data: { name: 'Forbidden' } }),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        backup.tenant.deleteMany(),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await backup?.$disconnect();
      await admin.$disconnect();
    }
  });
});
