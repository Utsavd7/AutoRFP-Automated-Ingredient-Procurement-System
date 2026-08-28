import { PrismaClient } from '@prisma/client';

import { withPostgres } from './setup/postgres';

const supabaseRoles = [
  'anon',
  'authenticated',
  'service_role',
  'authenticator',
] as const;

const appTables = [
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
] as const;

test('security migrations remove simulated Supabase grants and default ACLs', async () => {
  await withPostgres(async (harness) => {
    await harness.migrateTo('20260827000200_launch_schema');
    const admin = new PrismaClient({
      datasources: { db: { url: harness.databaseUrl } },
    });

    try {
      for (const role of supabaseRoles) {
        await admin.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
        await admin.$executeRawUnsafe(
          `GRANT CREATE, USAGE ON SCHEMA public TO ${role}`,
        );
        await admin.$executeRawUnsafe(
          `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${role}`,
        );
        await admin.$executeRawUnsafe(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role}`,
        );
        await admin.$executeRawUnsafe(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`,
        );
      }

      await harness.migrateTo('20260827000300_forced_rls');
      await harness.migrateTo('20260827000400_member_invitations');

      const tablePrivileges = await admin.$queryRaw<
        Array<{
          role_name: string;
          table_name: string;
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
          can_truncate: boolean;
        }>
      >`
        SELECT
          role_name,
          table_name,
          has_table_privilege(
            role_name,
            format('public.%I', table_name),
            'SELECT'
          ) AS can_select,
          has_table_privilege(
            role_name,
            format('public.%I', table_name),
            'INSERT'
          ) AS can_insert,
          has_table_privilege(
            role_name,
            format('public.%I', table_name),
            'UPDATE'
          ) AS can_update,
          has_table_privilege(
            role_name,
            format('public.%I', table_name),
            'DELETE'
          ) AS can_delete,
          has_table_privilege(
            role_name,
            format('public.%I', table_name),
            'TRUNCATE'
          ) AS can_truncate
        FROM unnest(${supabaseRoles as unknown as string[]}::text[]) AS role_name
        CROSS JOIN unnest(${appTables as unknown as string[]}::text[]) AS table_name
      `;
      expect(tablePrivileges).toHaveLength(supabaseRoles.length * appTables.length);
      expect(tablePrivileges).toEqual(
        expect.arrayContaining(
          tablePrivileges.map((row) => ({
            role_name: row.role_name,
            table_name: row.table_name,
            can_select: false,
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_truncate: false,
          })),
        ),
      );

      const schemaPrivileges = await admin.$queryRaw<
        Array<{
          role_name: string;
          private_usage: boolean;
          private_create: boolean;
          public_usage: boolean;
          public_create: boolean;
        }>
      >`
        SELECT
          role_name,
          has_schema_privilege(role_name, 'autorfp_private', 'USAGE')
            AS private_usage,
          has_schema_privilege(role_name, 'autorfp_private', 'CREATE')
            AS private_create,
          has_schema_privilege(role_name, 'public', 'USAGE') AS public_usage,
          has_schema_privilege(role_name, 'public', 'CREATE') AS public_create
        FROM unnest(${supabaseRoles as unknown as string[]}::text[]) AS role_name
      `;
      expect(schemaPrivileges).toEqual(
        supabaseRoles.map((role_name) => ({
          role_name,
          private_usage: false,
          private_create: false,
          public_usage: false,
          public_create: false,
        })),
      );

      const functionPrivileges = await admin.$queryRaw<
        Array<{ role_name: string; proname: string; can_execute: boolean }>
      >`
        SELECT role_name, procedure.proname,
               has_function_privilege(role_name, procedure.oid, 'EXECUTE')
                 AS can_execute
        FROM unnest(${supabaseRoles as unknown as string[]}::text[]) AS role_name
        CROSS JOIN pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'autorfp_private'
        ORDER BY role_name, procedure.proname
      `;
      expect(functionPrivileges).toHaveLength(supabaseRoles.length * 5);
      expect(functionPrivileges.every(({ can_execute }) => !can_execute)).toBe(
        true,
      );

      const publicAclLeaks = await admin.$queryRaw<Array<{ leak_count: bigint }>>`
        SELECT count(*)::BIGINT AS leak_count
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        CROSS JOIN LATERAL aclexplode(
          COALESCE(relation.relacl, acldefault('r', relation.relowner))
        ) AS permission
        WHERE namespace.nspname = 'public'
          AND relation.relname = ANY(${appTables as unknown as string[]}::text[])
          AND permission.grantee = 0
      `;
      expect(publicAclLeaks[0].leak_count).toBe(BigInt(0));

      const defaultAclLeaks = await admin.$queryRaw<Array<{ leak_count: bigint }>>`
        SELECT count(*)::BIGINT AS leak_count
        FROM pg_default_acl AS defaults
        JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
        CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS permission
        LEFT JOIN pg_roles AS grantee ON grantee.oid = permission.grantee
        WHERE namespace.nspname IN ('public', 'autorfp_private')
          AND (
            permission.grantee = 0
            OR grantee.rolname = ANY(${supabaseRoles as unknown as string[]}::text[])
          )
      `;
      expect(defaultAclLeaks[0].leak_count).toBe(BigInt(0));

      const globalFunctionDefaultAclLeaks = await admin.$queryRaw<
        Array<{ leak_count: bigint }>
      >`
        SELECT count(*)::BIGINT AS leak_count
        FROM pg_default_acl AS defaults
        CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS permission
        WHERE defaults.defaclnamespace = 0
          AND defaults.defaclobjtype = 'f'
          AND permission.grantee = 0
          AND permission.privilege_type = 'EXECUTE'
      `;
      expect(globalFunctionDefaultAclLeaks[0].leak_count).toBe(BigInt(0));

      await admin.$executeRawUnsafe(`
        CREATE FUNCTION autorfp_private.autorfp_acl_probe()
        RETURNS INTEGER
        LANGUAGE sql
        SET search_path = pg_catalog
        AS 'SELECT 1'
      `);
      const [probeBeforeGrant] = await admin.$queryRaw<
        Array<{ can_execute: boolean }>
      >`
        SELECT has_function_privilege(
          'autorfp_app',
          'autorfp_private.autorfp_acl_probe()',
          'EXECUTE'
        ) AS can_execute
      `;
      expect(probeBeforeGrant.can_execute).toBe(false);
      await expect(
        admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe('SET LOCAL ROLE autorfp_app');
          return transaction.$queryRaw<Array<{ probe: number }>>`
            SELECT autorfp_private.autorfp_acl_probe() AS probe
          `;
        }),
      ).rejects.toThrow();

      await admin.$executeRawUnsafe(`
        GRANT EXECUTE ON FUNCTION autorfp_private.autorfp_acl_probe()
        TO autorfp_app
      `);
      const [probeAfterGrant] = await admin.$queryRaw<
        Array<{ can_execute: boolean }>
      >`
        SELECT has_function_privilege(
          'autorfp_app',
          'autorfp_private.autorfp_acl_probe()',
          'EXECUTE'
        ) AS can_execute
      `;
      expect(probeAfterGrant.can_execute).toBe(true);
      await expect(
        admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe('SET LOCAL ROLE autorfp_app');
          return transaction.$queryRaw<Array<{ probe: number }>>`
            SELECT autorfp_private.autorfp_acl_probe() AS probe
          `;
        }),
      ).resolves.toEqual([{ probe: 1 }]);

      const [appAccess] = await admin.$queryRaw<
        Array<{
          private_usage: boolean;
          can_execute: boolean;
          can_execute_invitation_bootstrap: boolean;
          can_update_rate_limit: boolean;
        }>
      >`
        SELECT
          has_schema_privilege('autorfp_app', 'autorfp_private', 'USAGE')
            AS private_usage,
          has_function_privilege(
            'autorfp_app',
            'autorfp_private.autorfp_auth_credentials_by_email(text)',
            'EXECUTE'
          ) AS can_execute,
          has_function_privilege(
            'autorfp_app',
            'autorfp_private.autorfp_invitation_tenant_by_digest(text)',
            'EXECUTE'
          ) AS can_execute_invitation_bootstrap,
          has_table_privilege(
            'autorfp_app',
            'public."RateLimitBucket"',
            'UPDATE'
          ) AS can_update_rate_limit
      `;
      expect(appAccess).toEqual({
        private_usage: true,
        can_execute: true,
        can_execute_invitation_bootstrap: true,
        can_update_rate_limit: true,
      });
    } finally {
      await admin.$disconnect();
    }
  });
});
