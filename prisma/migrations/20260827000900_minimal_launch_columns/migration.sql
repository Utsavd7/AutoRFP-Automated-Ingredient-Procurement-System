BEGIN;

DO $migration_owner$
DECLARE
    owns_required_tables BOOLEAN;
BEGIN
    SELECT pg_catalog.count(*) = 3
           AND pg_catalog.bool_and(class.relowner = current_user::pg_catalog.regrole)
    INTO owns_required_tables
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname IN ('Recipe', 'RequestItem', 'Supplier')
      AND class.relkind IN ('r', 'p');

    IF COALESCE(owns_required_tables, false) = false THEN
        RAISE EXCEPTION 'Minimal launch column migration requires the owner of Recipe, RequestItem, and Supplier';
    END IF;

END
$migration_owner$;

ALTER TABLE "RequestItem"
  DROP CONSTRAINT "RequestItem_tenantId_sourceIngredientId_fkey";

DROP INDEX "RequestItem_tenantId_sourceIngredientId_idx";

ALTER TABLE "RequestItem"
  DROP COLUMN "sourceIngredientId";

-- Issued requests already contain immutable name, quantity, and unit snapshots.
-- Retired menu children are therefore redundant once the source link is gone.
-- The verified table owner may not bypass forced RLS, and migration sessions do
-- not carry a tenant context. Temporarily let the owner perform this global
-- cleanup, then restore forced RLS before removing the retirement marker.
ALTER TABLE "Recipe" NO FORCE ROW LEVEL SECURITY;

DELETE FROM "Recipe"
WHERE "retiredAt" IS NOT NULL;

ALTER TABLE "Recipe" FORCE ROW LEVEL SECURITY;

ALTER TABLE "Recipe"
  DROP COLUMN "retiredAt";

ALTER TABLE "Supplier"
  DROP CONSTRAINT "Supplier_tenantId_verifiedByUserId_fkey";

DROP INDEX "Supplier_tenantId_verifiedByUserId_idx";

ALTER TABLE "Supplier"
  DROP COLUMN "verifiedAt",
  DROP COLUMN "verifiedByUserId";

COMMIT;
