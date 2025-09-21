#!/bin/bash
# install_usb_master_sync.sh : USB マスター同期の systemd/udev 設定

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "root (sudo) で実行してください" >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_BIN="/usr/local/bin/tool_master_sync.sh"
MOUNT_POINT="/media/tool-master"
SERVICE_FILE="/etc/systemd/system/tool-master-sync@.service"
UDEV_RULE="/etc/udev/rules.d/99-tool-master-sync.rules"

echo "==> スクリプトを ${INSTALL_BIN} に配置"
install -m 0755 "$PROJECT_DIR/scripts/usb_master_sync.sh" "$INSTALL_BIN"

echo "==> マウントディレクトリを作成: $MOUNT_POINT"
mkdir -p "$MOUNT_POINT"

echo "==> systemd unit を設定"
cat <<'UNIT' >"$SERVICE_FILE"
[Unit]
Description=Tool master CSV sync for %I
After=local-fs.target
DefaultDependencies=no
BindsTo=dev-%i.device

[Service]
Type=oneshot
ExecStart=/usr/local/bin/tool_master_sync.sh /dev/%I

[Install]
WantedBy=multi-user.target
UNIT

echo "==> udev ルールを設定 (ラベル: TOOLMASTER)"
cat <<'RULE' >"$UDEV_RULE"
ACTION=="add", SUBSYSTEM=="block", ENV{ID_FS_LABEL}=="TOOLMASTER", ENV{ID_FS_USAGE}=="filesystem", \ 
  TAG+="systemd", ENV{SYSTEMD_WANTS}+="tool-master-sync@%k.service"
RULE

echo "==> systemd/udev をリロード"
systemctl daemon-reload
udevadm control --reload

echo "==> インストール完了"
echo "USB メモリはファイルシステムラベルを 'TOOLMASTER' に設定して使用してください"
