#!/bin/sh
set -eu

fail() {
  printf 'Canary failed: %s\n' "$1" >&2
  exit 1
}

[ -n "${CANARY_BASE_URL:-}" ] || fail 'CANARY_BASE_URL is required'
base_url=${CANARY_BASE_URL%/}
case "$base_url" in
  https://*) : ;;
  http://127.0.0.1:*|http://localhost:*) : ;;
  *) fail 'use HTTPS, except for an explicit local loopback check' ;;
esac

command -v curl >/dev/null 2>&1 || fail 'curl is required'
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/quoteplate-canary.XXXXXX")
response_file="$temporary_directory/response"
cleanup() {
  rm -f "$response_file"
  rmdir "$temporary_directory" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

request_status() {
  request_path=$1
  curl \
    --silent \
    --show-error \
    --max-time 10 \
    --output "$response_file" \
    --write-out '%{http_code}' \
    "$base_url$request_path"
}

for public_path in / /signin /api/health/live /api/health/ready; do
  status=$(request_status "$public_path") || fail "$public_path was unreachable"
  [ "$status" = '200' ] || fail "$public_path returned HTTP $status"
  if [ "$public_path" = '/api/health/live' ]; then
    grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$response_file" \
      || fail 'liveness response was invalid'
  fi
  if [ "$public_path" = '/api/health/ready' ]; then
    grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' "$response_file" \
      || fail 'readiness response was invalid'
  fi
done

protected_status=$(request_status '/api/settings') || fail 'protected-route check was unreachable'
case "$protected_status" in
  401|403) : ;;
  *) fail "protected API returned HTTP $protected_status without a session" ;;
esac

printf 'QuotePlate canary passed.\n'
