BEGIN;

DO $migration_owner$
DECLARE
    owner_can_bypass BOOLEAN;
    owns_private_schema BOOLEAN;
    owns_required_tables BOOLEAN;
BEGIN
    SELECT pg_catalog.bool_or(
        (role.rolsuper OR role.rolbypassrls)
        AND pg_catalog.pg_has_role(current_user, role.oid, 'USAGE')
    )
    INTO owner_can_bypass
    FROM pg_catalog.pg_roles AS role;

    SELECT namespace.nspowner = current_user::pg_catalog.regrole
    INTO owns_private_schema
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname = 'autorfp_private';

    SELECT pg_catalog.count(*) = 4
           AND pg_catalog.bool_and(class.relowner = current_user::pg_catalog.regrole)
    INTO owns_required_tables
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname IN (
        'SupplierRequest', 'ProcurementRequest', 'Supplier', 'Tenant'
      )
      AND class.relkind IN ('r', 'p');

    IF COALESCE(owner_can_bypass, false) = false
       OR COALESCE(owns_private_schema, false) = false
       OR COALESCE(owns_required_tables, false) = false
    THEN
        RAISE EXCEPTION 'Public supplier grant migration requires a row-security-bypassing owner of autorfp_private and the procurement tables';
    END IF;
END
$migration_owner$;

CREATE FUNCTION autorfp_private.autorfp_supplier_grant_by_digest(
    lookup_digest TEXT
)
RETURNS TABLE (
    "tenantId" TEXT,
    "supplierRequestId" TEXT
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT
        supplier_request."tenantId",
        supplier_request."id"
    FROM public."SupplierRequest" AS supplier_request
    JOIN public."ProcurementRequest" AS request
      ON request."tenantId" = supplier_request."tenantId"
     AND request."id" = supplier_request."requestId"
    JOIN public."Supplier" AS supplier
      ON supplier."tenantId" = supplier_request."tenantId"
     AND supplier."id" = supplier_request."supplierId"
    JOIN public."Tenant" AS tenant
      ON tenant."id" = supplier_request."tenantId"
    WHERE lookup_digest IS NOT NULL
      AND pg_catalog.octet_length(lookup_digest) = 64
      AND pg_catalog.translate(lookup_digest, '0123456789abcdef', '') = ''
      AND supplier_request."tokenDigest" = lookup_digest::CHAR(64)
      AND supplier_request."revokedAt" IS NULL
      AND supplier_request."expiresAt" > pg_catalog.clock_timestamp()
      AND request."status"::TEXT = 'OPEN'
      AND request."quoteDeadline" > pg_catalog.clock_timestamp()
      AND supplier."isActive" = true
      AND tenant."isActive" = true
    LIMIT 1
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION
    autorfp_private.autorfp_supplier_grant_by_digest(TEXT)
FROM PUBLIC, autorfp_app;

DO $remove_supabase_private_access$
DECLARE
    target_role TEXT;
BEGIN
    FOREACH target_role IN ARRAY ARRAY[
        'anon', 'authenticated', 'service_role', 'authenticator'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role
        ) THEN
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON FUNCTION
                    autorfp_private.autorfp_supplier_grant_by_digest(TEXT)
                 FROM %I',
                target_role
            );
        END IF;
    END LOOP;
END
$remove_supabase_private_access$;

GRANT EXECUTE ON FUNCTION
    autorfp_private.autorfp_supplier_grant_by_digest(TEXT)
TO autorfp_app;

COMMIT;
