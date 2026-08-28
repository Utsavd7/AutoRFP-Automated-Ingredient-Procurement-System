BEGIN;

DO $migration_owner$
DECLARE
    owner_can_bypass BOOLEAN;
    owns_private_schema BOOLEAN;
    owns_required_tables BOOLEAN;
BEGIN
    SELECT role.rolsuper OR role.rolbypassrls
    INTO owner_can_bypass
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user;

    SELECT namespace.nspowner = current_user::pg_catalog.regrole
    INTO owns_private_schema
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname = 'autorfp_private';

    SELECT pg_catalog.count(*) = 3
           AND pg_catalog.bool_and(class.relowner = current_user::pg_catalog.regrole)
    INTO owns_required_tables
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname IN ('Invitation', 'Tenant', 'User')
      AND class.relkind IN ('r', 'p');

    IF COALESCE(owner_can_bypass, false) = false
       OR COALESCE(owns_private_schema, false) = false
       OR COALESCE(owns_required_tables, false) = false
    THEN
        RAISE EXCEPTION 'Invitation migration requires a row-security-bypassing owner of autorfp_private and the invitation account tables';
    END IF;
END
$migration_owner$;

CREATE FUNCTION autorfp_private.autorfp_invitation_tenant_by_digest(
    lookup_digest TEXT
)
RETURNS TABLE ("tenantId" TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT invitation."tenantId"
    FROM public."Invitation" AS invitation
    JOIN public."Tenant" AS tenant
      ON tenant."id" = invitation."tenantId"
    WHERE lookup_digest IS NOT NULL
      AND pg_catalog.octet_length(lookup_digest) = 64
      AND pg_catalog.translate(lookup_digest, '0123456789abcdef', '') = ''
      AND invitation."tokenDigest" = lookup_digest::CHAR(64)
      AND invitation."acceptedAt" IS NULL
      AND invitation."revokedAt" IS NULL
      AND invitation."expiresAt" > pg_catalog.statement_timestamp()
      AND tenant."isActive" = true
    LIMIT 1
$function$;

CREATE FUNCTION autorfp_private.autorfp_user_email_exists(
    lookup_email TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public."User" AS account
        WHERE lookup_email IS NOT NULL
          AND pg_catalog.octet_length(lookup_email) BETWEEN 3 AND 320
          AND lookup_email = pg_catalog.lower(lookup_email)
          AND account."email" = lookup_email
    )
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION
    autorfp_private.autorfp_invitation_tenant_by_digest(TEXT),
    autorfp_private.autorfp_user_email_exists(TEXT)
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
                    autorfp_private.autorfp_invitation_tenant_by_digest(TEXT),
                    autorfp_private.autorfp_user_email_exists(TEXT)
                 FROM %I',
                target_role
            );
        END IF;
    END LOOP;
END
$remove_supabase_private_access$;

GRANT EXECUTE ON FUNCTION
    autorfp_private.autorfp_invitation_tenant_by_digest(TEXT),
    autorfp_private.autorfp_user_email_exists(TEXT)
TO autorfp_app;

COMMIT;
