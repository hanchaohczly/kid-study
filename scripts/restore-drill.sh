#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/infra/compose/compose.yml}"
RESTORE_DATABASE="kid_study_restore_drill"

cleanup() {
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    dropdb --username kid_study --if-exists "$RESTORE_DATABASE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

BACKUP_FILE="$(
  COMPOSE_FILE="$COMPOSE_FILE" bash "$ROOT_DIR/scripts/backup-postgres.sh"
)"

COMPOSE_FILE="$COMPOSE_FILE" \
BACKUP_FILE="$BACKUP_FILE" \
RESTORE_DATABASE="$RESTORE_DATABASE" \
ALLOW_RESTORE=1 \
  bash "$ROOT_DIR/scripts/restore-postgres.sh"

echo "Backup and isolated restore drill passed."
