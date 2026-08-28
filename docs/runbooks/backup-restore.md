# Backup and restore runbook

QuotePlate creates an encrypted PostgreSQL backup every day. Backblaze B2 stores only `.dump.gz.age` objects. Retention is at most **seven daily** and **four monthly** restore points, and the upload fails before total backup storage reaches 8 GiB.

## Cardless B2 setup

1. Create a private B2 bucket on an account with no payment method. Set conservative account caps and alerts below the free allowance.
2. Create one application key restricted to that bucket. It may list, read, write, and delete backup objects only.
3. Generate an age identity offline with the open-source `age-keygen`. Keep the private identity out of the repository; store the recipient separately.
4. After production migrations create `autorfp_backup`, connect as the Neon owner through an interactive `psql` prompt and run `\password autorfp_backup`. Enter a separate random password twice. This role is read-only and has no ownership, write, function-execution, database-creation, role-creation, replication, inheritance, or superuser privilege. Its one elevated attribute is `BYPASSRLS`, which is required for a complete dump of every tenant protected by forced row-level security. Treat the credential as sensitive and never use it in the application.
5. Build `NEON_BACKUP_DATABASE_URL` with `autorfp_backup` and Neon's direct PostgreSQL 17 endpoint. Do not use the pooled application URL or the migration owner URL.
6. Create a protected GitHub environment named `production-backup`. Add `NEON_BACKUP_DATABASE_URL`, `NEON_RESTORE_DATABASE_URL`, `AGE_BACKUP_RECIPIENT`, `AGE_BACKUP_IDENTITY`, `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, and `B2_BUCKET_NAME` only as environment secrets.
7. The restore URL must point to an otherwise unused database whose name starts with `quoteplate_restore_`. The script refuses every other database name.

The `rclone` B2 backend is open source and receives credentials only through runner environment variables. No configuration file or generated plaintext dump is uploaded.

## Daily backup

The scheduled workflow installs the signed PostgreSQL 17 client from PostgreSQL's official package repository, then runs `pg_dump` as the dedicated backup role, gzip, age encryption, the 8 GiB capacity check, encrypted upload, and exact-object retention. The archive preserves PostgreSQL ACLs so restored schema, table, and function grants remain usable. It never deletes a bucket or prefix. On the first UTC day of each month it also saves a monthly copy and verifies the same encrypted dump in the disposable restore database.

Database, storage, and age decryption credentials are scoped only to the workflow step that needs each one. Checkout and package installation receive no production secrets. The migration owner credential is not present in the scheduled backup environment.

Run a manual backup only after checking current storage and GitHub Actions usage. Repeated manual runs consume free resources.

## Local verification

Install PostgreSQL client tools, `age`, and `rclone`. Point `BACKUP_DATABASE_URL` at a disposable PostgreSQL database and configure an isolated test rclone remote/bucket. Run `scripts/backup-postgres.sh`, download the resulting encrypted object, and run:

```sh
RESTORE_DATABASE_URL='postgresql://.../quoteplate_restore_local' \
AGE_IDENTITY_FILE='/absolute/path/to/age-identity.txt' \
scripts/restore-verify.sh '/absolute/path/to/quoteplate-....dump.gz.age'
```

The restore script clears only the validated disposable database. Before loading ACLs it ensures the exact `autorfp_app` and `autorfp_backup` roles exist so their preserved grants can be restored; it never creates or changes a password. The runtime role has no row-security bypass, while the backup role is read-only and has the bypass required to read all forced-RLS rows. Either role having unsafe attributes or inherited membership makes recovery fail closed.

After restore, verification uses `SET LOCAL ROLE autorfp_app` and a nonexistent tenant context. It proves `public` and `autorfp_private` schema usage, `Tenant` table read permission, execution of the fixed authentication function, active row-level security, and a tenant-filtered table read. It then clears both application schemas again, which makes consecutive monthly checks safe. A production restore requires a separate incident decision, an exact recovery point, owner approval, and a fresh backup of current production first; this automation intentionally cannot target production.
