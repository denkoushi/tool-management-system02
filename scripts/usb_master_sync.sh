#!/bin/bash
# tool_master_sync.sh : USB 挿入時にマスターデータを取り込み/書き戻し

set -euo pipefail

MOUNT_POINT="/media/tool-master"
USB_DIR="${MOUNT_POINT}/master"
LOCAL_META="/var/lib/toolmgmt/master_sync/meta.json"
LOG_TAG="tool-master-sync"

DB_NAME="sensordb"
DB_USER="app"
DB_HOST="127.0.0.1"

DEVICE="${1:-}"
if [[ -z "${DEVICE}" ]]; then
  echo "[$LOG_TAG] USB デバイスパスが指定されていません" >&2
  exit 1
fi

log() {
  logger -t "$LOG_TAG" "$1"
  echo "[$LOG_TAG] $1"
}

cleanup() {
  sync || true
  if mountpoint -q "$MOUNT_POINT"; then
    umount "$MOUNT_POINT" || log "アンマウントに失敗: $MOUNT_POINT"
  fi
}
trap cleanup EXIT

mkdir -p "$MOUNT_POINT"
mkdir -p "$(dirname "$LOCAL_META")"

log "USB デバイス $DEVICE を $MOUNT_POINT にマウント"
mount "$DEVICE" "$MOUNT_POINT"

if [[ ! -d "$USB_DIR" ]]; then
  log "USB 内に master ディレクトリが見つかりません ($USB_DIR)"
  mkdir -p "$USB_DIR"
fi

meta_file_usb="${USB_DIR}/meta.json"

read_timestamp() {
  local file="$1"
  if [[ -f "$file" ]]; then
    python3 - "$file" <<'PY' || echo 0
import json, sys
from pathlib import Path
file_path = Path(sys.argv[1])
try:
    data = json.loads(file_path.read_text())
except Exception:
    print(0)
else:
    print(int(data.get("updated_at", 0)))
PY
  else
    echo 0
  fi
}

write_timestamp() {
  local file="$1" ts="$2"
  python3 - "$file" "$ts" <<'PY'
import json, sys, time
path = sys.argv[1]
ts_arg = sys.argv[2]
ts = int(ts_arg) if ts_arg.isdigit() else int(time.time())
with open(path, 'w', encoding='utf-8') as f:
    json.dump({"updated_at": ts}, f)
PY
}

max_csv_mtime() {
  local dir="$1"
  local latest=0
  for f in "$dir"/*.csv; do
    [[ -f "$f" ]] || continue
    mtime=$(stat -c %Y "$f")
    (( mtime > latest )) && latest=$mtime
  done
  echo "$latest"
}

usb_ts=$(read_timestamp "$meta_file_usb")
csv_ts=$(max_csv_mtime "$USB_DIR")
(( csv_ts > usb_ts )) && usb_ts=$csv_ts
local_ts=$(read_timestamp "$LOCAL_META")

psql_cmd() {
  PGPASSWORD="${PGPASSWORD:-app}" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

import_from_usb() {
  local has_data=0
  for f in tool_master.csv users.csv tools.csv; do
    [[ -f "$USB_DIR/$f" ]] && has_data=1
  done
  if [[ $has_data -eq 0 ]]; then
    log "USB にマスタ CSV が存在しないため取り込みをスキップ"
    return
  fi

  log "USB からマスタデータを取り込み"
  psql_cmd <<SQL
BEGIN;
TRUNCATE TABLE tools, tool_master, users RESTART IDENTITY CASCADE;
\copy tool_master(name) FROM '$USB_DIR/tool_master.csv' WITH (FORMAT csv, HEADER true);
\copy users(uid, full_name) FROM '$USB_DIR/users.csv' WITH (FORMAT csv, HEADER true);
\copy tools(uid, name) FROM '$USB_DIR/tools.csv' WITH (FORMAT csv, HEADER true);
COMMIT;
SQL
}

export_to_usb() {
  log "現在のマスタデータを USB へエクスポート"
  mkdir -p "$USB_DIR"
  psql_cmd <<SQL
\copy (SELECT name FROM tool_master ORDER BY name) TO '$USB_DIR/tool_master.csv' WITH (FORMAT csv, HEADER true);
\copy (SELECT uid, full_name FROM users ORDER BY uid) TO '$USB_DIR/users.csv' WITH (FORMAT csv, HEADER true);
\copy (SELECT uid, name FROM tools ORDER BY uid) TO '$USB_DIR/tools.csv' WITH (FORMAT csv, HEADER true);
SQL
}

if (( usb_ts > local_ts )); then
  log "USB データが新しいため取り込みを実施 (usb_ts=$usb_ts, local_ts=$local_ts)"
  import_from_usb
  local_ts=$usb_ts
else
  log "USB データは最新ではないため取り込みをスキップ (usb_ts=$usb_ts, local_ts=$local_ts)"
fi

export_to_usb
new_ts=$(date +%s)
write_timestamp "$meta_file_usb" "$new_ts"
write_timestamp "$LOCAL_META" "$new_ts"

log "USB 同期完了"
