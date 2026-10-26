#!/usr/bin/env bash
# Upgrade a database that already has migrations 001–016. Never reset its volume.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/infra/compose/compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/upgrades}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
REHEARSAL_DB="wordbook_rehearsal_$$"
SQL_FILE="$(mktemp /tmp/kid-study-wordbook.XXXXXX)"
BACKUP_FILE="$BACKUP_DIR/before-wordbook-$STAMP.dump"
DB_USER="${DB_USER:-kid_study}"
DB_NAME="${DB_NAME:-kid_study}"
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
psql_db() { compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$1"; }
cleanup() {
  compose exec -T postgres dropdb -U "$DB_USER" --if-exists "$REHEARSAL_DB" >/dev/null 2>&1 || true
  rm -f "$SQL_FILE"
}
trap cleanup EXIT
umask 077
mkdir -p "$BACKUP_DIR"

# A version marker is written inside the migration's transaction.
CHECKSUM="$(shasum -a 256 "$ROOT_DIR/infra/migrations/017_wordbook.sql" | awk '{print $1}')"
python3 - "$ROOT_DIR/infra/migrations/017_wordbook.sql" "$CHECKSUM" > "$SQL_FILE" <<'PY'
import pathlib, sys
sql = pathlib.Path(sys.argv[1]).read_text()
assert sql.strip().lower().endswith("commit;")
marker = """
create table if not exists schema_migration (
  version text primary key, checksum text not null, applied_at timestamptz not null default now()
);
insert into schema_migration (version, checksum) values ('017', '%s');
commit;
""" % sys.argv[2]
print(sql[:sql.lower().rfind("commit;")] + marker)
PY

# Verify the known baseline before stopping writes or touching schema.
BASELINE="$(printf "%s\n" "select count(*) from information_schema.tables where table_schema='public' and table_name in ('family','app_user','learning_event','question','training_attempt','model_capability_config','learning_task','curriculum_progress','review_schedule');" | psql_db "$DB_NAME" | awk '/^[[:space:]]*[0-9]+[[:space:]]*$/ {print $1}')"
if [[ "$BASELINE" != "9" ]]; then
  echo "Expected migrations 001–016. Baseline tables: $BASELINE/9. Upgrade older databases first." >&2
  exit 1
fi
EXISTING="$(printf "%s\n" "select count(*) from information_schema.tables where table_schema='public' and table_name in ('wordbook','word_entry','word_quiz','word_quiz_question','word_quiz_answer','word_wrong_item');" | psql_db "$DB_NAME" | awk '/^[[:space:]]*[0-9]+[[:space:]]*$/ {print $1}')"
if [[ "$EXISTING" == "6" ]]; then
  echo "Migration 017 is already present; nothing to apply."
  exit 0
fi
if [[ "$EXISTING" != "0" ]]; then
  echo "Partial wordbook schema detected; refusing an unsafe automatic upgrade." >&2
  exit 1
fi

compose stop api
compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-privileges > "$BACKUP_FILE"
compose exec -T postgres pg_restore --list < "$BACKUP_FILE" >/dev/null
compose exec -T postgres createdb -U "$DB_USER" "$REHEARSAL_DB"
compose exec -T postgres pg_restore -U "$DB_USER" -d "$REHEARSAL_DB" --exit-on-error --no-owner --no-privileges < "$BACKUP_FILE"
psql_db "$REHEARSAL_DB" < "$SQL_FILE"
printf "%s\n" "select 1 / (case when (select count(*) from information_schema.tables where table_schema='public' and table_name in ('wordbook','word_entry','word_quiz','word_quiz_question','word_quiz_answer','word_wrong_item')) = 6 then 1 else 0 end);" | psql_db "$REHEARSAL_DB" >/dev/null
psql_db "$DB_NAME" < "$SQL_FILE"
compose start api
echo "Migration 017 applied after backup and restore rehearsal."
echo "Backup (mode 600): $BACKUP_FILE"
