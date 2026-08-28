BEGIN;

DO $migration_owner$
DECLARE
    owner_can_bypass BOOLEAN;
BEGIN
    SELECT role.rolsuper OR role.rolbypassrls
    INTO owner_can_bypass
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user;

    IF current_user NOT IN ('postgres', 'autorfp')
       OR COALESCE(owner_can_bypass, false) = false
    THEN
        RAISE EXCEPTION 'Menu retirement migration requires the direct postgres/local autorfp administrator connection';
    END IF;
END
$migration_owner$;

ALTER TABLE "Recipe" ADD COLUMN "retiredAt" TIMESTAMP(3);

COMMIT;
