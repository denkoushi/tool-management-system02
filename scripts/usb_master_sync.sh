#!/bin/bash
# tool_master_sync.sh : USB 挿入時にマスターデータを取り込み/書き戻し

set -euo pipefail

MOUNT_POINT="/media/tool-master"
USB_DIR="${MOUNT_POINT}/master"
LOCAL_META="/var/lib/toolmgmt/master_sync/meta.json"
LOG_TAG="tool-master-sync"
LOG_FILE="/var/log/toolmgmt/usbsync.log"
CLAMAV_SCAN="${CLAMAV_SCAN:-clamscan}"

DB_NAME="sensordb"
DB_USER="app"
DB_HOST="127.0.0.1"

DEVICE="${1:-}"
if [[ -z "${DEVICE}" ]]; then
  echo "[$LOG_TAG] USB デバイスパスが指定されていません" >&2
  exit 1
fi

log() {
  local message="$1"
  local level="${2:-info}"
  local timestamp

  timestamp=$(date '+%Y-%m-%dT%H:%M:%S%z')
  logger -p "user.${level}" -t "$LOG_TAG" "$message"
  echo "[$LOG_TAG] $message"

  {
    printf '%s [%s] %s\n' "$timestamp" "${level^^}" "$message"
  } >> "$LOG_FILE" 2>/dev/null || true
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
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE" || true

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

validate_file_mime() {
  local path="$1"
  local kind="$2"
  local base
  local ext
  local mime
  local allowed=0
  local allowed_mimes=()

  base=$(basename "$path")
  ext="${base##*.}"

  case "$kind" in
    csv)
      if [[ "$ext" != "csv" ]]; then
        log "${base} の拡張子が .csv ではありません" warning
        return 1
      fi
      allowed_mimes=("text/csv" "text/plain" "application/vnd.ms-excel" "application/octet-stream" "inode/x-empty")
      ;;
    json)
      if [[ "$ext" != "json" ]]; then
        log "${base} の拡張子が .json ではありません" warning
        return 1
      fi
      allowed_mimes=("application/json" "text/plain" "inode/x-empty")
      ;;
    *)
      log "${base} の MIME チェック対象種別 ${kind} は未対応です" warning
      return 1
      ;;
  esac

  mime=$(file --brief --mime-type "$path" 2>/dev/null || echo "unknown")

  for allowed_mime in "${allowed_mimes[@]}"; do
    if [[ "$mime" == "$allowed_mime" ]]; then
      allowed=1
      break
    fi
  done

  if [[ $allowed -eq 0 ]]; then
    log "${base} の MIME タイプ ${mime} は許可されていません" warning
    return 1
  fi

  return 0
}

validate_usb_payload() {
  local blocked=0
  local base
  local allowed_names=(
    "tool_master.csv"
    "users.csv"
    "tools.csv"
    "meta.json"
    "production_plan.csv"
    "standard_times.csv"
  )

  if ! command -v file >/dev/null 2>&1; then
    log "file コマンドが見つからないため USB ファイルの MIME チェックに失敗" warning
    return 1
  fi

  shopt -s nullglob dotglob
  local entries=("$USB_DIR"/*)
  shopt -u nullglob dotglob

  for path in "${entries[@]}"; do
    [[ -e "$path" ]] || continue
    base=$(basename "$path")

    if [[ -d "$path" ]]; then
      log "USB 内にディレクトリ ${base} を検出しました (同期対象外)" warning
      blocked=1
      continue
    fi

    local allowed=0
    for name in "${allowed_names[@]}"; do
      if [[ "$base" == "$name" ]]; then
        allowed=1
        break
      fi
    done

    if [[ $allowed -eq 0 ]]; then
      log "USB 内に未許可ファイル ${base} を検出しました" warning
      blocked=1
      continue
    fi

    if [[ "$base" == "meta.json" ]]; then
      validate_file_mime "$path" json || blocked=1
    else
      validate_file_mime "$path" csv || blocked=1
    fi
  done

  if (( blocked == 0 )); then
    log "USB ファイル検証を完了 (問題なし)"
  fi

  return $blocked
}

run_clamav_scan() {
  if ! command -v "$CLAMAV_SCAN" >/dev/null 2>&1; then
    log "ClamAV (clamscan) が見つからないためウイルススキャンをスキップしました" warning
    return 0
  fi

  local output
  output=$("$CLAMAV_SCAN" -r --infected --no-summary "$MOUNT_POINT" 2>&1)
  local rc=$?

  if (( rc == 0 )); then
    log "ClamAV スキャン完了 (脅威なし)"
    return 0
  fi

  local compact_output
  compact_output=$(echo "$output" | tr '\n' ';')

  if (( rc == 1 )); then
    log "ClamAV が脅威を検知: ${compact_output}" warning
    return 1
  fi

  log "ClamAV スキャンに失敗しました (rc=$rc): ${compact_output}" warning
  return 2
}

PLAN_LOCAL_DIR="/var/lib/toolmgmt/plan"
PLAN_OWNER="${PLAN_OWNER:-tools01}"
PLAN_GROUP="${PLAN_GROUP:-tools01}"

validate_plan_header() {
  local file_path="$1"
  shift
  python3 - "$file_path" "$@" <<'PY'
import csv, sys
from pathlib import Path

path = Path(sys.argv[1])
expected = sys.argv[2].split(',')
try:
    with path.open('r', encoding='utf-8-sig', newline='') as fh:
        reader = csv.reader(fh)
        headers = next(reader, [])
except Exception as exc:
    print(f"header read error: {exc}")
    sys.exit(1)

if headers != expected:
    print(f"expected {','.join(expected)} but found {','.join(headers)}")
    sys.exit(1)
PY
}

sync_plan_files() {
  local status=0
  local plan_files=(
    "production_plan.csv"
    "standard_times.csv"
  )

  mkdir -p "$PLAN_LOCAL_DIR"
  chown "$PLAN_OWNER:$PLAN_GROUP" "$PLAN_LOCAL_DIR" || true

  for name in "${plan_files[@]}"; do
    local src="$USB_DIR/$name"
    local dest="$PLAN_LOCAL_DIR/$name"

    if [[ ! -f "$src" ]]; then
      log "$name が USB 内に見つかりません (任意項目のためスキップします)"
      continue
    fi

    local expected_header=""
    case "$name" in
      production_plan.csv)
        expected_header="納期,個数,部品番号,部品名,製番,工程名"
        ;;
      standard_times.csv)
        expected_header="部品名,機械標準工数,製造オーダー番号,部品番号,工程名"
        ;;
    esac

    if [[ -n "$expected_header" ]]; then
      if ! validate_plan_header "$src" "$expected_header" >/dev/null 2>&1; then
        log "$name のヘッダー検証に失敗しました (フォーマットを確認してください)" warning
        status=1
        continue
      fi
    fi

    if install -m 640 -o "$PLAN_OWNER" -g "$PLAN_GROUP" "$src" "$dest"; then
      log "$name を計画ディレクトリへ更新しました"
    else
      log "$name のコピーに失敗しました" warning
      status=1
    fi
  done

  return $status
}

usb_ts=$(read_timestamp "$meta_file_usb")
csv_ts=$(max_csv_mtime "$USB_DIR")
(( csv_ts > usb_ts )) && usb_ts=$csv_ts
local_ts=$(read_timestamp "$LOCAL_META")

validation_failed=0
if ! validate_usb_payload; then
  log "USB ファイル検証に失敗したため取り込みをスキップします" warning
  validation_failed=1
fi

clamav_result=0
if (( validation_failed == 0 )); then
  set +e
  run_clamav_scan
  clamav_result=$?
  set -e

  if (( clamav_result == 1 )); then
    log "ウイルス検知のためマスタ同期処理を中断しました" warning
    exit 3
  elif (( clamav_result == 2 )); then
    log "ウイルススキャンエラーのため手動確認が必要です" warning
    exit 4
  fi
fi

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

if (( validation_failed == 0 )); then
  if (( usb_ts > local_ts )); then
    log "USB データが新しいため取り込みを実施 (usb_ts=$usb_ts, local_ts=$local_ts)"
    import_from_usb
    local_ts=$usb_ts
  else
    log "USB データは最新ではないため取り込みをスキップ (usb_ts=$usb_ts, local_ts=$local_ts)"
  fi

  if ! sync_plan_files; then
    log "生産計画 CSV の取り込みで一部警告が発生しました (ログを確認してください)" warning
  fi

  export_to_usb
  new_ts=$(date +%s)
  write_timestamp "$meta_file_usb" "$new_ts"
  write_timestamp "$LOCAL_META" "$new_ts"

  log "USB 同期完了"
else
  log "ファイル検証エラーのためマスタ同期処理を中断しました" warning
  exit 2
fi
