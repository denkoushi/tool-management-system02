#!/bin/bash
# 工具管理システム - 自動起動設定スクリプト（systemd, UTF-8 ログ対応）
# 使い方: プロジェクト直下で sudo bash setup_auto_start.sh

set -euo pipefail

SERVICE_NAME="toolmgmt"
USER_NAME="${SUDO_USER:-$USER}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> user: $USER_NAME"
echo "==> project: $PROJECT_DIR"

# venv が無ければ作成
if [ ! -d "$PROJECT_DIR/venv" ]; then
  echo "==> create venv"
  python3 -m venv "$PROJECT_DIR/venv"
  "$PROJECT_DIR/venv/bin/pip" install --upgrade pip
  "$PROJECT_DIR/venv/bin/pip" install -r "$PROJECT_DIR/requirements.txt"
fi

# systemd ユニット作成（UTF-8 ログ/タイムゾーン/依存関係）
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
cat <<'EOF' | sudo tee "$UNIT_FILE" >/dev/null
[Unit]
Description=Tool Management System (Flask + SocketIO)
After=network-online.target pcscd.service docker.service
Wants=network-online.target pcscd.service docker.service

[Service]
Type=simple
# 実行ユーザー（必要に応じて変更）
User=__USER_NAME__
Group=__USER_NAME__
# 作業ディレクトリ
WorkingDirectory=__PROJECT_DIR__
# 環境（UTF-8 ログ/タイムゾーン）
Environment=PATH=__PROJECT_DIR__/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=LANG=ja_JP.UTF-8
Environment=LC_ALL=ja_JP.UTF-8
Environment=PYTHONIOENCODING=utf-8
Environment=PYTHONUNBUFFERED=1
Environment=TZ=Asia/Tokyo
# アプリ起動
ExecStart=__PROJECT_DIR__/venv/bin/python __PROJECT_DIR__/app_flask.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 置換：テンプレート中の __USER_NAME__ / __PROJECT_DIR__ を実値に
sudo sed -i "s|__USER_NAME__|${USER_NAME}|g" "$UNIT_FILE"
sudo sed -i "s|__PROJECT_DIR__|${PROJECT_DIR}|g" "$UNIT_FILE"

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"

echo "==> done. status:"
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
