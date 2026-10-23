#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="kid-study-migrations-$RANDOM-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$CONTAINER" \
  --env POSTGRES_DB=kid_study \
  --env POSTGRES_USER=kid_study \
  --env POSTGRES_PASSWORD=migration-test-only \
  --mount "type=bind,src=$ROOT_DIR/infra/migrations,dst=/docker-entrypoint-initdb.d,readonly" \
  postgres:17-alpine >/dev/null

REQUIRED_COUNT=0
for _ in $(seq 1 90); do
  REQUIRED_COUNT="$(
    docker exec "$CONTAINER" psql -U kid_study -d kid_study \
      --tuples-only --no-align --command \
      "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('learning_event','question','training_attempt','wrong_item','learning_task','curriculum_progress','review_schedule');" \
      2>/dev/null || true
  )"
  [[ "$REQUIRED_COUNT" == "7" ]] && break
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] || break
  sleep 1
done

if [[ "$REQUIRED_COUNT" != "7" ]]; then
  docker logs "$CONTAINER" >&2
  echo "Migration validation failed: required tables=$REQUIRED_COUNT/7" >&2
  exit 1
fi

echo "All migrations applied from an empty PostgreSQL 17 database."
