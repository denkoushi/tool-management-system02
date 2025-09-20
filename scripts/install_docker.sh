#!/bin/bash
# Docker + Compose 導入（get.docker.com を利用）
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "==> install docker"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sudo sh /tmp/get-docker.sh
else
  echo "==> docker: 既に存在"
fi

echo "==> docker グループに現在のユーザーを追加"
sudo usermod -aG docker "$USER" || true

echo "==> docker compose plugin 確認/導入"
if ! docker compose version >/dev/null 2>&1; then
  sudo apt update
  sudo apt install -y docker-compose-plugin
fi

echo "==> バージョン表示"
docker --version || true
docker compose version || true

cat <<'NOTE'

[注意]
- このあと一度「ログアウト→再ログイン」すると、sudo なしで docker を使えるようになります。
- すぐ使いたい場合は現在のシェルで `newgrp docker` を実行してください。

NOTE
