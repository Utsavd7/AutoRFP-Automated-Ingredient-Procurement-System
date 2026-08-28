-- The prototype tables are not production authority. Snapshot only tenant/menu
-- composition that has credible ownership before replacing the legacy shape.
CREATE TEMP TABLE "_launch_tenants" ON COMMIT DROP AS
WITH normalized AS (
    SELECT
        tenant.*,
        lower(NULLIF(btrim(tenant."email"), '')) AS normalized_email,
        row_number() OVER (
            PARTITION BY lower(NULLIF(btrim(tenant."email"), ''))
            ORDER BY tenant."createdAt", tenant."id"
        ) AS email_rank,
        md5('legacy-owner:' || tenant."id") AS owner_hash
    FROM "Tenant" tenant
)
SELECT
    "id",
    COALESCE(NULLIF(btrim("restaurantName"), ''), 'Imported restaurant') AS "name",
    COALESCE(NULLIF(btrim("location"), ''), 'LEGACY_REVIEW_REQUIRED') AS "addressLine",
    'LEGACY_REVIEW_REQUIRED'::TEXT AS "city",
    'LEGACY_REVIEW_REQUIRED'::TEXT AS "state",
    '000000'::TEXT AS "pin",
    'LEGACY_REVIEW_REQUIRED'::TEXT AS "phone",
    "createdAt",
    "updatedAt",
    "passwordHash",
    "passwordSalt" AS "legacyPasswordSalt",
    (
        substr(owner_hash, 1, 8) || '-' ||
        substr(owner_hash, 9, 4) || '-4' ||
        substr(owner_hash, 14, 3) || '-8' ||
        substr(owner_hash, 18, 3) || '-' ||
        substr(owner_hash, 21, 12)
    )::TEXT AS "ownerUserId",
    CASE
        WHEN normalized_email IS NOT NULL
            AND length(normalized_email) <= 320
            AND email_rank = 1
        THEN normalized_email
        ELSE 'legacy+' || substr(md5('legacy-email:' || "id"), 1, 24) || '@invalid.local'
    END::VARCHAR(320) AS "ownerEmail"
FROM normalized;

-- A menu without an explicit tenant is only credible when the legacy database
-- has exactly one tenant. Stop before any destructive DROP when ownership is
-- ambiguous so an operator can repair the legacy rows and rerun safely.
DO $launch_ownership_guard$
BEGIN
    IF (SELECT count(*) FROM "_launch_tenants") <> 1
        AND EXISTS (SELECT 1 FROM "Menu" WHERE "tenantId" IS NULL)
    THEN
        RAISE EXCEPTION 'Launch migration blocked: unresolved legacy Menu.tenantId values. Assign every legacy Menu.tenantId to an existing Tenant before rerunning.';
    END IF;
END
$launch_ownership_guard$;

CREATE TEMP TABLE "_launch_menus" ON COMMIT DROP AS
WITH tenant_summary AS (
    SELECT count(*) AS tenant_count, min("id") AS only_tenant_id
    FROM "_launch_tenants"
), resolved AS (
    SELECT
        menu.*,
        COALESCE(
            menu."tenantId",
            CASE
                WHEN tenant_summary.tenant_count = 1
                THEN tenant_summary.only_tenant_id
                ELSE NULL
            END
        ) AS resolved_tenant_id
    FROM "Menu" menu
    CROSS JOIN tenant_summary
)
SELECT
    resolved."id",
    resolved.resolved_tenant_id AS "tenantId",
    COALESCE(NULLIF(btrim(resolved."mealName"), ''), 'Imported menu') AS "name",
    resolved."text" AS "sourceText",
    tenant."ownerUserId" AS "createdByUserId",
    resolved."lastActivityAt" AS "createdAt",
    resolved."lastActivityAt" AS "updatedAt"
FROM resolved
JOIN "_launch_tenants" tenant ON tenant."id" = resolved.resolved_tenant_id;

CREATE TEMP TABLE "_launch_recipes" ON COMMIT DROP AS
SELECT
    recipe."id",
    menu."tenantId",
    recipe."menuId",
    COALESCE(NULLIF(btrim(recipe."name"), ''), 'Imported recipe') AS "name",
    (
        row_number() OVER (
            PARTITION BY recipe."menuId"
            ORDER BY recipe."name", recipe."id"
        ) - 1
    )::INTEGER AS "position"
FROM "Recipe" recipe
JOIN "_launch_menus" menu ON menu."id" = recipe."menuId";

CREATE TEMP TABLE "_launch_ingredients" ON COMMIT DROP AS
WITH normalized_ingredients AS (
    SELECT
        ingredient.*,
        CASE
            WHEN ingredient."quantity" IS NOT NULL
                AND ingredient."quantity"::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
                AND ingredient."quantity" > 0
                AND ingredient."quantity" < 1000000000000000
            THEN round(ingredient."quantity"::NUMERIC, 3)
            ELSE NULL
        END AS rounded_quantity
    FROM "Ingredient" ingredient
)
SELECT
    ingredient."id",
    recipe."tenantId",
    ingredient."recipeId",
    COALESCE(NULLIF(btrim(ingredient."name"), ''), 'Imported ingredient') AS "name",
    CASE
        WHEN ingredient.rounded_quantity > 0
            AND ingredient.rounded_quantity <= 999999999999999.999
        THEN ingredient.rounded_quantity::DECIMAL(18,3)
        ELSE 1.000::DECIMAL(18,3)
    END AS "quantity",
    CASE lower(btrim(COALESCE(ingredient."unit", '')))
        WHEN 'kg' THEN 'KILOGRAM'
        WHEN 'kgs' THEN 'KILOGRAM'
        WHEN 'kilogram' THEN 'KILOGRAM'
        WHEN 'kilograms' THEN 'KILOGRAM'
        WHEN 'g' THEN 'GRAM'
        WHEN 'gm' THEN 'GRAM'
        WHEN 'gms' THEN 'GRAM'
        WHEN 'gram' THEN 'GRAM'
        WHEN 'grams' THEN 'GRAM'
        WHEN 'l' THEN 'LITRE'
        WHEN 'ltr' THEN 'LITRE'
        WHEN 'litre' THEN 'LITRE'
        WHEN 'litres' THEN 'LITRE'
        WHEN 'liter' THEN 'LITRE'
        WHEN 'liters' THEN 'LITRE'
        WHEN 'ml' THEN 'MILLILITRE'
        WHEN 'millilitre' THEN 'MILLILITRE'
        WHEN 'millilitres' THEN 'MILLILITRE'
        WHEN 'milliliter' THEN 'MILLILITRE'
        WHEN 'milliliters' THEN 'MILLILITRE'
        WHEN 'piece' THEN 'PIECE'
        WHEN 'pieces' THEN 'PIECE'
        WHEN 'pc' THEN 'PIECE'
        WHEN 'pcs' THEN 'PIECE'
        WHEN 'unit' THEN 'PIECE'
        WHEN 'units' THEN 'PIECE'
        WHEN 'each' THEN 'PIECE'
        WHEN 'pack' THEN 'PACK'
        WHEN 'packs' THEN 'PACK'
        WHEN 'packet' THEN 'PACK'
        WHEN 'packets' THEN 'PACK'
        WHEN 'case' THEN 'CASE'
        WHEN 'cases' THEN 'CASE'
        WHEN 'crate' THEN 'CRATE'
        WHEN 'crates' THEN 'CRATE'
        -- Unknown prototype units remain unverified. PIECE is a structural
        -- fallback only; imported menus stay DRAFT for owner correction.
        ELSE 'PIECE'
    END AS "unit",
    (
        row_number() OVER (
            PARTITION BY ingredient."recipeId"
            ORDER BY ingredient."name", ingredient."id"
        ) - 1
    )::INTEGER AS "position"
FROM normalized_ingredients ingredient
JOIN "_launch_recipes" recipe ON recipe."id" = ingredient."recipeId";

-- Prototype quote, distributor, trend, and dashboard-run rows are explicitly
-- non-authoritative and are removed only after the preservation snapshots exist.
DROP TABLE "Quote";
DROP TABLE "PricingTrend";
DROP TABLE "RFP";
DROP TABLE "Distributor";
DROP TABLE "ProcurementRun";
DROP TABLE "Ingredient";
DROP TABLE "Recipe";
DROP TABLE "Menu";
DROP TABLE "Tenant";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "MenuStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "ProcurementRequestStatus" AS ENUM ('DRAFT', 'OPEN', 'AWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcurementUnit" AS ENUM ('KILOGRAM', 'GRAM', 'LITRE', 'MILLILITRE', 'PIECE', 'PACK', 'CASE', 'CRATE');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "gstin" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" TEXT,
    "legacyPasswordSalt" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "User_email_lowercase_check" CHECK ("email" = lower("email"))
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("provider", "providerAccountId")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "tokenDigest" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invitation_tokenDigest_length_check" CHECK (length("tokenDigest") = 64),
    CONSTRAINT "Invitation_expiry_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceText" TEXT,
    "status" "MenuStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Menu_version_check" CHECK ("version" > 0)
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Recipe_position_check" CHECK ("position" >= 0)
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" "ProcurementUnit" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Ingredient_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "Ingredient_position_check" CHECK ("position" >= 0)
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "whatsappNumber" TEXT,
    "email" VARCHAR(320),
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pin" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProcurementRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "menuId" TEXT,
    "sourceRequestId" TEXT,
    "deliveryDetails" JSONB NOT NULL,
    "deliveryDate" DATE NOT NULL,
    "quoteDeadline" TIMESTAMP(3) NOT NULL,
    "commercialTerms" TEXT,
    "openedAt" TIMESTAMP(3),
    "awardedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProcurementRequest_version_check" CHECK ("version" > 0),
    CONSTRAINT "ProcurementRequest_deliveryDetails_size_check" CHECK (octet_length("deliveryDetails"::TEXT) <= 16384),
    CONSTRAINT "ProcurementRequest_quoteDeadline_check" CHECK ("quoteDeadline" >= "createdAt"),
    CONSTRAINT "ProcurementRequest_deliveryDate_check" CHECK ("deliveryDate" >= "quoteDeadline"::DATE)
);

-- CreateTable
CREATE TABLE "RequestItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceIngredientId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" "ProcurementUnit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RequestItem_quantity_check" CHECK ("quantity" > 0)
);

-- CreateTable
CREATE TABLE "SupplierRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tokenDigest" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierRequest_tokenDigest_length_check" CHECK (length("tokenDigest") = 64),
    CONSTRAINT "SupplierRequest_expiry_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierRequestId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "subtotalPaise" BIGINT NOT NULL,
    "gstPaise" BIGINT NOT NULL,
    "freightPaise" BIGINT NOT NULL,
    "totalPaise" BIGINT NOT NULL,
    "deliveryDate" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "commercialTerms" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierQuote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierQuote_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "SupplierQuote_subtotalPaise_check" CHECK ("subtotalPaise" >= 0),
    CONSTRAINT "SupplierQuote_gstPaise_check" CHECK ("gstPaise" >= 0),
    CONSTRAINT "SupplierQuote_freightPaise_check" CHECK ("freightPaise" >= 0),
    CONSTRAINT "SupplierQuote_totalPaise_check" CHECK ("totalPaise" >= 0),
    CONSTRAINT "SupplierQuote_deliveryDate_check" CHECK ("deliveryDate" >= "submittedAt"::DATE),
    CONSTRAINT "SupplierQuote_validUntil_check" CHECK ("validUntil" >= "submittedAt"::DATE)
);

-- CreateTable
CREATE TABLE "SupplierQuoteItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "noQuote" BOOLEAN NOT NULL,
    "availableQuantity" DECIMAL(18,3),
    "unit" "ProcurementUnit",
    "unitRatePaise" BIGINT,
    "gstBasisPoints" INTEGER,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "substitution" TEXT,
    "subtotalPaise" BIGINT NOT NULL,
    "gstPaise" BIGINT NOT NULL,
    "totalPaise" BIGINT NOT NULL,

    CONSTRAINT "SupplierQuoteItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierQuoteItem_availableQuantity_check" CHECK ("availableQuantity" IS NULL OR "availableQuantity" > 0),
    CONSTRAINT "SupplierQuoteItem_unitRatePaise_check" CHECK ("unitRatePaise" IS NULL OR "unitRatePaise" >= 0),
    CONSTRAINT "SupplierQuoteItem_gstBasisPoints_check" CHECK ("gstBasisPoints" IS NULL OR "gstBasisPoints" BETWEEN 0 AND 10000),
    CONSTRAINT "SupplierQuoteItem_subtotalPaise_check" CHECK ("subtotalPaise" >= 0),
    CONSTRAINT "SupplierQuoteItem_gstPaise_check" CHECK ("gstPaise" >= 0),
    CONSTRAINT "SupplierQuoteItem_totalPaise_check" CHECK ("totalPaise" >= 0)
);

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "rationale" TEXT,
    "supplierSnapshots" JSONB NOT NULL,
    "deliverySnapshot" JSONB NOT NULL,
    "totalPaise" BIGINT NOT NULL,
    "awardedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Award_supplierSnapshots_size_check" CHECK (octet_length("supplierSnapshots"::TEXT) <= 16384),
    CONSTRAINT "Award_deliverySnapshot_size_check" CHECK (octet_length("deliverySnapshot"::TEXT) <= 16384),
    CONSTRAINT "Award_totalPaise_check" CHECK ("totalPaise" >= 0)
);

-- CreateTable
CREATE TABLE "AwardLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "awardId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "supplierQuoteItemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" "ProcurementUnit" NOT NULL,
    "unitRatePaise" BIGINT NOT NULL,
    "gstBasisPoints" INTEGER NOT NULL,
    "subtotalPaise" BIGINT NOT NULL,
    "gstPaise" BIGINT NOT NULL,
    "totalPaise" BIGINT NOT NULL,

    CONSTRAINT "AwardLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AwardLine_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "AwardLine_unitRatePaise_check" CHECK ("unitRatePaise" >= 0),
    CONSTRAINT "AwardLine_gstBasisPoints_check" CHECK ("gstBasisPoints" BETWEEN 0 AND 10000),
    CONSTRAINT "AwardLine_subtotalPaise_check" CHECK ("subtotalPaise" >= 0),
    CONSTRAINT "AwardLine_gstPaise_check" CHECK ("gstPaise" >= 0),
    CONSTRAINT "AwardLine_totalPaise_check" CHECK ("totalPaise" >= 0)
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditEvent_metadata_size_check" CHECK ("metadata" IS NULL OR octet_length("metadata"::TEXT) <= 16384)
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "keyDigest" CHAR(64) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("keyDigest"),
    CONSTRAINT "RateLimitBucket_keyDigest_length_check" CHECK (length("keyDigest") = 64),
    CONSTRAINT "RateLimitBucket_count_check" CHECK ("count" >= 0)
);

-- Preserve credible legacy data. Tenant contact/location sentinels are
-- intentionally invalid-looking so Settings can require owner correction.
INSERT INTO "Tenant" (
    "id", "name", "addressLine", "city", "state", "pin", "phone",
    "timezone", "gstin", "isActive", "createdAt", "updatedAt"
)
SELECT
    "id", "name", "addressLine", "city", "state", "pin", "phone",
    'Asia/Kolkata', NULL, true, "createdAt", "updatedAt"
FROM "_launch_tenants";

INSERT INTO "User" (
    "id", "tenantId", "name", "email", "passwordHash",
    "legacyPasswordSalt", "role", "isActive", "lastLoginAt",
    "createdAt", "updatedAt"
)
SELECT
    "ownerUserId", "id", "name" || ' Owner', "ownerEmail", "passwordHash",
    "legacyPasswordSalt", 'OWNER'::"UserRole", true, NULL,
    "createdAt", "updatedAt"
FROM "_launch_tenants";

INSERT INTO "Menu" (
    "id", "tenantId", "name", "sourceText", "status", "version",
    "approvedAt", "approvedByUserId", "createdByUserId", "createdAt", "updatedAt"
)
SELECT
    "id", "tenantId", "name", "sourceText", 'DRAFT'::"MenuStatus", 1,
    NULL, NULL, "createdByUserId", "createdAt", "updatedAt"
FROM "_launch_menus";

INSERT INTO "Recipe" ("id", "tenantId", "menuId", "name", "position")
SELECT "id", "tenantId", "menuId", "name", "position"
FROM "_launch_recipes";

INSERT INTO "Ingredient" (
    "id", "tenantId", "recipeId", "name", "quantity", "unit", "position"
)
SELECT
    "id", "tenantId", "recipeId", "name", "quantity",
    "unit"::"ProcurementUnit", "position"
FROM "_launch_ingredients";

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");
CREATE INDEX "User_tenantId_isActive_idx" ON "User"("tenantId", "isActive");
CREATE UNIQUE INDEX "ExternalIdentity_tenantId_userId_provider_key" ON "ExternalIdentity"("tenantId", "userId", "provider");
CREATE UNIQUE INDEX "Invitation_tokenDigest_key" ON "Invitation"("tokenDigest");
CREATE INDEX "Invitation_tenantId_email_acceptedAt_revokedAt_expiresAt_idx" ON "Invitation"("tenantId", "email", "acceptedAt", "revokedAt", "expiresAt");
CREATE INDEX "Invitation_tenantId_invitedByUserId_idx" ON "Invitation"("tenantId", "invitedByUserId");
CREATE UNIQUE INDEX "Menu_tenantId_id_key" ON "Menu"("tenantId", "id");
CREATE INDEX "Menu_tenantId_status_updatedAt_idx" ON "Menu"("tenantId", "status", "updatedAt");
CREATE INDEX "Menu_tenantId_approvedByUserId_idx" ON "Menu"("tenantId", "approvedByUserId");
CREATE INDEX "Menu_tenantId_createdByUserId_idx" ON "Menu"("tenantId", "createdByUserId");
CREATE UNIQUE INDEX "Recipe_tenantId_id_key" ON "Recipe"("tenantId", "id");
CREATE INDEX "Recipe_tenantId_menuId_position_idx" ON "Recipe"("tenantId", "menuId", "position");
CREATE UNIQUE INDEX "Ingredient_tenantId_id_key" ON "Ingredient"("tenantId", "id");
CREATE INDEX "Ingredient_tenantId_recipeId_position_idx" ON "Ingredient"("tenantId", "recipeId", "position");
CREATE UNIQUE INDEX "Supplier_tenantId_id_key" ON "Supplier"("tenantId", "id");
CREATE INDEX "Supplier_tenantId_isActive_businessName_idx" ON "Supplier"("tenantId", "isActive", "businessName");
CREATE INDEX "Supplier_tenantId_verifiedByUserId_idx" ON "Supplier"("tenantId", "verifiedByUserId");
CREATE UNIQUE INDEX "ProcurementRequest_tenantId_id_key" ON "ProcurementRequest"("tenantId", "id");
CREATE INDEX "ProcurementRequest_tenantId_status_quoteDeadline_idx" ON "ProcurementRequest"("tenantId", "status", "quoteDeadline");
CREATE INDEX "ProcurementRequest_tenantId_createdAt_idx" ON "ProcurementRequest"("tenantId", "createdAt");
CREATE INDEX "ProcurementRequest_tenantId_menuId_idx" ON "ProcurementRequest"("tenantId", "menuId");
CREATE INDEX "ProcurementRequest_tenantId_sourceRequestId_idx" ON "ProcurementRequest"("tenantId", "sourceRequestId");
CREATE INDEX "ProcurementRequest_tenantId_createdByUserId_idx" ON "ProcurementRequest"("tenantId", "createdByUserId");
CREATE UNIQUE INDEX "RequestItem_tenantId_id_key" ON "RequestItem"("tenantId", "id");
CREATE INDEX "RequestItem_tenantId_requestId_idx" ON "RequestItem"("tenantId", "requestId");
CREATE INDEX "RequestItem_tenantId_sourceIngredientId_idx" ON "RequestItem"("tenantId", "sourceIngredientId");
CREATE UNIQUE INDEX "SupplierRequest_tokenDigest_key" ON "SupplierRequest"("tokenDigest");
CREATE UNIQUE INDEX "SupplierRequest_tenantId_id_key" ON "SupplierRequest"("tenantId", "id");
CREATE INDEX "SupplierRequest_tenantId_supplierId_idx" ON "SupplierRequest"("tenantId", "supplierId");
CREATE UNIQUE INDEX "SupplierRequest_tenantId_requestId_supplierId_key" ON "SupplierRequest"("tenantId", "requestId", "supplierId");
CREATE UNIQUE INDEX "SupplierQuote_tenantId_id_key" ON "SupplierQuote"("tenantId", "id");
CREATE UNIQUE INDEX "SupplierQuote_tenantId_supplierRequestId_revision_key" ON "SupplierQuote"("tenantId", "supplierRequestId", "revision");
CREATE UNIQUE INDEX "SupplierQuoteItem_tenantId_id_key" ON "SupplierQuoteItem"("tenantId", "id");
CREATE INDEX "SupplierQuoteItem_tenantId_requestItemId_idx" ON "SupplierQuoteItem"("tenantId", "requestItemId");
CREATE UNIQUE INDEX "SupplierQuoteItem_tenantId_quoteId_requestItemId_key" ON "SupplierQuoteItem"("tenantId", "quoteId", "requestItemId");
CREATE UNIQUE INDEX "Award_requestId_key" ON "Award"("requestId");
CREATE UNIQUE INDEX "Award_tenantId_id_key" ON "Award"("tenantId", "id");
CREATE UNIQUE INDEX "Award_tenantId_requestId_key" ON "Award"("tenantId", "requestId");
CREATE INDEX "Award_tenantId_createdAt_idx" ON "Award"("tenantId", "createdAt");
CREATE INDEX "Award_tenantId_awardedByUserId_idx" ON "Award"("tenantId", "awardedByUserId");
CREATE INDEX "AwardLine_tenantId_awardId_supplierId_idx" ON "AwardLine"("tenantId", "awardId", "supplierId");
CREATE INDEX "AwardLine_tenantId_requestItemId_idx" ON "AwardLine"("tenantId", "requestItemId");
CREATE INDEX "AwardLine_tenantId_supplierQuoteItemId_idx" ON "AwardLine"("tenantId", "supplierQuoteItemId");
CREATE UNIQUE INDEX "AwardLine_tenantId_awardId_requestItemId_supplierQuoteItemI_key" ON "AwardLine"("tenantId", "awardId", "requestItemId", "supplierQuoteItemId");
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");
CREATE INDEX "AuditEvent_tenantId_entityType_entityId_idx" ON "AuditEvent"("tenantId", "entityType", "entityId");
CREATE INDEX "AuditEvent_tenantId_actorUserId_idx" ON "AuditEvent"("tenantId", "actorUserId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_invitedByUserId_fkey" FOREIGN KEY ("tenantId", "invitedByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_tenantId_approvedByUserId_fkey" FOREIGN KEY ("tenantId", "approvedByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_tenantId_menuId_fkey" FOREIGN KEY ("tenantId", "menuId") REFERENCES "Menu"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_tenantId_recipeId_fkey" FOREIGN KEY ("tenantId", "recipeId") REFERENCES "Recipe"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_verifiedByUserId_fkey" FOREIGN KEY ("tenantId", "verifiedByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementRequest" ADD CONSTRAINT "ProcurementRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementRequest" ADD CONSTRAINT "ProcurementRequest_tenantId_menuId_fkey" FOREIGN KEY ("tenantId", "menuId") REFERENCES "Menu"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementRequest" ADD CONSTRAINT "ProcurementRequest_tenantId_sourceRequestId_fkey" FOREIGN KEY ("tenantId", "sourceRequestId") REFERENCES "ProcurementRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementRequest" ADD CONSTRAINT "ProcurementRequest_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_tenantId_requestId_fkey" FOREIGN KEY ("tenantId", "requestId") REFERENCES "ProcurementRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_tenantId_sourceIngredientId_fkey" FOREIGN KEY ("tenantId", "sourceIngredientId") REFERENCES "Ingredient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_tenantId_requestId_fkey" FOREIGN KEY ("tenantId", "requestId") REFERENCES "ProcurementRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "Supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_tenantId_supplierRequestId_fkey" FOREIGN KEY ("tenantId", "supplierRequestId") REFERENCES "SupplierRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierQuoteItem" ADD CONSTRAINT "SupplierQuoteItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierQuoteItem" ADD CONSTRAINT "SupplierQuoteItem_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "SupplierQuote"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierQuoteItem" ADD CONSTRAINT "SupplierQuoteItem_tenantId_requestItemId_fkey" FOREIGN KEY ("tenantId", "requestItemId") REFERENCES "RequestItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Award" ADD CONSTRAINT "Award_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Award" ADD CONSTRAINT "Award_tenantId_requestId_fkey" FOREIGN KEY ("tenantId", "requestId") REFERENCES "ProcurementRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Award" ADD CONSTRAINT "Award_tenantId_awardedByUserId_fkey" FOREIGN KEY ("tenantId", "awardedByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AwardLine" ADD CONSTRAINT "AwardLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AwardLine" ADD CONSTRAINT "AwardLine_tenantId_awardId_fkey" FOREIGN KEY ("tenantId", "awardId") REFERENCES "Award"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AwardLine" ADD CONSTRAINT "AwardLine_tenantId_requestItemId_fkey" FOREIGN KEY ("tenantId", "requestItemId") REFERENCES "RequestItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AwardLine" ADD CONSTRAINT "AwardLine_tenantId_supplierQuoteItemId_fkey" FOREIGN KEY ("tenantId", "supplierQuoteItemId") REFERENCES "SupplierQuoteItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AwardLine" ADD CONSTRAINT "AwardLine_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "Supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_actorUserId_fkey" FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
