#!/bin/sh
set -eu

umask 077

fail() {
  printf 'Backup refused: %s\n' "$1" >&2
  exit 1
}

[ -n "${BACKUP_DATABASE_URL:-}" ] || fail 'BACKUP_DATABASE_URL is required'
[ -n "${AGE_RECIPIENT:-}" ] || fail 'AGE_RECIPIENT is required'
[ -n "${BACKUP_OUTPUT_FILE:-}" ] || fail 'BACKUP_OUTPUT_FILE is required'

case "$BACKUP_OUTPUT_FILE" in
  /*.dump.gz.age) : ;;
  *) fail 'BACKUP_OUTPUT_FILE must be an absolute .dump.gz.age path' ;;
esac
[ ! -e "$BACKUP_OUTPUT_FILE" ] || fail 'BACKUP_OUTPUT_FILE already exists'

for command_name in age gzip mktemp mv pg_dump psql wc; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "$command_name is required"
done

backup_user=$(PGDATABASE="$BACKUP_DATABASE_URL" psql -Atqc 'SELECT current_user')
[ "$backup_user" = 'autorfp_backup' ] \
  || fail 'BACKUP_DATABASE_URL must use the read only backup role'

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/quoteplate-backup.XXXXXX")
dump_file="$temporary_directory/quoteplate.dump"
compressed_file="$temporary_directory/quoteplate.dump.gz"
encrypted_file="$temporary_directory/quoteplate.dump.gz.age"

cleanup() {
  rm -f "$dump_file" "$compressed_file" "$encrypted_file"
  rmdir "$temporary_directory" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

PGDATABASE="$BACKUP_DATABASE_URL" pg_dump \
  --format=custom \
  --compress=0 \
  --no-owner \
  --file="$dump_file"
gzip -c < "$dump_file" > "$compressed_file"
age --encrypt \
  --recipient "$AGE_RECIPIENT" \
  --output "$encrypted_file" \
  "$compressed_file"

encrypted_bytes=$(wc -c < "$encrypted_file")
[ "$encrypted_bytes" -gt 0 ] || fail 'encrypted backup is empty'
mv "$encrypted_file" "$BACKUP_OUTPUT_FILE"

printf 'Encrypted PostgreSQL backup written locally (%s bytes).\n' \
  "$encrypted_bytes"
