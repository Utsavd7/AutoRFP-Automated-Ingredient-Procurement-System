BEGIN;

DO $migration_owner$
DECLARE
    owner_can_bypass BOOLEAN;
    owner_owns_recipe BOOLEAN;
BEGIN
    SELECT pg_catalog.bool_or(
        (role.rolsuper OR role.rolbypassrls)
        AND pg_catalog.pg_has_role(current_user, role.oid, 'USAGE')
    )
    INTO owner_can_bypass
    FROM pg_catalog.pg_roles AS role;

    SELECT class.relowner = current_user::pg_catalog.regrole
    INTO owner_owns_recipe
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = 'Recipe'
      AND class.relkind = 'r';

    IF COALESCE(owner_can_bypass, false) = false
       OR COALESCE(owner_owns_recipe, false) = false
    THEN
        RAISE EXCEPTION 'Menu retirement migration requires a row-security-bypassing owner of Recipe';
    END IF;
END
$migration_owner$;

ALTER TABLE "Recipe" ADD COLUMN "retiredAt" TIMESTAMP(3);

COMMIT;
