#!/bin/bash
# 工具管理システム - 自動起動設定スクリプト（systemd）
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

# systemd ユニット作成
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
cat <<EOF | sudo tee "$UNIT_FILE" >/dev/null
[Unit]
Description=Tool Management System (Flask + SocketIO)
After=network-online.target pcscd.service
Wants=network-online.target pcscd.service

[Service]
Type=simple
User=${USER_NAME}
Group=${USER_NAME}
WorkingDirectory=${PROJECT_DIR}
Environment=PATH=${PROJECT_DIR}/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${PROJECT_DIR}/venv/bin/python ${PROJECT_DIR}/app_flask.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"

echo "==> done. status:"
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
