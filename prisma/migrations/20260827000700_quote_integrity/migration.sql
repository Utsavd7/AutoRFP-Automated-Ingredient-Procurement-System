BEGIN;

DO $migration_owner$
DECLARE
    owns_quote_tables BOOLEAN;
BEGIN
    SELECT pg_catalog.count(*) = 2
           AND pg_catalog.bool_and(class.relowner = current_user::pg_catalog.regrole)
    INTO owns_quote_tables
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname IN ('SupplierQuote', 'SupplierQuoteItem')
      AND class.relkind IN ('r', 'p');

    IF COALESCE(owns_quote_tables, false) = false THEN
        RAISE EXCEPTION 'Quote integrity migration requires the owner of the supplier quote tables';
    END IF;
END
$migration_owner$;

ALTER TABLE "SupplierQuote"
  ADD CONSTRAINT "SupplierQuote_landed_total_check"
  CHECK (
    "totalPaise" = "subtotalPaise" + "gstPaise" + "freightPaise"
  );

ALTER TABLE "SupplierQuoteItem"
  ADD CONSTRAINT "SupplierQuoteItem_line_total_check"
  CHECK ("totalPaise" = "subtotalPaise" + "gstPaise"),
  ADD CONSTRAINT "SupplierQuoteItem_quote_shape_check"
  CHECK (
    (
      "noQuote" = true
      AND "availableQuantity" IS NULL
      AND "unit" IS NULL
      AND "unitRatePaise" IS NULL
      AND "gstBasisPoints" IS NULL
      AND "taxInclusive" = false
      AND "substitution" IS NULL
      AND "subtotalPaise" = 0
      AND "gstPaise" = 0
      AND "totalPaise" = 0
    )
    OR
    (
      "noQuote" = false
      AND "availableQuantity" IS NOT NULL
      AND "unit" IS NOT NULL
      AND "unitRatePaise" IS NOT NULL
      AND "gstBasisPoints" IS NOT NULL
    )
  );

COMMIT;
