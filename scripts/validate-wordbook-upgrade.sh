#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$(mktemp -d "$ROOT_DIR/backups-wordbook-test.XXXXXX")"
PROJECT="wordbook-upgrade-test-$$"
COMPOSE_FILE="$TEST_DIR/compose.yml"
cleanup() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT
cat > "$COMPOSE_FILE" <<'YAML'
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: kid_study
      POSTGRES_DB: kid_study
      POSTGRES_PASSWORD: upgrade-test-only
  api:
    image: postgres:17-alpine
    entrypoint: ["tail", "-f", "/dev/null"]
YAML
export COMPOSE_PROJECT_NAME="$PROJECT"
export COMPOSE_FILE BACKUP_DIR="$TEST_DIR/backups"
docker compose -f "$COMPOSE_FILE" up -d
for _ in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -h 127.0.0.1 -U kid_study -d kid_study >/dev/null 2>&1; then break; fi
  sleep 1
done
for sql in "$ROOT_DIR"/infra/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16}_*.sql; do
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -X -v ON_ERROR_STOP=1 -U kid_study -d kid_study < "$sql" >/dev/null
done
printf "%s\n" "insert into family(id,name) values ('00000000-0000-4000-8000-000000000001','preserve-upgrade-record');" |
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U kid_study -d kid_study >/dev/null
bash "$ROOT_DIR/scripts/upgrade-wordbook.sh"
bash "$ROOT_DIR/scripts/upgrade-wordbook.sh"
printf "%s\n" "select 1 / (case when exists(select 1 from family where name='preserve-upgrade-record') and exists(select 1 from schema_migration where version='017') then 1 else 0 end);" |
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U kid_study -d kid_study >/dev/null
echo "Existing database upgrade, backup/restore rehearsal, data preservation and repeat run: PASS"
