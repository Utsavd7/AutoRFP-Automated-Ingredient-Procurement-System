#!/bin/sh
set -eu

umask 077

MAX_BACKUP_BYTES=8589934592
DAILY_RETENTION=7
MONTHLY_RETENTION=4
REMOTE_PREFIX=quoteplate-postgres

fail() {
  printf 'Backup refused: %s\n' "$1" >&2
  exit 1
}

require_variable() {
  variable_name=$1
  eval "variable_value=\${$variable_name:-}"
  [ -n "$variable_value" ] || fail "$variable_name is required"
}

for variable_name in BACKUP_DATABASE_URL AGE_RECIPIENT RCLONE_REMOTE RCLONE_BUCKET; do
  require_variable "$variable_name"
done

for command_name in pg_dump gzip age rclone mktemp sed wc sort awk grep cp date; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

case "$RCLONE_REMOTE" in
  *[!A-Za-z0-9_-]*|'') fail 'RCLONE_REMOTE contains unsafe characters' ;;
esac
case "$RCLONE_BUCKET" in
  *[!A-Za-z0-9._-]*|'') fail 'RCLONE_BUCKET contains unsafe characters' ;;
esac

backup_now=${BACKUP_NOW_UTC:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}
printf '%s\n' "$backup_now" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' \
  || fail 'BACKUP_NOW_UTC must be an ISO-8601 UTC timestamp'

calendar_day=$(printf '%s' "$backup_now" | cut -c9-10)
compact_stamp=$(printf '%s' "$backup_now" | sed 's/[-:]//g')
backup_name="quoteplate-$compact_stamp.dump.gz.age"
remote_root="$RCLONE_REMOTE:$RCLONE_BUCKET/$REMOTE_PREFIX"

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/quoteplate-backup.XXXXXX")
dump_file="$temporary_directory/quoteplate.dump"
compressed_file="$temporary_directory/quoteplate.dump.gz"
encrypted_file="$temporary_directory/$backup_name"
listing_file="$temporary_directory/listing"
prune_file="$temporary_directory/prune"

cleanup() {
  rm -f "$dump_file" "$compressed_file" "$encrypted_file" "$listing_file" "$prune_file"
  rmdir "$temporary_directory" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

PGDATABASE="$BACKUP_DATABASE_URL" pg_dump \
  --format=custom \
  --compress=0 \
  --no-owner \
  --file="$dump_file"
gzip -c < "$dump_file" > "$compressed_file"
age --encrypt --recipient "$AGE_RECIPIENT" --output "$encrypted_file" "$compressed_file"

encrypted_bytes=$(wc -c < "$encrypted_file" | awk '{print $1}')
case "$encrypted_bytes" in
  ''|*[!0-9]*) fail 'could not measure the encrypted backup' ;;
esac
[ "$encrypted_bytes" -gt 0 ] || fail 'encrypted backup is empty'

remote_bytes() {
  size_json=$(rclone size --json "$remote_root") || fail 'could not read current backup storage'
  size_bytes=$(printf '%s\n' "$size_json" | sed -n 's/.*"bytes"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
  case "$size_bytes" in
    ''|*[!0-9]*) fail 'could not parse current backup storage' ;;
  esac
  printf '%s\n' "$size_bytes"
}

assert_capacity_for() {
  additional_bytes=$1
  current_bytes=$(remote_bytes)
  projected_bytes=$((current_bytes + additional_bytes))
  if [ "$projected_bytes" -ge "$MAX_BACKUP_BYTES" ]; then
    fail 'upload would reach the 8 GiB safety ceiling; no remote write was made'
  fi
}

assert_capacity_for "$encrypted_bytes"
daily_object="$remote_root/daily/$backup_name"
rclone copyto "$encrypted_file" "$daily_object" --immutable

if [ -n "${BACKUP_OUTPUT_FILE:-}" ]; then
  case "$BACKUP_OUTPUT_FILE" in
    /*.dump.gz.age) : ;;
    *) fail 'BACKUP_OUTPUT_FILE must be an absolute .dump.gz.age path' ;;
  esac
  [ ! -e "$BACKUP_OUTPUT_FILE" ] || fail 'BACKUP_OUTPUT_FILE already exists'
  cp "$encrypted_file" "$BACKUP_OUTPUT_FILE"
fi

if [ "$calendar_day" = '01' ]; then
  assert_capacity_for "$encrypted_bytes"
  monthly_object="$remote_root/monthly/$backup_name"
  rclone copyto "$encrypted_file" "$monthly_object" --immutable
fi

prune_directory() {
  retention_directory=$1
  retention_count=$2
  rclone lsf --files-only "$remote_root/$retention_directory" > "$listing_file"
  sort -r "$listing_file" | awk -v keep="$retention_count" 'NF && NR > keep { print }' > "$prune_file"
  while IFS= read -r obsolete_name; do
    [ -n "$obsolete_name" ] || continue
    case "$obsolete_name" in
      quoteplate-[0-9]*T[0-9]*Z.dump.gz.age) : ;;
      *) fail 'retention listing contained an unsafe object name' ;;
    esac
    case "$obsolete_name" in
      */*) fail 'retention will not delete nested or broad targets' ;;
    esac
    obsolete_object="$remote_root/$retention_directory/$obsolete_name"
    rclone deletefile "$obsolete_object"
  done < "$prune_file"
}

prune_directory daily "$DAILY_RETENTION"
prune_directory monthly "$MONTHLY_RETENTION"

printf 'Encrypted PostgreSQL backup stored successfully (%s bytes).\n' "$encrypted_bytes"
