#!/bin/bash
# configure_ufw.sh: Apply UFW baseline rules for the tool-management system.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "このスクリプトは root 権限で実行してください (sudo を使用)。" >&2
  exit 1
fi

print_usage() {
  cat <<USAGE
Usage: sudo $0 <CIDR|IP> [<CIDR|IP> ...] [--no-enable]

  <CIDR|IP>    SSH を許可する送信元 IP または CIDR を指定してください。
               例) 192.168.10.0/24 あるいは 192.168.10.15
  --no-enable  ルール適用後に UFW を有効化しません (現場の確認前に設定だけ入れたい場合)。

複数指定した場合は全てに対して 22/tcp を許可します。
USAGE
}

enable_flag="yes"
declare -a allow_sources=()

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      print_usage
      exit 0
      ;;
    --no-enable)
      enable_flag="no"
      ;;
    *)
      allow_sources+=("$arg")
      ;;
  esac
 done

if ((${#allow_sources[@]} == 0)); then
  echo "許可する送信元を 1 つ以上指定してください。" >&2
  print_usage
  exit 1
fi

echo "[INFO] UFW の既存ルールを初期化します" >&2
ufw --force reset >/dev/null

# 基本ポリシー
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null

# ループバックと既存接続を許可
ufw allow in on lo >/dev/null
ufw allow out on lo >/dev/null
ufw allow proto tcp from 127.0.0.1 to 127.0.0.1 port 22 comment 'SSH loopback' >/dev/null || true
ufw allow proto tcp from ::1 to ::1 port 22 comment 'SSH loopback ipv6' >/dev/null || true

# SSH 用許可ルール
for src in "${allow_sources[@]}"; do
  ufw allow from "$src" to any port 22 proto tcp comment "SSH from $src" >/dev/null
  echo "[INFO] SSH を $src から許可しました" >&2
 done

echo "[INFO] 状態確認:"
ufw status numbered

if [[ "$enable_flag" == "yes" ]]; then
  echo "[INFO] UFW を有効化します" >&2
  ufw --force enable >/dev/null
  ufw status numbered
else
  echo "[INFO] --no-enable が指定されたため UFW を有効化していません。\n現場でネットワークを確認した後に \"sudo ufw enable\" を実行してください。" >&2
fi
