#!/usr/bin/env bash
set -euo pipefail

TRACKER_FILE="data/tracker.json"
BACKUP_DIR="data/backups"
ATTACHMENTS_DIR="data/attachments"
MAX_BACKUPS=20

if [[ ! -f "$TRACKER_FILE" ]]; then
  echo '{}'
  exit 0
fi

timestamp="$(date +%Y%m%dT%H%M%S)"
backup_path="$BACKUP_DIR/$timestamp"
mkdir -p "$backup_path"

cp "$TRACKER_FILE" "$backup_path/tracker.json"
if [[ -d "$ATTACHMENTS_DIR" ]]; then
  cp -R "$ATTACHMENTS_DIR" "$backup_path/attachments"
fi

ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | while IFS= read -r old_backup; do
  rm -rf "$old_backup"
done

echo '{}'
