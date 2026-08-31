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

for command_name in age gzip pg_restore psql mktemp grep; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

connected_database=$(PGDATABASE="$RESTORE_DATABASE_URL" psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command='SELECT current_database();') \
  || fail 'could not identify the disposable restore database'
[ "$connected_database" = "$database_name" ] \
  || fail 'connected database did not match the validated disposable database name'

ensure_restricted_runtime_role() {
  PGDATABASE="$RESTORE_DATABASE_URL" psql \
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

  PGDATABASE="$RESTORE_DATABASE_URL" psql \
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

ensure_restricted_runtime_role

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/quoteplate-restore.XXXXXX")
compressed_file="$temporary_directory/quoteplate.dump.gz"
dump_file="$temporary_directory/quoteplate.dump"
restore_started=0

clear_disposable_database() {
  PGDATABASE="$RESTORE_DATABASE_URL" psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command='DROP SCHEMA IF EXISTS autorfp_private CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
}

cleanup() {
  if [ "$restore_started" -eq 1 ]; then
    clear_disposable_database >/dev/null 2>&1 || true
  fi
  rm -f "$compressed_file" "$dump_file"
  rmdir "$temporary_directory" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$compressed_file" "$backup_file"
gzip -dc "$compressed_file" > "$dump_file"

restore_started=1
clear_disposable_database
# The empty option tells pg_restore to connect; libpq reads the actual URL from
# PGDATABASE, so the credential does not appear in the process arguments.
PGDATABASE="$RESTORE_DATABASE_URL" pg_restore \
  --dbname= \
  --exit-on-error \
  --no-owner \
  "$dump_file"

verification_result=$(PGDATABASE="$RESTORE_DATABASE_URL" psql \
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
  AND (
    SELECT COUNT(*) = 10
    FROM pg_catalog.pg_constraint AS constraint_catalog
    JOIN pg_catalog.pg_class AS table_catalog
      ON table_catalog.oid = constraint_catalog.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_catalog.relnamespace
    WHERE namespace.nspname = 'public'
      AND constraint_catalog.contype = 'c'
      AND constraint_catalog.conname = ANY(ARRAY[
        'AuditEvent_metadata_size_check',
        'Award_allocationLines_size_check',
        'Award_deliverySnapshot_size_check',
        'Award_supplierSnapshots_size_check',
        'Menu_document_size_check',
        'ProcurementRequest_deliveryDetails_size_check',
        'ProcurementRequest_items_size_check',
        'ProcurementRequest_sourcing_size_check',
        'Supplier_capabilities_size_check',
        'SupplierRequest_quoteRevisions_size_check'
      ])
  )
  AND (
    SELECT COUNT(*) = 7
      AND bool_and(procedure.prosecdef)
      AND bool_and(procedure.proconfig = ARRAY['search_path=pg_catalog']::TEXT[])
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'autorfp_private'
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
THEN 1 ELSE 0 END;")
[ "$verification_result" = '1' ] || fail 'restored database did not contain the compact schema contract'

runtime_verification_result=$(PGDATABASE="$RESTORE_DATABASE_URL" psql \
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

backup_verification_result=$(PGDATABASE="$RESTORE_DATABASE_URL" psql \
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
