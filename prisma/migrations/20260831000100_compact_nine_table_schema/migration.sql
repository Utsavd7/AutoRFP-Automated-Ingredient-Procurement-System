BEGIN;

DO $compact_schema_guard$
DECLARE
    migration_role_bypasses_row_security BOOLEAN;
BEGIN
    SELECT role.rolsuper OR role.rolbypassrls
    INTO migration_role_bypasses_row_security
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = CURRENT_USER;

    IF COALESCE(migration_role_bypasses_row_security, false) = false THEN
        RAISE EXCEPTION 'Compact schema migration requires a row-security-bypassing owner';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT 1 AS present FROM public."Tenant"
            UNION ALL SELECT 1 FROM public."User"
            UNION ALL SELECT 1 FROM public."ExternalIdentity"
            UNION ALL SELECT 1 FROM public."Invitation"
            UNION ALL SELECT 1 FROM public."Menu"
            UNION ALL SELECT 1 FROM public."Recipe"
            UNION ALL SELECT 1 FROM public."Ingredient"
            UNION ALL SELECT 1 FROM public."Supplier"
            UNION ALL SELECT 1 FROM public."ProcurementRequest"
            UNION ALL SELECT 1 FROM public."RequestItem"
            UNION ALL SELECT 1 FROM public."SupplierRequest"
            UNION ALL SELECT 1 FROM public."SupplierQuote"
            UNION ALL SELECT 1 FROM public."SupplierQuoteItem"
            UNION ALL SELECT 1 FROM public."Award"
            UNION ALL SELECT 1 FROM public."AwardLine"
            UNION ALL SELECT 1 FROM public."AuditEvent"
            UNION ALL SELECT 1 FROM public."RateLimitBucket"
        ) AS populated
    ) THEN
        RAISE EXCEPTION 'Compact schema migration requires an empty pre-launch database';
    END IF;
END
$compact_schema_guard$;

-- Remove the old runtime surface before changing any table shape.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
FROM PUBLIC, autorfp_app, autorfp_backup;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA autorfp_private
FROM PUBLIC, autorfp_app, autorfp_backup;
REVOKE ALL PRIVILEGES ON SCHEMA public, autorfp_private
FROM PUBLIC, autorfp_app, autorfp_backup;

DO $remove_provider_access$
DECLARE
    target_role TEXT;
BEGIN
    FOREACH target_role IN ARRAY ARRAY[
        'anon', 'authenticated', 'service_role', 'dashboard_user',
        'authenticator'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role
        ) THEN
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA autorfp_private FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES ON SCHEMA public, autorfp_private FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
                target_role
            );
        END IF;
    END LOOP;
END
$remove_provider_access$;

DROP SCHEMA autorfp_private CASCADE;

-- The guard makes this a bounded pre-launch replacement, not a data conversion.
DROP TABLE public."AwardLine";
DROP TABLE public."SupplierQuoteItem";
DROP TABLE public."SupplierQuote";
DROP TABLE public."RequestItem";
DROP TABLE public."Ingredient";
DROP TABLE public."Recipe";
DROP TABLE public."ExternalIdentity";
DROP TABLE public."Invitation";
DROP TYPE public."ProcurementUnit";

CREATE TYPE public."UserAccountState" AS ENUM (
    'INVITED', 'ACTIVE', 'DEACTIVATED'
);
CREATE TYPE public."SupplierRelationshipType" AS ENUM (
    'CURRENT', 'SELECTED_NEW', 'DISCOVERED'
);
CREATE TYPE public."SupplierVerificationStatus" AS ENUM (
    'UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'
);

ALTER TABLE public."User"
    ADD COLUMN "googleSubject" TEXT,
    ADD COLUMN "accountState" public."UserAccountState" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "invitationTokenDigest" CHAR(64),
    ADD COLUMN "invitationExpiresAt" TIMESTAMP(3),
    ADD COLUMN "invitationAcceptedAt" TIMESTAMP(3),
    ADD COLUMN "invitationRevokedAt" TIMESTAMP(3),
    ADD COLUMN "invitedByUserId" TEXT,
    ADD COLUMN "tutorialVersion" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "tutorialStep" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "tutorialSkippedAt" TIMESTAMP(3),
    ADD COLUMN "tutorialCompletedAt" TIMESTAMP(3),
    ADD CONSTRAINT "User_invitationTokenDigest_length_check"
        CHECK (
            "invitationTokenDigest" IS NULL
            OR pg_catalog.length("invitationTokenDigest") = 64
        ),
    ADD CONSTRAINT "User_tutorialVersion_check"
        CHECK ("tutorialVersion" > 0),
    ADD CONSTRAINT "User_tutorialStep_check"
        CHECK ("tutorialStep" >= 0);

ALTER TABLE public."Menu"
    ADD COLUMN "document" JSONB NOT NULL,
    ADD CONSTRAINT "Menu_document_size_check"
        CHECK (pg_catalog.octet_length("document"::TEXT) <= 524288);

ALTER TABLE public."Supplier"
    ADD COLUMN "relationshipType" public."SupplierRelationshipType"
        NOT NULL DEFAULT 'CURRENT',
    ADD COLUMN "verificationStatus" public."SupplierVerificationStatus"
        NOT NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN "applicationRequestId" TEXT,
    ADD COLUMN "capabilities" JSONB NOT NULL,
    ADD COLUMN "verifiedAt" TIMESTAMP(3),
    ADD COLUMN "verifiedByUserId" TEXT,
    ADD CONSTRAINT "Supplier_capabilities_size_check"
        CHECK (pg_catalog.octet_length("capabilities"::TEXT) <= 65536);

ALTER TABLE public."ProcurementRequest"
    ADD COLUMN "items" JSONB NOT NULL,
    ADD COLUMN "sourcing" JSONB NOT NULL,
    ADD COLUMN "applicationTokenDigest" CHAR(64),
    ADD COLUMN "applicationExpiresAt" TIMESTAMP(3),
    ADD COLUMN "applicationRevokedAt" TIMESTAMP(3),
    ADD CONSTRAINT "ProcurementRequest_items_size_check"
        CHECK (pg_catalog.octet_length("items"::TEXT) <= 524288),
    ADD CONSTRAINT "ProcurementRequest_sourcing_size_check"
        CHECK (pg_catalog.octet_length("sourcing"::TEXT) <= 65536),
    ADD CONSTRAINT "ProcurementRequest_applicationTokenDigest_length_check"
        CHECK (
            "applicationTokenDigest" IS NULL
            OR pg_catalog.length("applicationTokenDigest") = 64
        );

ALTER TABLE public."SupplierRequest"
    ADD COLUMN "quoteRevision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "quoteRevisions" JSONB NOT NULL,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL,
    ADD CONSTRAINT "SupplierRequest_quoteRevision_check"
        CHECK ("quoteRevision" >= 0),
    ADD CONSTRAINT "SupplierRequest_quoteRevisions_size_check"
        CHECK (pg_catalog.octet_length("quoteRevisions"::TEXT) <= 2097152);

ALTER TABLE public."Award"
    ADD COLUMN "allocationLines" JSONB NOT NULL,
    ADD CONSTRAINT "Award_allocationLines_size_check"
        CHECK (pg_catalog.octet_length("allocationLines"::TEXT) <= 2097152);

ALTER TABLE public."AuditEvent"
    DROP CONSTRAINT "AuditEvent_metadata_size_check",
    ADD CONSTRAINT "AuditEvent_metadata_size_check"
        CHECK (pg_catalog.octet_length("metadata"::TEXT) <= 16384);

DROP INDEX public."ProcurementRequest_tenantId_status_quoteDeadline_idx";

CREATE UNIQUE INDEX "User_googleSubject_key"
    ON public."User"("googleSubject");
CREATE UNIQUE INDEX "User_invitationTokenDigest_key"
    ON public."User"("invitationTokenDigest");
CREATE INDEX "User_tenantId_invitedByUserId_idx"
    ON public."User"("tenantId", "invitedByUserId");
CREATE INDEX "Supplier_tenantId_applicationRequestId_idx"
    ON public."Supplier"("tenantId", "applicationRequestId");
CREATE INDEX "Supplier_tenantId_verifiedByUserId_idx"
    ON public."Supplier"("tenantId", "verifiedByUserId");
CREATE UNIQUE INDEX "ProcurementRequest_applicationTokenDigest_key"
    ON public."ProcurementRequest"("applicationTokenDigest");
CREATE INDEX "ProcurementRequest_tenantId_status_updatedAt_idx"
    ON public."ProcurementRequest"("tenantId", "status", "updatedAt");
CREATE UNIQUE INDEX "AuditEvent_tenantId_id_key"
    ON public."AuditEvent"("tenantId", "id");

ALTER TABLE public."User"
    ADD CONSTRAINT "User_tenantId_invitedByUserId_fkey"
    FOREIGN KEY ("tenantId", "invitedByUserId")
    REFERENCES public."User"("tenantId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public."Supplier"
    ADD CONSTRAINT "Supplier_tenantId_applicationRequestId_fkey"
    FOREIGN KEY ("tenantId", "applicationRequestId")
    REFERENCES public."ProcurementRequest"("tenantId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Supplier_tenantId_verifiedByUserId_fkey"
    FOREIGN KEY ("tenantId", "verifiedByUserId")
    REFERENCES public."User"("tenantId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE SCHEMA autorfp_private;
REVOKE ALL PRIVILEGES ON SCHEMA autorfp_private FROM PUBLIC;

DO $role_attribute_guard$
DECLARE
    app_is_safe BOOLEAN;
    backup_is_safe BOOLEAN;
BEGIN
    SELECT role.rolcanlogin
           AND NOT role.rolsuper
           AND NOT role.rolcreatedb
           AND NOT role.rolcreaterole
           AND NOT role.rolinherit
           AND NOT role.rolreplication
           AND NOT role.rolbypassrls
    INTO app_is_safe
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = 'autorfp_app';

    SELECT role.rolcanlogin
           AND NOT role.rolsuper
           AND NOT role.rolcreatedb
           AND NOT role.rolcreaterole
           AND NOT role.rolinherit
           AND NOT role.rolreplication
           AND role.rolbypassrls
    INTO backup_is_safe
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = 'autorfp_backup';

    IF COALESCE(app_is_safe, false) = false THEN
        RAISE EXCEPTION 'autorfp_app has unsafe role attributes';
    END IF;
    IF COALESCE(backup_is_safe, false) = false THEN
        RAISE EXCEPTION 'autorfp_backup has unsafe role attributes';
    END IF;
END
$role_attribute_guard$;

DO $role_membership_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS inherited_role
        WHERE inherited_role.oid <> 'autorfp_app'::pg_catalog.regrole
          AND (inherited_role.rolsuper OR inherited_role.rolbypassrls)
          AND pg_catalog.pg_has_role(
              'autorfp_app', inherited_role.oid, 'MEMBER'
          )
    ) THEN
        RAISE EXCEPTION 'autorfp_app must not inherit a row-security-bypassing role';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members
        WHERE member = 'autorfp_backup'::pg_catalog.regrole
    ) THEN
        RAISE EXCEPTION 'autorfp_backup must not inherit membership in another role';
    END IF;
END
$role_membership_guard$;

ALTER DEFAULT PRIVILEGES
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, autorfp_app, autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, autorfp_app, autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, autorfp_app, autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, autorfp_app, autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, autorfp_app, autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, autorfp_app, autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, autorfp_app, autorfp_backup;

DO $lock_provider_defaults$
DECLARE
    target_role TEXT;
BEGIN
    FOREACH target_role IN ARRAY ARRAY[
        'anon', 'authenticated', 'service_role', 'dashboard_user',
        'authenticator'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role
        ) THEN
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES ON SCHEMA public, autorfp_private FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
                target_role
            );
        END IF;
    END LOOP;
END
$lock_provider_defaults$;

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
        account."id",
        account."tenantId",
        account."name",
        account."email"::TEXT,
        account."passwordHash",
        account."isActive" AND account."accountState"::TEXT = 'ACTIVE',
        tenant."isActive"
    FROM public."User" AS account
    JOIN public."Tenant" AS tenant ON tenant."id" = account."tenantId"
    WHERE lookup_email IS NOT NULL
      AND pg_catalog.octet_length(lookup_email) BETWEEN 3 AND 320
      AND account."email" = pg_catalog.lower(pg_catalog.btrim(lookup_email))
    LIMIT 1
$function$;

CREATE FUNCTION autorfp_private.autorfp_auth_identity_by_google_subject(
    lookup_google_subject TEXT
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
        account."id",
        account."tenantId",
        account."name",
        account."email"::TEXT,
        account."role"::TEXT,
        account."isActive" AND account."accountState"::TEXT = 'ACTIVE',
        tenant."isActive"
    FROM public."User" AS account
    JOIN public."Tenant" AS tenant ON tenant."id" = account."tenantId"
    WHERE lookup_google_subject IS NOT NULL
      AND pg_catalog.octet_length(lookup_google_subject) BETWEEN 1 AND 512
      AND account."googleSubject" = lookup_google_subject
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
        account."id",
        account."tenantId",
        account."name",
        account."email"::TEXT,
        account."role"::TEXT,
        account."isActive" AND account."accountState"::TEXT = 'ACTIVE',
        tenant."isActive"
    FROM public."User" AS account
    JOIN public."Tenant" AS tenant ON tenant."id" = account."tenantId"
    WHERE lookup_email IS NOT NULL
      AND pg_catalog.octet_length(lookup_email) BETWEEN 3 AND 320
      AND account."email" = pg_catalog.lower(pg_catalog.btrim(lookup_email))
    LIMIT 1
$function$;

CREATE FUNCTION autorfp_private.autorfp_invitation_tenant_by_digest(
    lookup_digest TEXT
)
RETURNS TABLE ("tenantId" TEXT)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT account."tenantId"
    FROM public."User" AS account
    JOIN public."Tenant" AS tenant ON tenant."id" = account."tenantId"
    WHERE lookup_digest IS NOT NULL
      AND pg_catalog.octet_length(lookup_digest) = 64
      AND pg_catalog.translate(lookup_digest, '0123456789abcdef', '') = ''
      AND account."invitationTokenDigest" = lookup_digest::CHAR(64)
      AND account."accountState"::TEXT = 'INVITED'
      AND account."invitationAcceptedAt" IS NULL
      AND account."invitationRevokedAt" IS NULL
      AND account."invitationExpiresAt" > pg_catalog.clock_timestamp()
      AND account."isActive" = true
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
          AND lookup_email = pg_catalog.lower(pg_catalog.btrim(lookup_email))
          AND account."email" = lookup_email
    )
$function$;

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
    SELECT supplier_request."tenantId", supplier_request."id"
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

CREATE FUNCTION autorfp_private.autorfp_supplier_application_grant_by_digest(
    lookup_digest TEXT
)
RETURNS TABLE (
    "tenantId" TEXT,
    "requestId" TEXT
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT request."tenantId", request."id"
    FROM public."ProcurementRequest" AS request
    JOIN public."Tenant" AS tenant ON tenant."id" = request."tenantId"
    WHERE lookup_digest IS NOT NULL
      AND pg_catalog.octet_length(lookup_digest) = 64
      AND pg_catalog.translate(lookup_digest, '0123456789abcdef', '') = ''
      AND request."applicationTokenDigest" = lookup_digest::CHAR(64)
      AND request."applicationRevokedAt" IS NULL
      AND request."applicationExpiresAt" > pg_catalog.clock_timestamp()
      AND request."status"::TEXT = 'OPEN'
      AND request."sourcing" -> 'v' = '1'::JSONB
      AND request."sourcing" #> '{default,v}' = '1'::JSONB
      AND pg_catalog.jsonb_typeof(
          request."sourcing" #> '{default,acceptVerifiedApplications}'
      ) = 'boolean'
      AND request."sourcing" #> '{default,acceptVerifiedApplications}'
          = 'true'::JSONB
      AND pg_catalog.jsonb_typeof(
          request."sourcing" #> '{default,modes}'
      ) = 'array'
      AND request."sourcing" #> '{default,modes}'
          @> '["VERIFIED_NEW"]'::JSONB
      AND tenant."isActive" = true
    LIMIT 1
$function$;

DROP POLICY tenant_isolation ON public."Tenant";
ALTER TABLE public."Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."Tenant"
    FOR ALL TO autorfp_app
    USING (
        "id" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
        "id" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    );

DROP POLICY tenant_isolation ON public."User";
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."User"
    FOR ALL TO autorfp_app
    USING (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    );

DROP POLICY tenant_isolation ON public."Menu";
ALTER TABLE public."Menu" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Menu" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."Menu"
    FOR ALL TO autorfp_app
    USING (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    );

DROP POLICY tenant_isolation ON public."Supplier";
ALTER TABLE public."Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Supplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."Supplier"
    FOR ALL TO autorfp_app
    USING (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    );

DROP POLICY tenant_isolation ON public."ProcurementRequest";
ALTER TABLE public."ProcurementRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProcurementRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."ProcurementRequest"
    FOR ALL TO autorfp_app
    USING (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    );

DROP POLICY tenant_isolation ON public."SupplierRequest";
ALTER TABLE public."SupplierRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SupplierRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."SupplierRequest"
    FOR ALL TO autorfp_app
    USING (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    );

DROP POLICY tenant_isolation ON public."Award";
ALTER TABLE public."Award" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Award" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."Award"
    FOR ALL TO autorfp_app
    USING (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    );

DROP POLICY tenant_isolation ON public."AuditEvent";
ALTER TABLE public."AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."AuditEvent"
    FOR ALL TO autorfp_app
    USING (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
        "tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')
    );

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
FROM PUBLIC, autorfp_app, autorfp_backup;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA autorfp_private
FROM PUBLIC, autorfp_app, autorfp_backup;

DO $remove_final_provider_access$
DECLARE
    target_role TEXT;
BEGIN
    FOREACH target_role IN ARRAY ARRAY[
        'anon', 'authenticated', 'service_role', 'dashboard_user',
        'authenticator'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role
        ) THEN
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA autorfp_private FROM %I',
                target_role
            );
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES ON SCHEMA public, autorfp_private FROM %I',
                target_role
            );
        END IF;
    END LOOP;
END
$remove_final_provider_access$;

GRANT USAGE ON SCHEMA public, autorfp_private TO autorfp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public."Tenant",
    public."User",
    public."Menu",
    public."Supplier",
    public."ProcurementRequest",
    public."SupplierRequest",
    public."Award",
    public."AuditEvent",
    public."RateLimitBucket"
TO autorfp_app;
GRANT EXECUTE ON FUNCTION
    autorfp_private.autorfp_auth_credentials_by_email(TEXT),
    autorfp_private.autorfp_auth_identity_by_google_subject(TEXT),
    autorfp_private.autorfp_auth_identity_by_email(TEXT),
    autorfp_private.autorfp_invitation_tenant_by_digest(TEXT),
    autorfp_private.autorfp_user_email_exists(TEXT),
    autorfp_private.autorfp_supplier_grant_by_digest(TEXT),
    autorfp_private.autorfp_supplier_application_grant_by_digest(TEXT)
TO autorfp_app;

GRANT USAGE ON SCHEMA public TO autorfp_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO autorfp_backup;

COMMENT ON SCHEMA autorfp_private IS
    'quoteplate:migration:20260831000100_compact_nine_table_schema';

COMMIT;
