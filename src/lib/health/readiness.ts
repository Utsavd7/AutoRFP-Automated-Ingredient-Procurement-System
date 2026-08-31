import { NextResponse } from 'next/server';
import { Prisma, type PrismaClient } from '@prisma/client';

import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { validateRuntimeEnvironment } from '@/lib/env';

type ReadinessDatabaseClient = Pick<PrismaClient, '$queryRaw'>;

type ReadinessDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  checkDatabase: () => Promise<unknown>;
  timeoutMs: number;
};

function healthResponse(status: 200 | 503, state: 'ready' | 'unavailable') {
  return NextResponse.json(
    { status: state },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

async function within<T>(work: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Readiness timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function checkRuntimeDatabase(client: ReadinessDatabaseClient) {
  await assertRuntimeDatabaseRole(client);
  const [migration] = await client.$queryRaw<Array<{ migrationReady: boolean }>>(
    Prisma.sql`
      SELECT (
        (
          SELECT array_agg(tablename::TEXT ORDER BY tablename)
          FROM pg_catalog.pg_tables
          WHERE schemaname = 'public'
            AND tablename <> pg_catalog.concat('_prisma', '_migrations')
        ) = ARRAY[
          'AuditEvent', 'Award', 'Menu', 'ProcurementRequest',
          'RateLimitBucket', 'Supplier', 'SupplierRequest', 'Tenant', 'User'
        ]::TEXT[]
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public."Supplier"')
            AND attribute.attname = 'verifiedByUserId'
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attname IN (
            'legacyPasswordSalt', 'sourceIngredientId'
          )
            AND attribute.attrelid IN (
              to_regclass('public."User"'),
              to_regclass('public."Supplier"')
            )
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_namespace AS namespace
          WHERE namespace.nspname = 'autorfp_private'
            AND pg_catalog.obj_description(
              namespace.oid,
              'pg_namespace'
            ) = 'quoteplate:migration:20260831000100_compact_nine_table_schema'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM (
            VALUES
              ('AuditEvent_metadata_size_check', '16384'),
              ('Award_allocationLines_size_check', '2097152'),
              ('Award_deliverySnapshot_size_check', '16384'),
              ('Award_supplierSnapshots_size_check', '2097152'),
              ('Menu_document_size_check', '524288'),
              ('ProcurementRequest_deliveryDetails_size_check', '16384'),
              ('ProcurementRequest_items_size_check', '524288'),
              ('ProcurementRequest_sourcing_size_check', '65536'),
              ('Supplier_capabilities_size_check', '65536'),
              ('SupplierRequest_quoteRevisions_size_check', '2097152')
          ) AS expected(constraint_name, byte_cap)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_constraint AS constraint_catalog
            JOIN pg_catalog.pg_class AS table_catalog
              ON table_catalog.oid = constraint_catalog.conrelid
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = table_catalog.relnamespace
            WHERE namespace.nspname = 'public'
              AND constraint_catalog.contype = 'c'
              AND constraint_catalog.conname = expected.constraint_name
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_catalog.oid),
                'octet_length'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_catalog.oid),
                expected.byte_cap
              ) > 0
          )
        )
        AND (
          SELECT COUNT(*) = 7
            AND pg_catalog.bool_and(procedure.prosecdef)
            AND pg_catalog.bool_and(
              procedure.proconfig = ARRAY['search_path=pg_catalog']::TEXT[]
            )
            AND pg_catalog.bool_and(
              owner_role.rolsuper OR owner_role.rolbypassrls
            )
            AND pg_catalog.bool_and(
              pg_catalog.has_function_privilege(
                'autorfp_app', procedure.oid, 'EXECUTE'
              )
            )
          FROM pg_catalog.pg_proc AS procedure
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
          JOIN pg_catalog.pg_roles AS owner_role
            ON owner_role.oid = procedure.proowner
          WHERE namespace.nspname = 'autorfp_private'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'autorfp_auth_credentials_by_email',
            'autorfp_auth_identity_by_email',
            'autorfp_auth_identity_by_google_subject',
            'autorfp_invitation_tenant_by_digest',
            'autorfp_supplier_application_grant_by_digest',
            'autorfp_supplier_grant_by_digest',
            'autorfp_user_email_exists'
          ]::TEXT[]) AS expected(function_name)
          WHERE to_regprocedure(
            'autorfp_private.' || expected.function_name || '(text)'
          ) IS NULL
        )
        AND (
          SELECT COUNT(*) = 8
            AND pg_catalog.bool_and(table_catalog.relrowsecurity)
            AND pg_catalog.bool_and(table_catalog.relforcerowsecurity)
          FROM pg_catalog.pg_class AS table_catalog
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = table_catalog.relnamespace
          WHERE namespace.nspname = 'public'
            AND table_catalog.relname = ANY(ARRAY[
              'AuditEvent', 'Award', 'Menu', 'ProcurementRequest',
              'Supplier', 'SupplierRequest', 'Tenant', 'User'
            ]::TEXT[])
        )
        AND (
          SELECT COUNT(*) = 8
          FROM pg_catalog.pg_policy AS policy_catalog
          JOIN pg_catalog.pg_class AS table_catalog
            ON table_catalog.oid = policy_catalog.polrelid
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = table_catalog.relnamespace
          WHERE namespace.nspname = 'public'
            AND policy_catalog.polname = 'tenant_isolation'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM (
            VALUES
              ('Tenant', 'id'),
              ('User', 'tenantId'),
              ('Menu', 'tenantId'),
              ('Supplier', 'tenantId'),
              ('ProcurementRequest', 'tenantId'),
              ('SupplierRequest', 'tenantId'),
              ('Award', 'tenantId'),
              ('AuditEvent', 'tenantId')
          ) AS expected(table_name, tenant_column)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policy AS policy_catalog
            JOIN pg_catalog.pg_class AS table_catalog
              ON table_catalog.oid = policy_catalog.polrelid
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = table_catalog.relnamespace
            JOIN pg_catalog.pg_roles AS policy_role
              ON policy_role.rolname = 'autorfp_app'
            WHERE namespace.nspname = 'public'
              AND table_catalog.relname = expected.table_name
              AND policy_catalog.polname = 'tenant_isolation'
              AND policy_catalog.polcmd = '*'
              AND policy_catalog.polpermissive
              AND policy_catalog.polroles = ARRAY[policy_role.oid]::OID[]
              AND pg_catalog.replace(
                pg_catalog.replace(
                  pg_catalog.regexp_replace(
                    pg_catalog.pg_get_expr(
                      policy_catalog.polqual,
                      policy_catalog.polrelid
                    ),
                    '[[:space:]()"]',
                    '',
                    'g'
                  ),
                  'pg_catalog.',
                  ''
                ),
                '::text',
                ''
              ) = expected.tenant_column
                  || '=current_setting''app.tenant_id'',true'
              AND pg_catalog.replace(
                pg_catalog.replace(
                  pg_catalog.regexp_replace(
                    pg_catalog.pg_get_expr(
                      policy_catalog.polwithcheck,
                      policy_catalog.polrelid
                    ),
                    '[[:space:]()"]',
                    '',
                    'g'
                  ),
                  'pg_catalog.',
                  ''
                ),
                '::text',
                ''
              ) = expected.tenant_column
                  || '=current_setting''app.tenant_id'',true'
          )
        )
        AND NOT (
          SELECT table_catalog.relrowsecurity
          FROM pg_catalog.pg_class AS table_catalog
          WHERE table_catalog.oid = to_regclass('public."RateLimitBucket"')
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = 'autorfp_app'
            AND role.rolcanlogin
            AND NOT role.rolsuper
            AND NOT role.rolcreatedb
            AND NOT role.rolcreaterole
            AND NOT role.rolinherit
            AND NOT role.rolreplication
            AND NOT role.rolbypassrls
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = 'autorfp_backup'
            AND role.rolcanlogin
            AND NOT role.rolsuper
            AND NOT role.rolcreatedb
            AND NOT role.rolcreaterole
            AND NOT role.rolinherit
            AND NOT role.rolreplication
            AND role.rolbypassrls
        )
      ) AS "migrationReady"
    `,
  );
  if (!migration?.migrationReady) {
    throw new Error('The required database migration is not ready.');
  }
}

export function createReadinessHandler(
  dependencies: ReadinessDependencies,
) {
  return async function readiness() {
    try {
      validateRuntimeEnvironment(dependencies.environment);
      await within(dependencies.checkDatabase(), dependencies.timeoutMs);
      return healthResponse(200, 'ready');
    } catch {
      return healthResponse(503, 'unavailable');
    }
  };
}
