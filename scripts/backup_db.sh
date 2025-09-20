#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
mkdir -p "$BACKUP_DIR"

ts="$(date +%Y%m%d-%H%M%S)"
# コンテナ内の pg_dump を実行（パスワードは env で渡す）
docker exec -e PGPASSWORD=app -i pg pg_dump -U app -h 127.0.0.1 -p 5432 -d sensordb | gzip > "${BACKUP_DIR}/sensordb-${ts}.sql.gz"

# 14日より古いバックアップは削除
find "$BACKUP_DIR" -type f -name 'sensordb-*.sql.gz' -mtime +14 -delete

echo "backup ok: ${BACKUP_DIR}/sensordb-${ts}.sql.gz"
