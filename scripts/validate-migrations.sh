#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="kid-study-migrations-$RANDOM-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

PORT_ARGS=()
if [[ -n "${WORDBOOK_TEST_PORT:-}" ]]; then
  PORT_ARGS=(--publish "127.0.0.1:$WORDBOOK_TEST_PORT:5432")
fi
docker run --detach --name "$CONTAINER" "${PORT_ARGS[@]}" \
  --env POSTGRES_DB=kid_study \
  --env POSTGRES_USER=kid_study \
  --env POSTGRES_PASSWORD=migration-test-only \
  --mount "type=bind,src=$ROOT_DIR/infra/migrations,dst=/docker-entrypoint-initdb.d,readonly" \
  postgres:17-alpine >/dev/null

REQUIRED_COUNT=0
for _ in $(seq 1 90); do
  REQUIRED_COUNT="$(
    docker exec -e PGPASSWORD=migration-test-only "$CONTAINER" psql -h 127.0.0.1 -U kid_study -d kid_study \
      --tuples-only --no-align --command \
      "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('learning_event','question','training_attempt','wrong_item','learning_task','curriculum_progress','review_schedule','wordbook','word_entry','word_quiz','word_quiz_question','word_quiz_answer','word_wrong_item');" \
      2>/dev/null || true
  )"
  [[ "$REQUIRED_COUNT" == "13" ]] && break
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] || break
  sleep 1
done

if [[ "$REQUIRED_COUNT" != "13" ]]; then
  docker logs "$CONTAINER" >&2
  echo "Migration validation failed: required tables=$REQUIRED_COUNT/13" >&2
  exit 1
fi

echo "All migrations applied from an empty PostgreSQL 17 database."
if [[ -n "${WORDBOOK_TEST_PORT:-}" ]]; then
  (
    cd "$ROOT_DIR"
    WORDBOOK_TEST_DATABASE_URL="postgres://kid_study:migration-test-only@127.0.0.1:$WORDBOOK_TEST_PORT/kid_study" \
      npm run test --workspace @kid-study/api -- postgres-wordbook-repository.test.ts
  )
fi
