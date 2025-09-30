#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
THRESHOLD_HOURS="${1:-24}"

if ! [[ "$THRESHOLD_HOURS" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 [threshold_hours]" >&2
  echo "threshold_hours must be an integer number of hours (default 24)." >&2
  exit 2
fi

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: backup directory not found: $BACKUP_DIR" >&2
  exit 3
fi

latest_backup="$(ls -1t "$BACKUP_DIR"/sensordb-*.sql.gz 2>/dev/null | head -n 1 || true)"
if [ -z "$latest_backup" ]; then
  echo "ERROR: no backup file found in $BACKUP_DIR" >&2
  exit 4
fi

backup_epoch="$(stat -c %Y "$latest_backup")"
now_epoch="$(date +%s)"
age_seconds=$(( now_epoch - backup_epoch ))
age_hours=$(( age_seconds / 3600 ))

backup_size="$(du -h "$latest_backup" | awk '{print $1}')"
backup_time="$(date -d "@$backup_epoch" '+%Y-%m-%d %H:%M:%S %Z')"

printf 'Latest backup : %s\n' "$latest_backup"
printf 'Backup time    : %s\n' "$backup_time"
printf 'Backup size    : %s\n' "$backup_size"
printf 'Age            : %s hours\n' "$age_hours"

if [ "$age_seconds" -gt $(( THRESHOLD_HOURS * 3600 )) ]; then
  echo "WARNING: latest backup is older than ${THRESHOLD_HOURS} hours." >&2
  exit 5
fi

if ! gunzip -t "$latest_backup" 2>/dev/null; then
  echo "ERROR: gzip integrity check failed for $latest_backup" >&2
  exit 6
fi

# Show last run status from systemd if available
if command -v systemctl >/dev/null 2>&1; then
  echo
  echo "Recent backup_db.service runs:"
  systemctl status backup_db.service --no-pager | sed -n '1,10p'
fi

exit 0
