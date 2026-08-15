#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="data/backups"
MAX_BACKUPS=20

backup_database() {
  local tracker_file="$1"
  local attachments_dir="$2"
  local destination="$3"

  if [[ ! -f "$tracker_file" ]]; then
    return 0
  fi

  mkdir -p "$destination"
  cp "$tracker_file" "$destination/tracker.json"
  if [[ -d "$attachments_dir" ]]; then
    cp -R "$attachments_dir" "$destination/attachments"
  fi
}

if [[ ! -f "data/tracker.json" && ! -f "data/demo/tracker.json" ]]; then
  echo '{}'
  exit 0
fi

timestamp="$(date +%Y%m%dT%H%M%S)"
backup_path="$BACKUP_DIR/$timestamp"

backup_database "data/tracker.json" "data/attachments" "$backup_path"
backup_database "data/demo/tracker.json" "data/demo/attachments" "$backup_path/demo"

ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | while IFS= read -r old_backup; do
  rm -rf "$old_backup"
done

echo '{}'
