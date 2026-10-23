#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/infra/compose/compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-$ROOT_DIR/infra/compose/secrets/backup_passphrase}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DAILY_DIR="$BACKUP_DIR/daily"
WEEKLY_DIR="$BACKUP_DIR/weekly"
PLAIN_FILE="$DAILY_DIR/kid-study-$STAMP.dump"
ENCRYPTED_FILE="$PLAIN_FILE.enc"

if [[ ! -s "$PASSPHRASE_FILE" ]]; then
  echo "Backup passphrase file is missing or empty: $PASSPHRASE_FILE" >&2
  exit 1
fi

umask 077
mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"
trap 'rm -f "$PLAIN_FILE"' EXIT

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --username kid_study --dbname kid_study --format custom \
  --no-owner --no-privileges > "$PLAIN_FILE"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore --list < "$PLAIN_FILE" >/dev/null
openssl enc -aes-256-cbc -salt -pbkdf2 \
  -pass "file:$PASSPHRASE_FILE" \
  -in "$PLAIN_FILE" -out "$ENCRYPTED_FILE"
shasum -a 256 "$ENCRYPTED_FILE" > "$ENCRYPTED_FILE.sha256"

if [[ "$(date -u +%u)" == "7" ]]; then
  cp -p "$ENCRYPTED_FILE" "$WEEKLY_DIR/"
  (
    cd "$WEEKLY_DIR"
    shasum -a 256 "$(basename "$ENCRYPTED_FILE")" \
      > "$(basename "$ENCRYPTED_FILE").sha256"
  )
fi

find "$DAILY_DIR" -type f -name '*.dump.enc' -mtime +13 -delete
find "$DAILY_DIR" -type f -name '*.dump.enc.sha256' -mtime +13 -delete
find "$WEEKLY_DIR" -type f -name '*.dump.enc' -mtime +55 -delete
find "$WEEKLY_DIR" -type f -name '*.dump.enc.sha256' -mtime +55 -delete

printf '%s\n' "$ENCRYPTED_FILE"
