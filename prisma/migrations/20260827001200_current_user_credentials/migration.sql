-- QuotePlate has no pre-launch accounts. Keep credentials Argon2id-only and
-- remove the legacy SHA-256 salt from both the table and restricted lookup.
BEGIN;

REVOKE ALL PRIVILEGES ON FUNCTION
    autorfp_private.autorfp_auth_credentials_by_email(TEXT)
FROM PUBLIC, autorfp_app;

DROP FUNCTION autorfp_private.autorfp_auth_credentials_by_email(TEXT);

ALTER TABLE "User" DROP COLUMN "legacyPasswordSalt";

CREATE FUNCTION autorfp_private.autorfp_auth_credentials_by_email(
    lookup_email TEXT
)
RETURNS TABLE (
    "id" TEXT,
    "tenantId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
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
        user_row."isActive",
        tenant_row."isActive"
    FROM public."User" AS user_row
    JOIN public."Tenant" AS tenant_row ON tenant_row."id" = user_row."tenantId"
    WHERE lookup_email IS NOT NULL
      AND pg_catalog.octet_length(lookup_email) <= 320
      AND user_row."email" = pg_catalog.lower(pg_catalog.btrim(lookup_email))
    LIMIT 1
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION
    autorfp_private.autorfp_auth_credentials_by_email(TEXT)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    autorfp_private.autorfp_auth_credentials_by_email(TEXT)
TO autorfp_app;

COMMIT;
