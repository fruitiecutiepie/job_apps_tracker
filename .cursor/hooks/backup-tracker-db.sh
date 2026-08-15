#!/usr/bin/env bash
set -euo pipefail

TRACKER_FILE="data/tracker.json"
BACKUP_DIR="data/backups"
MAX_BACKUPS=20

if [[ ! -f "$TRACKER_FILE" ]]; then
  echo '{}'
  exit 0
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date +%Y%m%dT%H%M%S)"
cp "$TRACKER_FILE" "$BACKUP_DIR/tracker.${timestamp}.json"

ls -1t "$BACKUP_DIR"/tracker.*.json 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | while IFS= read -r old_backup; do
  rm -f "$old_backup"
done

echo '{}'
