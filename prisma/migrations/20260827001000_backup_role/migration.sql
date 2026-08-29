BEGIN;

-- Logical backups must see every tenant despite FORCE ROW LEVEL SECURITY, but
-- they do not need ownership or any write, function, or role-management grant.
DO $backup_role$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_backup'
    ) THEN
        CREATE ROLE autorfp_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
            NOINHERIT NOREPLICATION BYPASSRLS;
    END IF;
END
$backup_role$;

DO $backup_role_membership$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members
        WHERE member = (
            SELECT oid FROM pg_catalog.pg_roles
            WHERE rolname = 'autorfp_backup'
        )
    ) THEN
        RAISE EXCEPTION 'autorfp_backup must not inherit membership in another role; create it directly with SQL instead of a provider console';
    END IF;
END
$backup_role_membership$;

DO $backup_role_attributes$
DECLARE
    backup_role_is_safe BOOLEAN;
BEGIN
    SELECT role.rolcanlogin
           AND NOT role.rolsuper
           AND NOT role.rolcreatedb
           AND NOT role.rolcreaterole
           AND NOT role.rolinherit
           AND NOT role.rolreplication
           AND role.rolbypassrls
    INTO backup_role_is_safe
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = 'autorfp_backup';

    IF COALESCE(backup_role_is_safe, false) = false THEN
        RAISE EXCEPTION 'autorfp_backup has unsafe role attributes';
    END IF;
END
$backup_role_attributes$;

DO $backup_database_access$
BEGIN
    EXECUTE format(
        'REVOKE ALL PRIVILEGES ON DATABASE %I FROM autorfp_backup',
        current_database()
    );
    EXECUTE format(
        'GRANT CONNECT ON DATABASE %I TO autorfp_backup',
        current_database()
    );
END
$backup_database_access$;

REVOKE ALL PRIVILEGES ON SCHEMA public, autorfp_private
FROM autorfp_backup;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
FROM autorfp_backup;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
FROM autorfp_backup;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public, autorfp_private
FROM autorfp_backup;

GRANT USAGE ON SCHEMA public, autorfp_private TO autorfp_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO autorfp_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO autorfp_backup;

-- Keep future migration-created tables readable without widening the role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON FUNCTIONS FROM autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON TABLES FROM autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA autorfp_private
    REVOKE ALL PRIVILEGES ON FUNCTIONS FROM autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO autorfp_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO autorfp_backup;

COMMIT;
