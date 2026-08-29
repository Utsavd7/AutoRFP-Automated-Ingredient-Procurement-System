import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function writeExecutable(path: string, contents: string) {
  writeFileSync(path, contents, 'utf8');
  chmodSync(path, 0o755);
}

function mockToolDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'quoteplate-ops-tools-'));
  const rcloneLog = join(directory, 'rclone.log');
  const restoreLog = join(directory, 'restore.log');
  const dumpLog = join(directory, 'dump.log');

  writeExecutable(join(directory, 'pg_dump'), `#!/bin/sh
printf 'pg_dump %s\\n' "$*" >> "$MOCK_DUMP_LOG"
output=
for value do
  case "$value" in --file=*) output=\${value#--file=} ;; esac
done
[ -n "$output" ] || exit 64
printf %s test-database-dump > "$output"
`);
  writeExecutable(join(directory, 'gzip'), `#!/bin/sh
case " $* " in
  *" -dc "*)
    for value do input=$value; done
    cat "$input"
    ;;
  *) cat ;;
esac
`);
  writeExecutable(join(directory, 'age'), `#!/bin/sh
output=
decrypt=0
input=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output|-o) output=$2; shift 2 ;;
    --decrypt|-d) decrypt=1; shift ;;
    --recipient|-r|--identity|-i) shift 2 ;;
    --encrypt|-e) shift ;;
    *) input=$1; shift ;;
  esac
done
if [ "$decrypt" -eq 1 ]; then
  if [ -n "$output" ]; then cp "$input" "$output"; else cat "$input"; fi
else
  cp "$input" "$output"
fi
`);
  writeExecutable(join(directory, 'rclone'), `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_RCLONE_LOG"
command=$1
shift
case "$command" in
  size) printf '{"count":0,"bytes":%s}\\n' "\${MOCK_RCLONE_BYTES:-0}" ;;
  lsf)
    case "$*" in
      *'/daily') printf '%s\\n' "\${MOCK_DAILY_LIST:-}" ;;
      *'/monthly') printf '%s\\n' "\${MOCK_MONTHLY_LIST:-}" ;;
    esac
    ;;
  copyto|deletefile) : ;;
  *) exit 64 ;;
esac
`);
  writeExecutable(join(directory, 'pg_restore'), `#!/bin/sh
printf 'pg_restore %s\\n' "$*" >> "$MOCK_RESTORE_LOG"
`);
  writeExecutable(join(directory, 'psql'), `#!/bin/sh
printf 'psql %s\\n' "$*" >> "$MOCK_RESTORE_LOG"
case " $* " in
  *current_database*) printf '%s\\n' "\${MOCK_CONNECTED_DATABASE:-quoteplate_restore_monthly}" ;;
  *row_security_active*) printf '1\\n' ;;
  *to_regclass*) printf '1\\n' ;;
esac
`);

  return { directory, rcloneLog, restoreLog, dumpLog };
}

describe('free-first operations policy', () => {
  it('keeps CI bounded and does not schedule duplicate test work', () => {
    const workflow = read('.github/workflows/ci.yml');

    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('timeout-minutes:');
    expect(workflow).toContain('npm run test:integration');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('npm run test:e2e');
    expect(workflow).toContain('npx playwright install --with-deps chromium');
    expect(workflow).toContain('postgresql');
    expect(workflow).toContain('npm ci --omit=peer');
    expect(workflow).toContain('npm audit --omit=dev --omit=peer --audit-level=high');
    expect(workflow).not.toMatch(/\bschedule\s*:/);
    expect(workflow.match(/npm run test:integration/g)).toHaveLength(1);
    expect(workflow.match(/npm run build/g)).toHaveLength(1);
  });

  it('keeps one cardless Vercel hosting path and removes obsolete Netlify tooling', () => {
    const runbook = read('docs/runbooks/deployment.md');
    const readme = read('README.md');
    const packageManifest = JSON.parse(read('package.json')) as {
      name: string;
      devDependencies: Record<string, string>;
    };

    expect(packageManifest.name).toBe('quoteplate');
    expect(packageManifest.devDependencies).not.toHaveProperty('@netlify/plugin-nextjs');
    expect(packageManifest.devDependencies).not.toHaveProperty('netlify-cli');
    expect(existsSync(join(root, 'netlify.toml'))).toBe(false);
    expect(existsSync(join(root, '.github/workflows/deploy-netlify.yml'))).toBe(false);
    expect(readme).toContain('Vercel Hobby (cardless)');
    expect(runbook).toContain('Vercel Hobby');
    expect(runbook).toContain('Deployment protection stays enabled');
    expect(runbook).toContain('Do not accept an upgrade, add a card');
    expect(runbook).toContain('exact verified commit');
  });

  it('bootstraps the production database separately without publishing a site', () => {
    const workflow = read('.github/workflows/bootstrap-production-database.yml');
    const runbook = read('docs/runbooks/deployment.md');

    expect(workflow).toMatch(/workflow_dispatch\s*:/);
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule)\s*:/);
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('BOOTSTRAP_QUOTEPLATE_DATABASE_ONLY');
    expect(workflow).toContain('${{ secrets.NEON_DIRECT_DATABASE_URL }}');
    expect(workflow).toContain('npx prisma migrate deploy');
    expect(workflow).not.toContain('NETLIFY_AUTH_TOKEN');
    expect(workflow).not.toContain('netlify deploy');
    expect(workflow).not.toContain('--prod');
    expect(runbook).toContain('Bootstrap QuotePlate production database');
    expect(runbook).toContain('QUOTEPLATE_PILOT_EMAILS');
    expect(runbook).toContain('GOOGLE_CLIENT_ID');
    expect(runbook).toContain('GOOGLE_CLIENT_SECRET');
  });

  it('keeps workflow credentials in protected GitHub environments', () => {
    for (const relativePath of [
      '.github/workflows/bootstrap-production-database.yml',
      '.github/workflows/backup-postgres.yml',
    ]) {
      const workflow = read(relativePath);
      expect(workflow).toMatch(/environment:\s*[a-z0-9-]+/);
      expect(workflow).not.toMatch(/postgres(?:ql)?:\/\/[^$\s]+/i);
      expect(workflow).not.toMatch(/(?:password|secret|token|key):\s*["']?(?!\$\{\{)[A-Za-z0-9+/=_-]{16,}/i);
    }
  });

  it('encrypts every database backup and stops before 8 GiB', () => {
    const script = read('scripts/backup-postgres.sh');

    expect(script).toContain('set -eu');
    expect(script).toContain('pg_dump');
    expect(script).toContain('gzip');
    expect(script).toContain('age --encrypt');
    expect(script).toContain('rclone copyto "$encrypted_file"');
    expect(script).toContain('8589934592');
    expect(script).toContain('DAILY_RETENTION=7');
    expect(script).toContain('MONTHLY_RETENTION=4');
    expect(script).toContain('rclone deletefile');
    expect(script).not.toMatch(/rclone copyto "\$compressed_file"/);
    expect(script).not.toContain('--no-acl');
    expect(read('scripts/restore-verify.sh')).not.toContain('--no-acl');
  });

  it('runs a single daily backup schedule and verifies a disposable restore monthly', () => {
    const workflow = read('.github/workflows/backup-postgres.yml');

    expect(workflow.match(/cron:/g)).toHaveLength(1);
    expect(workflow).toContain('runs-on: ubuntu-24.04');
    expect(workflow).toContain('postgresql-client-17');
    expect(workflow).toContain('https://apt.postgresql.org/pub/repos/apt');
    expect(workflow).toContain('pg_dump --version');
    expect(workflow).toContain('scripts/backup-postgres.sh');
    expect(workflow).toContain('scripts/restore-verify.sh');
    expect(workflow).toMatch(/date -u \+%d/);
    expect(workflow).toContain('= "01"');
    expect(workflow).toContain('environment: production-backup');
    expect(workflow).toContain('${{ secrets.NEON_BACKUP_DATABASE_URL }}');
    expect(workflow).not.toContain('${{ secrets.NEON_DIRECT_DATABASE_URL }}');
    expect(workflow).not.toMatch(/^\s{4}env:\s*$/m);
    expect(workflow.indexOf('${{ secrets.')).toBeGreaterThan(
      workflow.indexOf('Install open-source recovery tools'),
    );
    expect(workflow.match(/secrets\.AGE_BACKUP_IDENTITY/g)).toHaveLength(1);
    expect(workflow.match(/NEON_RESTORE_DATABASE_URL/g)).toHaveLength(1);
  });

  it('provisions a dedicated read-only forced-RLS backup role', () => {
    const migration = read(
      'prisma/migrations/20260827001000_backup_role/migration.sql',
    );
    const runbook = read('docs/runbooks/backup-restore.md');

    expect(migration).toContain('CREATE ROLE autorfp_backup');
    expect(migration).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE');
    expect(migration).toContain('NOINHERIT NOREPLICATION BYPASSRLS');
    expect(migration).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA public');
    expect(migration).toContain('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public');
    expect(migration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE)/i);
    expect(runbook).toContain('NEON_BACKUP_DATABASE_URL');
    expect(runbook).toContain('\\password autorfp_backup');
    expect(runbook).toContain('read-only');
    expect(runbook).toContain('PostgreSQL 17');
  });

  it('documents a hard no-billing boundary and fail-closed operator actions', () => {
    const boundaries = read('docs/runbooks/cost-boundaries.md');
    const deployment = read('docs/runbooks/deployment.md');
    const backup = read('docs/runbooks/backup-restore.md');

    for (const phrase of [
      'No payment method',
      'No paid overage',
      'No auto-recharge',
      'No automatic upgrade',
      'fresh explicit approval',
    ]) {
      expect(boundaries).toContain(phrase);
    }
    expect(boundaries).toContain('8 GiB');
    expect(deployment).toContain('GitHub production environment');
    expect(deployment).toContain('migration-only owner secret');
    expect(deployment).not.toContain('runtime secrets (`DATABASE_URL`, `DIRECT_URL`');
    expect(deployment).toContain('\\password autorfp_app');
    expect(deployment).toContain('never appears in shell history');
    expect(deployment).toContain('pooled `DATABASE_URL`');
    expect(backup).toContain('seven daily');
    expect(backup).toContain('four monthly');
    expect(backup).toContain('preserves PostgreSQL ACLs');
    expect(backup).toContain('SET LOCAL ROLE autorfp_app');
  });
});

describe('operations shell scripts', () => {
  it.each([
    'scripts/backup-postgres.sh',
    'scripts/restore-verify.sh',
    'scripts/canary.sh',
  ])('%s has valid POSIX shell syntax', (relativePath) => {
    const result = spawnSync('sh', ['-n', join(root, relativePath)], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('uploads only an encrypted backup and never prints the database credential', () => {
    const tools = mockToolDirectory();
    const outputFile = join(tools.directory, 'latest.dump.gz.age');
    const databaseSecret = 'postgresql://operator:never-print-me@db.example/quoteplate';
    const result = spawnSync('sh', [join(root, 'scripts/backup-postgres.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tools.directory}:${process.env.PATH}`,
        BACKUP_DATABASE_URL: databaseSecret,
        AGE_RECIPIENT: 'age1testrecipient',
        RCLONE_REMOTE: 'b2',
        RCLONE_BUCKET: 'quoteplate-cardless-backups',
        BACKUP_NOW_UTC: '2026-08-28T02:17:00Z',
        BACKUP_OUTPUT_FILE: outputFile,
        MOCK_RCLONE_LOG: tools.rcloneLog,
        MOCK_DUMP_LOG: tools.dumpLog,
        MOCK_RCLONE_BYTES: '0',
      },
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(databaseSecret);
    expect(readFileSync(tools.rcloneLog, 'utf8')).toMatch(/copyto .*\.dump\.gz\.age b2:quoteplate-cardless-backups\/quoteplate-postgres\/daily\//);
    expect(readFileSync(tools.rcloneLog, 'utf8')).not.toMatch(/copyto .*\.dump\.gz\s/);
    expect(readFileSync(tools.dumpLog, 'utf8')).not.toContain('--no-acl');
    expect(readFileSync(outputFile, 'utf8')).toBe('test-database-dump');
  });

  it('fails before upload when the encrypted backup would reach 8 GiB', () => {
    const tools = mockToolDirectory();
    const result = spawnSync('sh', [join(root, 'scripts/backup-postgres.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tools.directory}:${process.env.PATH}`,
        BACKUP_DATABASE_URL: 'postgresql://operator:secret@db.example/quoteplate',
        AGE_RECIPIENT: 'age1testrecipient',
        RCLONE_REMOTE: 'b2',
        RCLONE_BUCKET: 'quoteplate-cardless-backups',
        BACKUP_NOW_UTC: '2026-08-28T02:17:00Z',
        MOCK_RCLONE_LOG: tools.rcloneLog,
        MOCK_DUMP_LOG: tools.dumpLog,
        MOCK_RCLONE_BYTES: '8589934591',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('8 GiB safety ceiling');
    expect(readFileSync(tools.rcloneLog, 'utf8')).not.toContain('copyto');
  });

  it('restores only into a named disposable database and cleans it afterward', () => {
    const tools = mockToolDirectory();
    const backupFile = join(tools.directory, 'backup.dump.gz.age');
    const identityFile = join(tools.directory, 'age-identity.txt');
    writeFileSync(backupFile, 'encrypted-test-dump', 'utf8');
    writeFileSync(identityFile, 'test-age-identity', 'utf8');

    const result = spawnSync('sh', [join(root, 'scripts/restore-verify.sh'), backupFile], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tools.directory}:${process.env.PATH}`,
        RESTORE_DATABASE_URL: 'postgresql://operator:secret@db.example/quoteplate_restore_monthly',
        AGE_IDENTITY_FILE: identityFile,
        MOCK_RESTORE_LOG: tools.restoreLog,
      },
    });

    expect(result.status).toBe(0);
    const calls = readFileSync(tools.restoreLog, 'utf8');
    expect(calls).toContain('pg_restore');
    expect(calls).toContain('--dbname=');
    expect(calls).toContain('DROP SCHEMA IF EXISTS public CASCADE');
    expect(calls).toContain('DROP SCHEMA IF EXISTS autorfp_private CASCADE');
    expect(calls).toContain('CREATE ROLE autorfp_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS');
    expect(calls).toContain('CREATE ROLE autorfp_backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS');
    expect(calls).toContain('SET LOCAL ROLE autorfp_app');
    expect(calls).toContain('row_security_active');
    expect(calls).toContain('has_schema_privilege');
    expect(calls).toContain('has_table_privilege');
    expect(calls).toContain('has_function_privilege');
    expect(calls).toContain('autorfp_private.autorfp_auth_credentials_by_email');
    expect(calls).toContain('20260827001000_backup_role');
    expect(calls).toContain('COUNT(*) = 17');
    expect(calls).not.toMatch(/PASSWORD\s+['"]/i);
    expect(calls).not.toContain('--no-acl');
    expect(calls.match(/psql /g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('supports two consecutive restore verifications after cleaning both schemas', () => {
    const tools = mockToolDirectory();
    const backupFile = join(tools.directory, 'backup.dump.gz.age');
    const identityFile = join(tools.directory, 'age-identity.txt');
    writeFileSync(backupFile, 'encrypted-test-dump', 'utf8');
    writeFileSync(identityFile, 'test-age-identity', 'utf8');
    const environment = {
      ...process.env,
      PATH: `${tools.directory}:${process.env.PATH}`,
      RESTORE_DATABASE_URL: 'postgresql://operator:secret@db.example/quoteplate_restore_monthly',
      AGE_IDENTITY_FILE: identityFile,
      MOCK_RESTORE_LOG: tools.restoreLog,
    };

    const first = spawnSync('sh', [join(root, 'scripts/restore-verify.sh'), backupFile], {
      encoding: 'utf8',
      env: environment,
    });
    const second = spawnSync('sh', [join(root, 'scripts/restore-verify.sh'), backupFile], {
      encoding: 'utf8',
      env: environment,
    });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const calls = readFileSync(tools.restoreLog, 'utf8');
    expect(calls.match(/pg_restore/g)).toHaveLength(2);
    expect(calls.match(/DROP SCHEMA IF EXISTS autorfp_private CASCADE/g)).toHaveLength(4);
  });

  it('refuses to restore into a production-shaped database name', () => {
    const tools = mockToolDirectory();
    const backupFile = join(tools.directory, 'backup.dump.gz.age');
    const identityFile = join(tools.directory, 'age-identity.txt');
    writeFileSync(backupFile, 'encrypted-test-dump', 'utf8');
    writeFileSync(identityFile, 'test-age-identity', 'utf8');

    const result = spawnSync('sh', [join(root, 'scripts/restore-verify.sh'), backupFile], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tools.directory}:${process.env.PATH}`,
        RESTORE_DATABASE_URL: 'postgresql://operator:secret@db.example/neondb',
        AGE_IDENTITY_FILE: identityFile,
        MOCK_RESTORE_LOG: tools.restoreLog,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('quoteplate_restore_');
  });

  it('refuses cleanup when the server reports a different connected database', () => {
    const tools = mockToolDirectory();
    const backupFile = join(tools.directory, 'backup.dump.gz.age');
    const identityFile = join(tools.directory, 'age-identity.txt');
    writeFileSync(backupFile, 'encrypted-test-dump', 'utf8');
    writeFileSync(identityFile, 'test-age-identity', 'utf8');

    const result = spawnSync('sh', [join(root, 'scripts/restore-verify.sh'), backupFile], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tools.directory}:${process.env.PATH}`,
        RESTORE_DATABASE_URL: 'postgresql://operator:secret@db.example/quoteplate_restore_monthly',
        AGE_IDENTITY_FILE: identityFile,
        MOCK_RESTORE_LOG: tools.restoreLog,
        MOCK_CONNECTED_DATABASE: 'quoteplate_production',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('connected database did not match');
    expect(readFileSync(tools.restoreLog, 'utf8')).not.toContain('pg_restore');
  });
});
