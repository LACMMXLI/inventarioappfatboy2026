#!/bin/sh
set -eu
: "${AGE_RECIPIENT:?Configura la clave pública age}"
: "${BACKUP_REMOTE:?Configura un destino rclone externo}"
mkdir -p /status
while true; do
  task_dir=$(mktemp -d)
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  if pg_dump -Fc -f "$task_dir/database.dump" && tar -czf "$task_dir/uploads.tar.gz" -C /uploads . && tar -cf "$task_dir/bundle.tar" -C "$task_dir" database.dump uploads.tar.gz && age -r "$AGE_RECIPIENT" -o "$task_dir/fatboy-$stamp.tar.age" "$task_dir/bundle.tar" && rclone copyto "$task_dir/fatboy-$stamp.tar.age" "$BACKUP_REMOTE/fatboy-$stamp.tar.age"; then
    date +%s > /status/last-success
    rclone delete "$BACKUP_REMOTE" --min-age 30d --include 'fatboy-*.tar.age'
    echo "Backup completed: $stamp"
  else
    echo "Backup failed: $stamp" >&2
  fi
  rm -f "$task_dir/database.dump" "$task_dir/uploads.tar.gz" "$task_dir/bundle.tar" "$task_dir/fatboy-$stamp.tar.age"
  rmdir "$task_dir"
  sleep 86400
done
