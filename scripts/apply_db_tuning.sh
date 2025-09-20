#!/bin/bash
# Postgres コンテナ(pg)へ DBチューニング SQL を適用
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! docker compose ps >/dev/null 2>&1; then
  echo "docker が動いていません。'docker compose up -d' 実行後に再試行してください。"
  exit 1
fi

if ! docker inspect pg >/dev/null 2>&1; then
  echo "コンテナ名 'pg' が見つかりません。docker-compose.yml の 'container_name' を確認してください。"
  exit 1
fi

echo "==> apply SQL to 'pg' (sensordb)"
docker exec -i pg psql -U app -d sensordb < "${PROJECT_DIR}/scripts/apply_db_tuning.sql" || {
  echo "SQL 適用に失敗しました"; exit 1;
}

echo "==> done."
