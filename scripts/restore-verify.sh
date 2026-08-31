#!/bin/sh
set -eu

umask 077

fail() {
  printf 'Restore verification refused: %s\n' "$1" >&2
  exit 1
}

backup_file=${1:-}
[ -f "$backup_file" ] || fail 'an encrypted backup file is required'
case "$backup_file" in
  *.dump.gz.age) : ;;
  *) fail 'backup file must end in .dump.gz.age' ;;
esac

[ -n "${RESTORE_DATABASE_URL:-}" ] || fail 'RESTORE_DATABASE_URL is required'
[ -n "${AGE_IDENTITY_FILE:-}" ] || fail 'AGE_IDENTITY_FILE is required'
[ -f "$AGE_IDENTITY_FILE" ] || fail 'AGE_IDENTITY_FILE must name a readable file'

database_without_query=${RESTORE_DATABASE_URL%%\?*}
database_name=${database_without_query##*/}
printf '%s\n' "$database_name" | grep -Eq '^quoteplate_restore_[a-z0-9_]+$' \
  || fail 'target database name must start with quoteplate_restore_ and be disposable'

for command_name in age gzip pg_restore psql mktemp grep node; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

connection_service_file=$(mktemp "${TMPDIR:-/tmp}/quoteplate-restore-service.XXXXXX")
cleanup_connection_service() {
  rm -f "$connection_service_file"
}
trap cleanup_connection_service EXIT HUP INT TERM

RESTORE_SERVICE_FILE="$connection_service_file" node -e '
const { writeFileSync } = require("node:fs");
const url = new URL(process.env.RESTORE_DATABASE_URL);
if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) process.exit(2);
const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
if (!database || !url.hostname) process.exit(2);
const parameters = new Map([
  ["host", decodeURIComponent(url.hostname)],
  ["dbname", database],
]);
if (url.port) parameters.set("port", url.port);
if (url.username) parameters.set("user", decodeURIComponent(url.username));
if (url.password) parameters.set("password", decodeURIComponent(url.password));
for (const [key, value] of url.searchParams) {
  if (new Set(["schema", "connection_limit"]).has(key)) continue;
  if (!/^[a-z_]+$/.test(key)) process.exit(2);
  parameters.set(key, value);
}
const lines = ["[quoteplate_restore]"];
for (const [key, value] of parameters) {
  if (/[\r\n\0]/.test(value)) process.exit(2);
  lines.push(key + "=" + value);
}
writeFileSync(process.env.RESTORE_SERVICE_FILE, lines.join("\n") + "\n", { mode: 0o600 });
' || fail 'RESTORE_DATABASE_URL could not be converted to a private libpq service'

unset PGDATABASE
PGSERVICEFILE=$connection_service_file
PGSERVICE=quoteplate_restore
export PGSERVICEFILE PGSERVICE

connected_database=$(psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command='SELECT current_database();') \
  || fail 'could not identify the disposable restore database'
[ "$connected_database" = "$database_name" ] \
  || fail 'connected database did not match the validated disposable database name'

ensure_restore_owner() {
  restore_owner_safe=$(psql \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --quiet \
    --command="SELECT CASE WHEN
  pg_catalog.to_regclass('pg_catalog.pg_roles') IS NOT NULL
  AND EXISTS (
  SELECT 1
  FROM pg_catalog.pg_roles AS connection_role
  WHERE connection_role.rolname = CURRENT_USER
    AND (connection_role.rolsuper OR connection_role.rolbypassrls)
) THEN 1 ELSE 0 END /* quoteplate_restore_owner_check */;") \
    || fail 'could not verify the disposable restore owner'
  [ "$restore_owner_safe" = '1' ] \
    || fail 'restore connection must be a row-security-bypassing owner'
}

ensure_restricted_runtime_role() {
  psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command="DO \$autorfp_runtime_role\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_app'
  ) THEN
    CREATE ROLE autorfp_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'autorfp_app'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'autorfp_app has unsafe role attributes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_app')
  ) THEN
    RAISE EXCEPTION 'autorfp_app must not inherit membership in another role';
  END IF;
END
\$autorfp_runtime_role\$;"

  psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command="DO \$autorfp_backup_role\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_backup'
  ) THEN
    CREATE ROLE autorfp_backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'autorfp_backup'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR NOT rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'autorfp_backup has unsafe role attributes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_backup')
  ) THEN
    RAISE EXCEPTION 'autorfp_backup must not inherit membership in another role';
  END IF;
END
\$autorfp_backup_role\$;"
}

ensure_restore_owner
ensure_restricted_runtime_role

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/quoteplate-restore.XXXXXX")
compressed_file="$temporary_directory/quoteplate.dump.gz"
dump_file="$temporary_directory/quoteplate.dump"
restore_started=0

clear_disposable_database() {
  psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command='DROP SCHEMA IF EXISTS autorfp_private CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
}

cleanup() {
  if [ "$restore_started" -eq 1 ]; then
    clear_disposable_database >/dev/null 2>&1 || true
  fi
  rm -f "$compressed_file" "$dump_file" "$connection_service_file"
  rmdir "$temporary_directory" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$compressed_file" "$backup_file"
gzip -dc "$compressed_file" > "$dump_file"

restore_started=1
clear_disposable_database
# The private libpq service keeps the credential out of process arguments.
pg_restore \
  --dbname=service=quoteplate_restore \
  --exit-on-error \
  --no-owner \
  "$dump_file"

ensure_restore_owner

verification_result=$(psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command="SELECT CASE WHEN
  to_regclass('public.\"_prisma_migrations\"') IS NOT NULL
  AND ARRAY(
    SELECT tablename::TEXT
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  ) = ARRAY[
    'AuditEvent', 'Award', 'Menu', 'ProcurementRequest', 'RateLimitBucket',
    'Supplier', 'SupplierRequest', 'Tenant', 'User'
  ]::TEXT[]
  AND NOT (
    SELECT COUNT(*) = 17
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
  )
  AND EXISTS (
    SELECT 1
    FROM public.\"_prisma_migrations\"
    WHERE migration_name = '20260831000100_compact_nine_table_schema'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.\"_prisma_migrations\"
    WHERE migration_name = '20260827001000_backup_role'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('AuditEvent_metadata_size_check', 'AuditEvent', 'metadata', '16384'),
      ('Award_allocationLines_size_check', 'Award', 'allocationLines', '2097152'),
      ('Award_deliverySnapshot_size_check', 'Award', 'deliverySnapshot', '16384'),
      ('Award_supplierSnapshots_size_check', 'Award', 'supplierSnapshots', '2097152'),
      ('Menu_document_size_check', 'Menu', 'document', '524288'),
      ('ProcurementRequest_deliveryDetails_size_check', 'ProcurementRequest', 'deliveryDetails', '16384'),
      ('ProcurementRequest_items_size_check', 'ProcurementRequest', 'items', '524288'),
      ('ProcurementRequest_sourcing_size_check', 'ProcurementRequest', 'sourcing', '65536'),
      ('Supplier_capabilities_size_check', 'Supplier', 'capabilities', '65536'),
      ('SupplierRequest_quoteRevisions_size_check', 'SupplierRequest', 'quoteRevisions', '2097152')
    ) AS expected(constraint_name, table_name, column_name, byte_cap)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      JOIN pg_catalog.pg_class AS table_catalog
        ON table_catalog.oid = constraint_catalog.conrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = table_catalog.relnamespace
      WHERE namespace.nspname = 'public'
        AND table_catalog.relname = expected.table_name
        AND constraint_catalog.contype = 'c'
        AND constraint_catalog.convalidated
        AND constraint_catalog.conname = expected.constraint_name
        AND pg_catalog.replace(
          pg_catalog.replace(
            pg_catalog.regexp_replace(
              pg_catalog.pg_get_expr(
                constraint_catalog.conbin,
                constraint_catalog.conrelid
              ),
              '[[:space:]()\"]',
              '',
              'g'
            ),
            'pg_catalog.',
            ''
          ),
          '::character varying',
          '::text'
        ) = 'octet_length' || expected.column_name
            || '::text<=' || expected.byte_cap
    )
  )
  AND (
    SELECT COUNT(*) = 7
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'autorfp_private'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('autorfp_auth_credentials_by_email', 'text'),
      ('autorfp_auth_identity_by_email', 'text'),
      ('autorfp_auth_identity_by_google_subject', 'text'),
      ('autorfp_invitation_tenant_by_digest', 'text'),
      ('autorfp_supplier_application_grant_by_digest', 'text'),
      ('autorfp_supplier_grant_by_digest', 'text'),
      ('autorfp_user_email_exists', 'text')
    ) AS expected(function_name, argument_signature)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = pg_catalog.to_regprocedure(
          pg_catalog.format(
            'autorfp_private.%I(%s)',
            expected.function_name,
            expected.argument_signature
          )
        )
        AND procedure.prosecdef
        AND procedure.proconfig = ARRAY['search_path=pg_catalog']::TEXT[]
        AND (owner_role.rolsuper OR owner_role.rolbypassrls)
        AND pg_catalog.has_function_privilege(
          'autorfp_app', procedure.oid, 'EXECUTE'
        )
    )
  )
  AND (
    SELECT COUNT(*) = 8
      AND bool_and(table_catalog.relrowsecurity)
      AND bool_and(table_catalog.relforcerowsecurity)
    FROM pg_catalog.pg_class AS table_catalog
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_catalog.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_catalog.relname = ANY(ARRAY[
        'AuditEvent', 'Award', 'Menu', 'ProcurementRequest',
        'Supplier', 'SupplierRequest', 'Tenant', 'User'
      ])
  )
  AND NOT (
    SELECT table_catalog.relrowsecurity OR table_catalog.relforcerowsecurity
    FROM pg_catalog.pg_class AS table_catalog
    WHERE table_catalog.oid = to_regclass('public.\"RateLimitBucket\"')
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
    FROM (VALUES
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
              '[[:space:]()\"]',
              '',
              'g'
            ),
            'pg_catalog.',
            ''
          ),
          '::text',
          ''
        ) = expected.tenant_column
            || pg_catalog.concat(
              '=NULLIFcurrent_setting',
              pg_catalog.quote_literal('app.tenant_id'),
              ',true,',
              pg_catalog.quote_literal('')
            )
        AND pg_catalog.replace(
          pg_catalog.replace(
            pg_catalog.regexp_replace(
              pg_catalog.pg_get_expr(
                policy_catalog.polwithcheck,
                policy_catalog.polrelid
              ),
              '[[:space:]()\"]',
              '',
              'g'
            ),
            'pg_catalog.',
            ''
          ),
          '::text',
          ''
        ) = expected.tenant_column
            || pg_catalog.concat(
              '=NULLIFcurrent_setting',
              pg_catalog.quote_literal('app.tenant_id'),
              ',true,',
              pg_catalog.quote_literal('')
            )
    )
  )
THEN 1 ELSE 0 END;")
[ "$verification_result" = '1' ] || fail 'restored database did not contain the compact schema contract'

runtime_verification_result=$(psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --quiet \
  --command="BEGIN;
SET LOCAL ROLE autorfp_app;
SET LOCAL app.tenant_id = 'quoteplate-restore-verification-no-tenant';
SELECT CASE WHEN
  to_regclass('public.\"Tenant\"') IS NOT NULL
  AND has_schema_privilege(current_user, 'public', 'USAGE')
  AND has_schema_privilege(current_user, 'autorfp_private', 'USAGE')
  AND has_table_privilege(current_user, 'public.\"Tenant\"', 'SELECT')
  AND has_function_privilege(
    current_user,
    'autorfp_private.autorfp_auth_credentials_by_email(text)',
    'EXECUTE'
  )
  AND pg_catalog.row_security_active('public.\"Tenant\"'::regclass)
  AND (SELECT COUNT(*) FROM public.\"Tenant\") = 0
  AND NOT EXISTS (
    SELECT 1
    FROM autorfp_private.autorfp_auth_credentials_by_email(NULL::TEXT)
  )
THEN 1 ELSE 0 END;
COMMIT;")
[ "$runtime_verification_result" = '1' ] \
  || fail 'restored runtime grants or tenant row security were unusable'

backup_verification_result=$(psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --quiet \
  --command="BEGIN;
SET LOCAL ROLE autorfp_backup;
SELECT CASE WHEN
  to_regclass('public.\"Tenant\"') IS NOT NULL
  AND has_schema_privilege(current_user, 'public', 'USAGE')
  AND (
    SELECT bool_and(has_table_privilege(current_user, relation.oid, 'SELECT'))
      AND NOT bool_or(has_table_privilege(
        current_user,
        relation.oid,
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ))
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'autorfp_private'
      AND has_function_privilege(current_user, procedure.oid, 'EXECUTE')
  )
THEN 1 ELSE 0 END;
COMMIT;")
[ "$backup_verification_result" = '1' ] \
  || fail 'restored backup grants were not read-only'

printf 'Disposable restore verified and scheduled for immediate cleanup.\n'
