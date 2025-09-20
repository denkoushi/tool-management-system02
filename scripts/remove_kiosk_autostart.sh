#!/bin/bash
# キオスクの XDG オートスタートを無効化（退避）
set -euo pipefail
DESKTOP_FILE="${HOME}/.config/autostart/chromium-kiosk.desktop"

if [ -f "${DESKTOP_FILE}" ]; then
  mv "${DESKTOP_FILE}" "${DESKTOP_FILE}.off"
  echo "==> 無効化しました: ${DESKTOP_FILE}.off に退避"
else
  echo "==> 既に無効、または未設定: ${DESKTOP_FILE} がありません"
fi
