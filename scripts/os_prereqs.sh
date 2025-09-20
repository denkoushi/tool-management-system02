#!/bin/bash
# OS前提導入: PC/SC とビルド系、Chromium（キオスク用）
set -euo pipefail

echo "==> apt update / 必須パッケージ導入"
sudo apt update
sudo apt install -y \
  git curl \
  python3-venv python3-dev build-essential swig pkg-config \
  pcscd pcsc-tools libpcsclite1 libpcsclite-dev libccid \
  chromium-browser xdg-utils

echo "==> pcscd を有効化"
sudo systemctl enable --now pcscd

echo "==> Done. 必要なら 'pcsc_scan' でリーダー認識を確認してください。"
