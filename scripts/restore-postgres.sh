#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/infra/compose/compose.yml}"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-$ROOT_DIR/infra/compose/secrets/backup_passphrase}"
BACKUP_FILE="${BACKUP_FILE:-}"
RESTORE_DATABASE="${RESTORE_DATABASE:-kid_study_restore}"

if [[ "${ALLOW_RESTORE:-}" != "1" ]]; then
  echo "Set ALLOW_RESTORE=1 to confirm an isolated restore." >&2
  exit 1
fi
if [[ ! "$RESTORE_DATABASE" =~ ^[a-z][a-z0-9_]*$ ]]; then
  echo "RESTORE_DATABASE must be a lowercase PostgreSQL identifier." >&2
  exit 1
fi
case "$RESTORE_DATABASE" in
  kid_study|postgres|template0|template1)
    echo "Refusing to restore over a production or system database." >&2
    exit 1
    ;;
esac
if [[ ! -f "$BACKUP_FILE" || ! -f "$BACKUP_FILE.sha256" ]]; then
  echo "BACKUP_FILE and its .sha256 sidecar are required." >&2
  exit 1
fi
if [[ ! -s "$PASSPHRASE_FILE" ]]; then
  echo "Backup passphrase file is missing or empty: $PASSPHRASE_FILE" >&2
  exit 1
fi

(cd "$(dirname "$BACKUP_FILE")" && shasum -a 256 -c "$(basename "$BACKUP_FILE").sha256")

PLAIN_FILE="$(mktemp "${TMPDIR:-/tmp}/kid-study-restore.XXXXXX.dump")"
trap 'rm -f "$PLAIN_FILE"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass "file:$PASSPHRASE_FILE" \
  -in "$BACKUP_FILE" -out "$PLAIN_FILE"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  dropdb --username kid_study --if-exists "$RESTORE_DATABASE"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  createdb --username kid_study "$RESTORE_DATABASE"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore --username kid_study --dbname "$RESTORE_DATABASE" \
  --no-owner --no-privileges --exit-on-error < "$PLAIN_FILE"

TABLE_COUNT="$(
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql --username kid_study --dbname "$RESTORE_DATABASE" \
    --tuples-only --no-align --command \
    "select count(*) from information_schema.tables where table_schema = 'public';"
)"
REQUIRED_COUNT="$(
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql --username kid_study --dbname "$RESTORE_DATABASE" \
    --tuples-only --no-align --command \
    "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('learning_event','question','training_attempt','learning_task','review_schedule');"
)"

if (( TABLE_COUNT < 10 )) || [[ "$REQUIRED_COUNT" != "5" ]]; then
  echo "Restore validation failed: tables=$TABLE_COUNT required=$REQUIRED_COUNT/5" >&2
  exit 1
fi

echo "Restore validated in database $RESTORE_DATABASE ($TABLE_COUNT public tables)."
