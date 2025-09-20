#!/bin/bash
# Chromium を XDG オートスタート（キオスク）で自動起動
set -euo pipefail

DELAY="${1:-3}"  # 起動遅延（秒）。既定3秒
URL="${2:-http://localhost:8501}"

AUTOSTART_DIR="${HOME}/.config/autostart"
DESKTOP_FILE="${AUTOSTART_DIR}/chromium-kiosk.desktop"

echo "==> create ${AUTOSTART_DIR}"
mkdir -p "${AUTOSTART_DIR}"

echo "==> write ${DESKTOP_FILE}"
cat > "${DESKTOP_FILE}" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Chromium Kiosk (tool-management-system02)
Comment=Launch Chromium in kiosk mode for the tool management UI
Exec=/usr/bin/chromium-browser --kiosk ${URL} --incognito --no-first-run --noerrdialogs --disable-session-crashed-bubble --disable-infobars --start-fullscreen --password-store=basic --user-data-dir=%h/.config/chromium-kiosk --enable-features=UseOzonePlatform --ozone-platform-hint=auto
Terminal=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=${DELAY}
DESKTOP

echo "==> 完了: 次回ログイン時に全画面で ${URL} を自動表示します。"
echo "    すぐ試す場合はログアウト→ログイン、または 'Alt+F4' で閉じてから再実行してください。"
