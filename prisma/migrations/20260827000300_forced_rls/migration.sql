BEGIN;

-- SECURITY DEFINER is safe here only when the migration role owns every
-- protected application table and can use a row-security-bypassing role.
-- Verify capabilities instead of assuming a provider-specific owner name.
DO $migration_owner$
DECLARE
    owner_can_bypass BOOLEAN;
    owner_owns_tables BOOLEAN;
BEGIN
    SELECT pg_catalog.bool_or(
        (role.rolsuper OR role.rolbypassrls)
        AND pg_catalog.pg_has_role(current_user, role.oid, 'USAGE')
    )
    INTO owner_can_bypass
    FROM pg_catalog.pg_roles AS role;

    SELECT COUNT(*) = 17
           AND pg_catalog.bool_and(class.relowner = current_user::pg_catalog.regrole)
    INTO owner_owns_tables
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relkind = 'r'
      AND class.relname = ANY (ARRAY[
          'Tenant', 'User', 'ExternalIdentity', 'Invitation', 'Menu',
          'Recipe', 'Ingredient', 'Supplier', 'ProcurementRequest',
          'RequestItem', 'SupplierRequest', 'SupplierQuote',
          'SupplierQuoteItem', 'Award', 'AwardLine', 'AuditEvent',
          'RateLimitBucket'
      ]);

    IF COALESCE(owner_can_bypass, false) = false
       OR COALESCE(owner_owns_tables, false) = false
    THEN
        RAISE EXCEPTION 'Forced-RLS migration requires a row-security-bypassing owner of every application table';
    END IF;
END
$migration_owner$;

DO $runtime_role$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_app'
    ) THEN
        CREATE ROLE autorfp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
            NOINHERIT NOREPLICATION NOBYPASSRLS;
    END IF;
END
$runtime_role$;

ALTER ROLE autorfp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOINHERIT NOREPLICATION NOBYPASSRLS;

DO $runtime_role_membership$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS inherited_role
        WHERE (inherited_role.rolsuper OR inherited_role.rolbypassrls)
          AND pg_catalog.pg_has_role(
              'autorfp_app',
              inherited_role.oid,
              'MEMBER'
          )
    ) THEN
        RAISE EXCEPTION 'autorfp_app must not inherit a row-security-bypassing role; create it directly with SQL instead of a provider console';
    END IF;
END
$runtime_role_membership$;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, autorfp_app;
CREATE SCHEMA autorfp_private;
REVOKE ALL PRIVILEGES ON SCHEMA autorfp_private FROM PUBLIC, autorfp_app;

-- Remove every pre-existing grant before policies or privileged functions are
-- installed. The final runtime grants are deliberately the last migration step.
REVOKE ALL PRIVILEGES ON TABLE
    "Tenant",
    "User",
    "ExternalIdentity",
    "Invitation",
    "Menu",
    "Recipe",
    "Ingredient",
    "Supplier",
    "ProcurementRequest",
    "RequestItem",
    "SupplierRequest",
    "SupplierQuote",
    "SupplierQuoteItem",
    "Award",
    "AwardLine",
    "AuditEvent",
    "RateLimitBucket"
FROM PUBLIC, autorfp_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
-- PostgreSQL grants EXECUTE on new functions to PUBLIC globally by default.
-- A schema-specific revoke cannot override that global default ACL.
ALTER DEFAULT PRIVILEGES
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC;

DO $remove_supabase_access$
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
                'REVOKE ALL PRIVILEGES ON TABLE
                    "Tenant", "User", "ExternalIdentity", "Invitation",
                    "Menu", "Recipe", "Ingredient", "Supplier",
                    "ProcurementRequest", "RequestItem", "SupplierRequest",
                    "SupplierQuote", "SupplierQuoteItem", "Award",
                    "AwardLine", "AuditEvent", "RateLimitBucket"
                 FROM %I',
                target_role
            );
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
                target_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public
                 REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                target_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public
                 REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                target_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public
                 REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
                target_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
                 REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                target_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
                 REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                target_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
                 REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
                target_role
            );
        END IF;
    END LOOP;
END
$remove_supabase_access$;

-- Pre-authentication does not know a tenant ID. These fixed-shape functions
-- are the only cross-tenant reads available to the runtime role.
CREATE FUNCTION autorfp_private.autorfp_auth_credentials_by_email(
    lookup_email TEXT
)
RETURNS TABLE (
    "id" TEXT,
    "tenantId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "legacyPasswordSalt" TEXT,
    "userIsActive" BOOLEAN,
    "tenantIsActive" BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT
        user_row."id",
        user_row."tenantId",
        user_row."name",
        user_row."email"::TEXT,
        user_row."passwordHash",
        user_row."legacyPasswordSalt",
        user_row."isActive",
        tenant_row."isActive"
    FROM public."User" AS user_row
    JOIN public."Tenant" AS tenant_row ON tenant_row."id" = user_row."tenantId"
    WHERE lookup_email IS NOT NULL
      AND pg_catalog.octet_length(lookup_email) <= 320
      AND user_row."email" = pg_catalog.lower(pg_catalog.btrim(lookup_email))
    LIMIT 1
$function$;

CREATE FUNCTION autorfp_private.autorfp_auth_identity_by_provider(
    lookup_provider TEXT,
    lookup_provider_account_id TEXT
)
RETURNS TABLE (
    "userId" TEXT,
    "tenantId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "role" TEXT,
    "userIsActive" BOOLEAN,
    "tenantIsActive" BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT
        user_row."id",
        user_row."tenantId",
        user_row."name",
        user_row."email"::TEXT,
        user_row."role"::TEXT,
        user_row."isActive",
        tenant_row."isActive"
    FROM public."ExternalIdentity" AS identity_row
    JOIN public."User" AS user_row
      ON user_row."tenantId" = identity_row."tenantId"
     AND user_row."id" = identity_row."userId"
    JOIN public."Tenant" AS tenant_row ON tenant_row."id" = user_row."tenantId"
    WHERE lookup_provider = 'google'
      AND pg_catalog.octet_length(lookup_provider_account_id) BETWEEN 1 AND 512
      AND identity_row."provider" = lookup_provider
      AND identity_row."providerAccountId" = lookup_provider_account_id
    LIMIT 1
$function$;

CREATE FUNCTION autorfp_private.autorfp_auth_identity_by_email(
    lookup_email TEXT
)
RETURNS TABLE (
    "userId" TEXT,
    "tenantId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "role" TEXT,
    "userIsActive" BOOLEAN,
    "tenantIsActive" BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT
        user_row."id",
        user_row."tenantId",
        user_row."name",
        user_row."email"::TEXT,
        user_row."role"::TEXT,
        user_row."isActive",
        tenant_row."isActive"
    FROM public."User" AS user_row
    JOIN public."Tenant" AS tenant_row ON tenant_row."id" = user_row."tenantId"
    WHERE lookup_email IS NOT NULL
      AND pg_catalog.octet_length(lookup_email) <= 320
      AND user_row."email" = pg_catalog.lower(pg_catalog.btrim(lookup_email))
    LIMIT 1
$function$;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA autorfp_private
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
                'REVOKE ALL PRIVILEGES ON SCHEMA autorfp_private FROM %I',
                target_role
            );
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS
                 IN SCHEMA autorfp_private FROM %I',
                target_role
            );
        END IF;
    END LOOP;
END
$remove_supabase_private_access$;

ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
    FOR ALL TO autorfp_app
    USING ("id" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "ExternalIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalIdentity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExternalIdentity"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invitation"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Menu" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Menu" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Menu"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Recipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Recipe" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Recipe"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Ingredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ingredient" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Ingredient"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Supplier"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "ProcurementRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcurementRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcurementRequest"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "RequestItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequestItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RequestItem"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "SupplierRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierRequest"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "SupplierQuote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierQuote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierQuote"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "SupplierQuoteItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierQuoteItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierQuoteItem"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Award" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Award" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Award"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "AwardLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AwardLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AwardLine"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditEvent"
    FOR ALL TO autorfp_app
    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

-- Final grants: the runtime role sees only the application tables and the
-- private bootstrap functions after every policy and ACL is locked down.
GRANT USAGE ON SCHEMA public, autorfp_private TO autorfp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    "Tenant",
    "User",
    "ExternalIdentity",
    "Invitation",
    "Menu",
    "Recipe",
    "Ingredient",
    "Supplier",
    "ProcurementRequest",
    "RequestItem",
    "SupplierRequest",
    "SupplierQuote",
    "SupplierQuoteItem",
    "Award",
    "AwardLine",
    "AuditEvent",
    "RateLimitBucket"
TO autorfp_app;
GRANT EXECUTE ON FUNCTION
    autorfp_private.autorfp_auth_credentials_by_email(TEXT),
    autorfp_private.autorfp_auth_identity_by_provider(TEXT, TEXT),
    autorfp_private.autorfp_auth_identity_by_email(TEXT)
TO autorfp_app;

COMMIT;
