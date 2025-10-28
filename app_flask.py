#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import time
import threading
import json
import csv
import uuid
from datetime import datetime, timezone
from typing import Optional
from functools import wraps
from typing import Optional
import logging
from pathlib import Path
from flask import Flask, render_template, request, jsonify, has_request_context
from flask_socketio import SocketIO, emit
import psycopg2
from smartcard.CardRequest import CardRequest
from smartcard.util import toHexString
import os
from urllib.parse import urlparse
import subprocess
import urllib.request
from usb_sync import run_usb_sync
from station_config import load_station_config, save_station_config
from api_token_store import (
    get_token_info,
    get_active_tokens,
    list_tokens,
    issue_token,
    revoke_token,
    API_TOKEN_FILE,
    API_TOKEN_HEADER,
)
from raspi_client import (
    RaspiServerClient,
    RaspiServerAuthError,
    RaspiServerClientError,
)


# =========================
# 基本設定
# =========================
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['DOCUMENT_VIEWER_URL'] = os.getenv("DOCUMENT_VIEWER_URL", "http://127.0.0.1:5000")
socketio = SocketIO(app, cors_allowed_origins="*")

UPSTREAM_SOCKET_BASE = os.getenv(
    "UPSTREAM_SOCKET_BASE",
    os.getenv("RASPI_SERVER_SOCKET_URL", os.getenv("RASPI_SERVER_BASE", ""))
)
UPSTREAM_SOCKET_PATH = os.getenv("UPSTREAM_SOCKET_PATH", "/socket.io")
UPSTREAM_SOCKET_AUTO = os.getenv("UPSTREAM_SOCKET_AUTO", "1")


def _normalize_socket_base(value: Optional[str]) -> str:
    if not value:
        return ""
    return value.rstrip("/")


def _parse_bool(value: Optional[str], default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "off", "no", ""}


SOCKET_CLIENT_CONFIG = {
    "base": _normalize_socket_base(UPSTREAM_SOCKET_BASE),
    "path": UPSTREAM_SOCKET_PATH if UPSTREAM_SOCKET_PATH else "/socket.io",
    "auto": _parse_bool(UPSTREAM_SOCKET_AUTO, True),
}


def _create_raspi_client() -> RaspiServerClient:
    """Instantiate a RaspberryPiServer client using environment defaults."""
    return RaspiServerClient.from_env()

# --- API 認証/監査設定 ---
API_TOKEN_ENFORCED = _parse_bool(os.getenv("API_TOKEN_ENFORCE", "1"), True)
LOG_PATH = Path(os.getenv(
    "API_AUDIT_LOG",
    str((Path(__file__).resolve().parent / "logs" / "api_actions.log").resolve())
))
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

audit_logger = logging.getLogger("api_audit")
if not audit_logger.handlers:
    handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
    handler.setFormatter(logging.Formatter('%(asctime)s\t%(message)s'))
    audit_logger.addHandler(handler)
    audit_logger.setLevel(logging.INFO)

# --- 生産計画/標準工数データ設定 ---
# --- シャットダウンAPI用設定 ---
SHUTDOWN_TOKEN = os.getenv("SHUTDOWN_TOKEN")  # 任意。必要なら systemd に環境変数を追加して使う
ALLOWED_SHUTDOWN_ADDRS = {"127.0.0.1", "::1"}

def _discover_local_addresses():
    import socket
    import subprocess
    addresses = set(ALLOWED_SHUTDOWN_ADDRS)
    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = None

    if hostname:
        try:
            for info in socket.getaddrinfo(hostname, None):
                addr = info[4][0]
                if addr:
                    addresses.add(addr)
        except socket.gaierror:
            pass
        try:
            addresses.update(v for v in socket.gethostbyname_ex(hostname)[2] if v)
        except Exception:
            pass

    # hostname -I の結果も併用（複数NICを想定）
    try:
        output = subprocess.check_output(["hostname", "-I"], text=True).strip()
        for addr in output.split():
            if addr:
                addresses.add(addr)
                # IPv4 の場合は ::ffff: プレフィックスでも受け付ける
                if addr.count('.') == 3:
                    addresses.add(f"::ffff:{addr}")
    except Exception:
        pass

    return addresses

LOCAL_SHUTDOWN_ADDRS = _discover_local_addresses()

def _is_local_request():
    try:
        addr = request.remote_addr or ""
        return addr in LOCAL_SHUTDOWN_ADDRS
    except Exception:
        return False


def log_api_action(action: str, status: str = "success", detail=None) -> None:
    if not audit_logger.handlers:
        return

    payload = {
        "action": action,
        "status": status,
    }
    if has_request_context():
        payload["remote_addr"] = request.remote_addr
        user_agent = request.headers.get("User-Agent")
        if user_agent:
            payload["user_agent"] = user_agent
        station_id = request.environ.get("api_station_id")
        if station_id:
            payload["station_id"] = station_id
    if detail not in (None, ""):
        payload["detail"] = detail

    try:
        audit_logger.info(json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:
        # ログ出力で例外が出ても本体処理を止めない
        audit_logger.warning("ログ出力に失敗しました", exc_info=True)



def _parse_due_date(value: str) -> Optional[datetime]:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


    try:
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            headers = reader.fieldnames or []
            if headers != cfg["columns"]:
                result["error"] = (
                    f"{cfg['label']}のヘッダーが想定と異なります: {headers}"
                )
                return result
            rows = []
            for row in reader:
                normalized = {column: row.get(column, "") for column in cfg["columns"]}
                rows.append(normalized)
    except FileNotFoundError:
        result["error"] = f"{cfg['label']}ファイルが見つかりません ({path})"
        return result
    except Exception as exc:  # pylint: disable=broad-except
        result["error"] = f"{cfg['label']}の読み込みに失敗しました: {exc}"
        return result

    result["rows"] = rows
    try:
        result["updated_at"] = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
    except Exception:  # pylint: disable=broad-except
        result["updated_at"] = None
    return result




def build_production_view() -> dict:
    client = _create_raspi_client()
    if not client.is_configured():
        error = "RASPI_SERVER_BASE is not configured"
        return {
            "entries": [],
            "plan_entries": [],
            "standard_entries": [],
            "plan_error": error,
            "standard_error": error,
            "plan_updated_at": None,
            "standard_updated_at": None,
            "plan_source": "raspi_server",
            "standard_source": "raspi_server",
        }

    def _fetch_dataset(endpoint: str, label: str):
        try:
            payload = client.get_json(endpoint, allow_statuses={200, 404})
        except (RaspiServerAuthError, RaspiServerClientError) as exc:
            return [], f"{label}: {exc}", None
        entries = payload.get("entries") or []
        error = payload.get("error")
        if error:
            error = f"{label}: {error}"
        updated = payload.get("updated_at")
        return entries, error, updated

    plan_entries_raw, plan_error, plan_updated_at = _fetch_dataset(
        "/api/v1/production-plan",
        "生産計画",
    )
    standard_entries_raw, standard_error, standard_updated_at = _fetch_dataset(
        "/api/v1/standard-times",
        "標準工数",
    )

    plan_entries = []
    for row in plan_entries_raw:
        record = dict(row)
        record["_sort_due"] = _parse_due_date(row.get("納期"))
        plan_entries.append(record)

    plan_entries.sort(
        key=lambda item: (
            item.get("_sort_due") if item.get("_sort_due") else datetime.max,
            item.get("製番", ""),
        )
    )
    for item in plan_entries:
        item.pop("_sort_due", None)

    standard_entries = []
    for row in standard_entries_raw:
        record = dict(row)
        record["_sort_key"] = (
            record.get("部品番号", ""),
            record.get("工程名", ""),
        )
        standard_entries.append(record)

    standard_entries.sort(
        key=lambda item: (
            item["_sort_key"][0] or "",
            item["_sort_key"][1] or "",
        )
    )
    for item in standard_entries:
        item.pop("_sort_key", None)

    return {
        "entries": plan_entries,
        "plan_entries": plan_entries,
        "standard_entries": standard_entries,
        "plan_error": plan_error,
        "standard_error": standard_error,
        "plan_updated_at": plan_updated_at,
        "standard_updated_at": standard_updated_at,
        "plan_source": "raspi_server",
        "standard_source": "raspi_server",
    }


def fetch_part_locations(limit: int = 200) -> list[dict[str, object]]:
    try:
        limit_value = int(limit or 0)
    except (TypeError, ValueError):
        limit_value = 200
    limit_value = max(1, min(limit_value, 1000))

    client = _create_raspi_client()
    if not client.is_configured():
        print("[part-locations] RASPI_SERVER_BASE is not configured")
        return []

    try:
        payload = client.get_json(
            "/api/v1/part-locations",
            params={"limit": limit_value},
        )
    except (RaspiServerAuthError, RaspiServerClientError) as exc:
        print(f"[part-locations] remote fetch failed: {exc}")
        return []

    entries = payload.get("entries") or []
    results: list[dict[str, object]] = []
    for item in entries:
        results.append(
            {
                "order_code": item.get("order_code"),
                "location_code": item.get("location_code"),
                "device_id": item.get("device_id"),
                "last_scan_id": item.get("last_scan_id"),
                "scanned_at": item.get("scanned_at"),
                "updated_at": item.get("updated_at"),
            }
        )
    return results



def _extract_provided_token() -> str:
    header_token = request.headers.get(API_TOKEN_HEADER)
    if header_token:
        return header_token
    json_payload = request.get_json(silent=True) or {}
    token = json_payload.get("token")
    if token:
        return token
    return request.args.get("token")


def require_api_token(action_name: str):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if not API_TOKEN_ENFORCED:
                return func(*args, **kwargs)
            active_tokens = get_active_tokens()
            if active_tokens:
                provided = _extract_provided_token()
                if not provided:
                    log_api_action(
                        action_name,
                        status="denied",
                        detail="missing_token",
                    )
                    return jsonify({"error": "unauthorized"}), 401

                matched = next((t for t in active_tokens if t.get("token") == provided), None)
                if not matched:
                    log_api_action(
                        action_name,
                        status="denied",
                        detail={"reason": "invalid_token"},
                    )
                    return jsonify({"error": "unauthorized"}), 401

                station_id = matched.get("station_id")
                if station_id:
                    request.environ["api_station_id"] = station_id
            return func(*args, **kwargs)

        return wrapper

    return decorator

def _build_db_config() -> dict:
    url = os.getenv("DATABASE_URL")
    if url:
        parsed = urlparse(url)
        return {
            "host": parsed.hostname or "127.0.0.1",
            "port": parsed.port or 5432,
            "dbname": (parsed.path or "/sensordb").lstrip("/") or "sensordb",
            "user": parsed.username or "app",
            "password": parsed.password or "app",
        }

    return {
        "host": os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "dbname": os.getenv("DB_NAME", "sensordb"),
        "user": os.getenv("DB_USER", "app"),
        "password": os.getenv("DB_PASSWORD", "app"),
    }


DB = _build_db_config()
GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]  # PC/SC: GET DATA (UID/IDm)

# グローバル状態
scan_state = {
    "active": False,
    "user_uid": "",
    "tool_uid": "",
    "last_scanned_uid": "",
    "last_scan_time": 0,
    "message": ""
}


def emit_station_config_update(config: dict) -> None:
    """Broadcast station configuration update to connected clients."""
    try:
        socketio.emit("station_config_updated", config, broadcast=True)
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[station-config] failed to broadcast update: {exc}")


def check_doc_viewer_health(url: str, timeout: float = 1.0) -> bool:
    """Return True if DocumentViewer ビューアが稼働しているか判定する。"""
    if not url:
        return False

    health_url = f"{url.rstrip('/')}/health"
    try:
        with urllib.request.urlopen(health_url, timeout=timeout):
            return True
    except Exception as exc:
        print(f"[DocViewer] health check failed: {exc}")
        return False

# =========================
# DBユーティリティ
# =========================
# --- DB接続: リトライ付き（最大30秒） ---
def get_conn():
    import time
    last_err = None
    for i in range(30):
        try:
            conn = psycopg2.connect(**DB)
            return conn
        except Exception as e:
            last_err = e
            print(f"[DB] connect retry {i+1}/30: {e}", flush=True)
            time.sleep(1)
    # 30回失敗したら最後の例外を投げる
    raise last_err

def ensure_tables():
    """必要テーブルを作成"""
    conn = get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
              CREATE TABLE IF NOT EXISTS users(
                uid TEXT PRIMARY KEY,
                full_name TEXT NOT NULL
              )
            """)
            cur.execute("""
              CREATE TABLE IF NOT EXISTS tool_master(
                id BIGSERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL
              )
            """)
            cur.execute("""
              CREATE TABLE IF NOT EXISTS tools(
                uid TEXT PRIMARY KEY,
                name TEXT NOT NULL REFERENCES tool_master(name) ON UPDATE CASCADE
              )
            """)
            cur.execute("""
              CREATE TABLE IF NOT EXISTS scan_events(
                id BIGSERIAL PRIMARY KEY,
                ts TIMESTAMPTZ NOT NULL DEFAULT now(),
                station_id TEXT NOT NULL DEFAULT 'pi1',
                tag_uid TEXT NOT NULL,
                role_hint TEXT CHECK (role_hint IN ('user','tool') OR role_hint IS NULL)
              )
            """)
            cur.execute("""
              CREATE TABLE IF NOT EXISTS loans(
                id BIGSERIAL PRIMARY KEY,
                tool_uid TEXT NOT NULL,
                borrower_uid TEXT NOT NULL,
                loaned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                return_user_uid TEXT,
                returned_at TIMESTAMPTZ
              )
            """)
            cur.execute("""
              CREATE TABLE IF NOT EXISTS part_locations(
                order_code TEXT PRIMARY KEY,
                location_code TEXT NOT NULL,
                device_id TEXT,
                last_scan_id TEXT,
                scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
              )
            """)
    finally:
        conn.close()


def _parse_iso8601(value: Optional[str]) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    if isinstance(value, (int, float)):
        # treat numeric value as unix timestamp (seconds)
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if not isinstance(value, str):
        raise ValueError("timestamp must be string")
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError("invalid timestamp format") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _to_utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def name_of_user(conn, uid):
    with conn.cursor() as cur:
        cur.execute("SELECT full_name FROM users WHERE uid=%s", (uid,))
        r = cur.fetchone()
    return r[0] if r else uid

def name_of_tool(conn, uid):
    with conn.cursor() as cur:
        cur.execute("SELECT name FROM tools WHERE uid=%s", (uid,))
        r = cur.fetchone()
    return r[0] if r else uid

def list_tool_names(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT name FROM tool_master ORDER BY name ASC")
        return [r[0] for r in cur.fetchall()]

def add_tool_name(conn, name):
    with conn, conn.cursor() as cur:
        cur.execute("INSERT INTO tool_master(name) VALUES(%s) ON CONFLICT(name) DO NOTHING", (name,))

def delete_tool_name(conn, name):
    with conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM tools WHERE name=%s LIMIT 1", (name,))
        if cur.fetchone():
            raise RuntimeError("この工具名は '工具' に割当済みです。先に tools 側を変更/削除してください。")
        cur.execute("DELETE FROM tool_master WHERE name=%s", (name,))

def insert_scan(conn, uid, role=None):
    with conn, conn.cursor() as cur:
        cur.execute("INSERT INTO scan_events(tag_uid, role_hint) VALUES (%s,%s)", (uid, role))

def borrow_or_return(conn, user_uid, tool_uid):
    """貸出中なら返却、未貸出なら貸出を登録"""
    with conn, conn.cursor() as cur:
        cur.execute("""
          SELECT id, borrower_uid FROM loans
          WHERE tool_uid=%s AND returned_at IS NULL
          ORDER BY loaned_at DESC LIMIT 1
        """, (tool_uid,))
        row = cur.fetchone()
        if row:  # 返却
            loan_id, prev_user = row
            cur.execute("""
              UPDATE loans
                 SET returned_at=NOW(), return_user_uid=%s
               WHERE id=%s
            """, (user_uid, loan_id))
            return "return", {"prev_user": prev_user}
        else:    # 新規貸出
            cur.execute("""
              INSERT INTO loans(tool_uid, borrower_uid) VALUES (%s,%s)
            """, (tool_uid, user_uid))
            return "borrow", {}

def fetch_open_loans(conn, limit=100):
    with conn.cursor() as cur:
        cur.execute("""
          SELECT l.id,
                 l.tool_uid,
                 COALESCE(t.name, l.tool_uid) AS tool_name,
                 l.borrower_uid,
                 COALESCE(u.full_name, l.borrower_uid) AS borrower_name,
                 l.loaned_at
            FROM loans l
       LEFT JOIN tools t ON t.uid=l.tool_uid
       LEFT JOIN users u ON u.uid=l.borrower_uid
           WHERE l.returned_at IS NULL
        ORDER BY l.loaned_at DESC
           LIMIT %s
        """, (limit,))
        return cur.fetchall()

def fetch_recent_history(conn, limit=50):
    with conn.cursor() as cur:
        cur.execute("""
          SELECT CASE WHEN l.returned_at IS NULL THEN '貸出' ELSE '返却' END AS action,
                 COALESCE(t.name, l.tool_uid) AS tool,
                 COALESCE(u.full_name, l.borrower_uid) AS borrower,
                 l.loaned_at, l.returned_at
            FROM loans l
       LEFT JOIN tools t ON t.uid=l.tool_uid
       LEFT JOIN users u ON u.uid=l.borrower_uid
        ORDER BY COALESCE(l.returned_at, l.loaned_at) DESC
           LIMIT %s
        """, (limit,))
        return cur.fetchall()

def complete_loan_manually(conn, loan_id):
    """スキャンせずに返却処理を行う"""
    with conn, conn.cursor() as cur:
        cur.execute("""
          UPDATE loans
             SET returned_at = NOW(),
                 return_user_uid = COALESCE(return_user_uid, borrower_uid)
           WHERE id=%s AND returned_at IS NULL
       RETURNING tool_uid, borrower_uid
        """, (loan_id,))
        row = cur.fetchone()
        if not row:
            raise RuntimeError("対象の貸出が見つかりませんでした")
        return row

def delete_open_loan(conn, loan_id):
    """貸出中リストから該当レコードを削除"""
    with conn, conn.cursor() as cur:
        cur.execute("""
          SELECT l.tool_uid,
                 COALESCE(t.name, l.tool_uid) AS tool_name
            FROM loans l
       LEFT JOIN tools t ON t.uid = l.tool_uid
           WHERE l.id=%s AND l.returned_at IS NULL
        """, (loan_id,))
        row = cur.fetchone()
        if not row:
            raise RuntimeError("貸出中のレコードが見つかりません")

        tool_uid, tool_name = row
        cur.execute("DELETE FROM loans WHERE id=%s", (loan_id,))
        return tool_uid, tool_name

# =========================
# NFCスキャン機能
# =========================
def read_one_uid(timeout=3):
    """NFCタグを読み取り"""
    try:
        cs = CardRequest(timeout=timeout, newcardonly=True).waitforcard()
        if cs is None:
            return None
        cs.connection.connect()
        data, sw1, sw2 = cs.connection.transmit(GET_UID)
        cs.connection.disconnect()
        if ((sw1 << 8) | sw2) == 0x9000 and data:
            return toHexString(data).replace(" ", "")
    except Exception as e:
        # タイムアウトエラーは表示しない（正常動作）
        if "Time-out" not in str(e) and "Command timeout" not in str(e):
            print(f"スキャンエラー: {e}")
    return None

def scan_monitor():
    """バックグラウンドでNFCスキャンを監視"""
    global scan_state
    
    while True:
        if not scan_state["active"]:
            time.sleep(0.5)
            continue
            
        try:
            uid = read_one_uid(timeout=1)
            if uid:
                # 連続スキャン防止
                current_time = time.time()
                if uid == scan_state["last_scanned_uid"] and (current_time - scan_state["last_scan_time"]) < 2:
                    continue
                    
                scan_state["last_scanned_uid"] = uid
                scan_state["last_scan_time"] = current_time
                
                conn = get_conn()
                try:
                    # ユーザーがまだ設定されていない場合
                    if not scan_state["user_uid"]:
                        scan_state["user_uid"] = uid
                        scan_state["message"] = f"👤 ユーザー読取: {name_of_user(conn, uid)} ({uid})"
                        insert_scan(conn, uid, "user")
                        
                        socketio.emit('scan_update', {
                            'user_uid': scan_state["user_uid"],
                            'user_name': name_of_user(conn, uid),
                            'tool_uid': scan_state["tool_uid"],
                            'tool_name': "",
                            'message': scan_state["message"]
                        })
                        
                    # ユーザーが設定済みで工具がまだの場合
                    elif not scan_state["tool_uid"]:
                        scan_state["tool_uid"] = uid
                        scan_state["message"] = f"🛠️ 工具読取: {name_of_tool(conn, uid)} ({uid})"
                        insert_scan(conn, uid, "tool")
                        
                        # 両方揃った場合は自動実行
                        try:
                            action, info = borrow_or_return(conn, scan_state["user_uid"], scan_state["tool_uid"])
                            if action == "borrow":
                                message = f"✅ 貸出：{name_of_tool(conn, scan_state['tool_uid'])} → {name_of_user(conn, scan_state['user_uid'])}"
                            else:
                                message = f"✅ 返却：{name_of_tool(conn, scan_state['tool_uid'])} by {name_of_user(conn, scan_state['user_uid'])}（借用者: {name_of_user(conn, info.get('prev_user',''))}）"
                            
                            socketio.emit('transaction_complete', {
                                'user_uid': scan_state["user_uid"],
                                'user_name': name_of_user(conn, scan_state["user_uid"]),
                                'tool_uid': scan_state["tool_uid"],
                                'tool_name': name_of_tool(conn, scan_state["tool_uid"]),
                                'message': message,
                                'action': action
                            })
                            
                            print(f"✅ 処理完了: {message}")
                            
                            # 3秒後にリセット
                            def reset_state():
                                time.sleep(3)
                                scan_state["user_uid"] = ""
                                scan_state["tool_uid"] = ""
                                scan_state["message"] = "📡 スキャン待機中... ユーザータグをかざしてください"
                                socketio.emit('state_reset', {
                                    'message': scan_state["message"]
                                })
                                print("🔄 次の処理待ち")
                            
                            threading.Thread(target=reset_state, daemon=True).start()
                            
                        except Exception as e:
                            error_msg = f"❌ エラー: {e}"
                            print(error_msg)
                            socketio.emit('error', {'message': error_msg})
                            
                finally:
                    conn.close()
                    
        except Exception as e:
            # 重要でないエラーは表示しない
            if "Time-out" not in str(e) and "Command timeout" not in str(e):
                print(f"スキャンループエラー: {e}")
            time.sleep(1)
        
        time.sleep(0.1)

# =========================
# Webルート
# =========================
@app.route('/')
def index():
    doc_viewer_url = app.config.get('DOCUMENT_VIEWER_URL')
    doc_viewer_online = check_doc_viewer_health(doc_viewer_url)
    production_view = build_production_view()
    station_config = load_station_config()
    part_locations = fetch_part_locations()
    token_info = get_token_info()
    return render_template(
        'index.html',
        doc_viewer_url=doc_viewer_url,
        doc_viewer_online=doc_viewer_online,
        api_token_required=API_TOKEN_ENFORCED and bool(token_info.get("token")),
        api_token_header=API_TOKEN_HEADER,
        api_station_id=token_info.get("station_id", ""),
        api_token_error=token_info.get("error"),
        production_view=production_view,
        station_config=station_config,
        part_locations=part_locations,
        socket_client_config=SOCKET_CLIENT_CONFIG,
    )

@app.route('/api/start_scan', methods=['POST'])
@require_api_token("start_scan")
def start_scan():
    global scan_state
    scan_state["active"] = True
    scan_state["user_uid"] = ""
    scan_state["tool_uid"] = ""
    scan_state["message"] = "📡 スキャン待機中... ユーザータグをかざしてください"
    print("🟢 自動スキャン開始")
    log_api_action("start_scan", detail={"message": scan_state["message"]})
    return jsonify({"status": "started", "message": scan_state["message"]})

@app.route('/api/stop_scan', methods=['POST'])
@require_api_token("stop_scan")
def stop_scan():
    global scan_state
    scan_state["active"] = False
    scan_state["message"] = "⏹️ スキャン停止"
    print("🔴 自動スキャン停止")
    log_api_action("stop_scan", detail={"message": scan_state["message"]})
    return jsonify({"status": "stopped", "message": scan_state["message"]})

@app.route('/api/reset', methods=['POST'])
@require_api_token("reset_state")
def reset_state():
    global scan_state
    scan_state["user_uid"] = ""
    scan_state["tool_uid"] = ""
    scan_state["message"] = "🔄 リセット完了"
    print("🧹 状態リセット")
    log_api_action("reset_state")
    return jsonify({"status": "reset"})

@app.route('/api/loans')
def get_loans():
    conn = get_conn()
    try:
        open_loans = fetch_open_loans(conn)
        history = fetch_recent_history(conn)
        return jsonify({
            "open_loans": [{
                "id": r[0],
                "tool_uid": r[1],
                "tool": r[2],
                "borrower_uid": r[3],
                "borrower": r[4],
                "loaned_at": r[5].isoformat()
            } for r in open_loans],
            "history": [{
                "action": r[0], "tool": r[1], "borrower": r[2], 
                "loaned_at": r[3].isoformat(), 
                "returned_at": r[4].isoformat() if r[4] else None
            } for r in history]
        })
    finally:
        conn.close()


@app.route('/api/station_config', methods=['GET'])
@require_api_token("station_config_get")
def api_station_config_get():
    config = load_station_config()
    log_api_action("station_config_get", detail={"process": config.get("process"), "source": config.get("source")})
    return jsonify(config)


@app.route('/api/station_config', methods=['POST'])
@require_api_token("station_config_update")
def api_station_config_update():
    payload = request.get_json(silent=True) or {}
    process = payload.get("process", None)
    available = payload.get("available", None)

    if process is not None and not isinstance(process, str):
        return jsonify({"error": "process は文字列で指定してください"}), 400

    if available is not None:
        if not isinstance(available, (list, tuple)):
            return jsonify({"error": "available は文字列のリストで指定してください"}), 400
        normalized = []
        for item in available:
            if not isinstance(item, str):
                return jsonify({"error": "available には文字列のみ指定できます"}), 400
            normalized.append(item)
        available = normalized

    try:
        config = save_station_config(process=process, available=available)
    except Exception as exc:  # pylint: disable=broad-except
        log_api_action("station_config_update", status="error", detail=str(exc))
        return jsonify({"error": str(exc)}), 500

    log_api_action("station_config_update", detail={
        "process": config.get("process"),
        "available": config.get("available"),
    })
    emit_station_config_update(config)
    return jsonify(config)


@app.route('/api/tokens', methods=['GET'])
@require_api_token("list_tokens")
def api_tokens_list():
    reveal = request.args.get('reveal') == '1'
    tokens = list_tokens(with_token=reveal)
    summary = get_token_info()
    if not reveal and summary.get("token"):
        summary = dict(summary)
        summary["token"] = summary.get("token_preview", "***")
    log_api_action("list_tokens", detail={"count": len(tokens)})
    return jsonify({
        "tokens": tokens,
        "summary": summary,
        "file": str(API_TOKEN_FILE),
    })


@app.route('/api/tokens', methods=['POST'])
@require_api_token("issue_token")
def api_tokens_issue():
    payload = request.get_json(silent=True) or {}
    station_id = (payload.get("station_id") or "").strip()
    keep_existing = bool(payload.get("keep_existing"))
    note = payload.get("note")

    if not station_id:
        return jsonify({"error": "station_id を指定してください"}), 400

    try:
        entry = issue_token(station_id=station_id, token=None, note=note, keep_existing=keep_existing)
    except Exception as exc:  # pylint: disable=broad-except
        log_api_action("issue_token", status="error", detail=str(exc))
        return jsonify({"error": str(exc)}), 500

    log_api_action("issue_token", detail={
        "station_id": station_id,
        "note": note,
        "keep_existing": keep_existing,
    })

    response = {
        "token": entry.get("token"),
        "station_id": entry.get("station_id"),
        "issued_at": entry.get("issued_at"),
        "note": entry.get("note"),
    }
    return jsonify(response)


@app.route('/api/v1/scans', methods=['POST'])
@require_api_token("scan_intake")
def api_v1_scans():
    payload = request.get_json(silent=True) or {}

    def _bad_request(reason: str, status: int = 400):
        log_api_action("scan_intake", status="denied", detail=reason)
        return jsonify({"error": reason}), status

    part_code = str(payload.get("part_code", "")).strip()
    location_code = str(payload.get("location_code", "")).strip()
    if not part_code or not location_code:
        return _bad_request("missing_part_or_location")

    scan_id = str(payload.get("scan_id") or uuid.uuid4())
    device_id = payload.get("device_id")
    if isinstance(device_id, str):
        device_id = device_id.strip() or None
    else:
        device_id = None

    try:
        scanned_at = _parse_iso8601(payload.get("scanned_at"))
    except ValueError:
        return _bad_request("invalid_scanned_at")

    conn = get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO part_locations (order_code, location_code, device_id, last_scan_id, scanned_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, now())
                ON CONFLICT (order_code)
                DO UPDATE SET
                    location_code = EXCLUDED.location_code,
                    device_id = EXCLUDED.device_id,
                    last_scan_id = EXCLUDED.last_scan_id,
                    scanned_at = EXCLUDED.scanned_at,
                    updated_at = now()
                RETURNING order_code, location_code, device_id, last_scan_id, scanned_at, updated_at
                """,
                (part_code, location_code, device_id, scan_id, scanned_at)
            )
            row = cur.fetchone()
    finally:
        conn.close()

    log_api_action("scan_intake")

    response = {
        "accepted": True,
        "order_code": row[0],
        "location_code": row[1],
        "device_id": row[2],
        "scan_id": row[3],
        "scanned_at": _to_utc_iso(row[4]),
        "updated_at": _to_utc_iso(row[5]),
    }
    try:
        socketio.emit("part_location_updated", response, broadcast=True)
    except Exception:
        pass
    return jsonify(response)


@app.route('/api/part_locations', methods=['GET'])
@require_api_token("part_location_list")
def api_part_locations_list():
    raw_limit = request.args.get('limit', 200)
    try:
        limit_value = int(raw_limit)
    except (TypeError, ValueError):
        limit_value = 200
    limit_value = max(1, min(limit_value, 1000))
    items = fetch_part_locations(limit_value)
    log_api_action("part_location_list", detail={"count": len(items), "limit": limit_value})
    return jsonify({
        "items": items,
        "limit": limit_value,
    })


@app.route('/api/tokens/revoke', methods=['POST'])
@require_api_token("revoke_token")
def api_tokens_revoke():
    payload = request.get_json(silent=True) or {}
    token = payload.get("token")
    station_id = payload.get("station_id")
    revoke_all = bool(payload.get("all"))

    if not (token or station_id or revoke_all):
        return jsonify({"error": "token / station_id / all のいずれかを指定してください"}), 400

    try:
        count = revoke_token(token=token, station_id=station_id, all_tokens=revoke_all)
    except Exception as exc:  # pylint: disable=broad-except
        log_api_action("revoke_token", status="error", detail=str(exc))
        return jsonify({"error": str(exc)}), 500

    log_api_action("revoke_token", detail={
        "token": token,
        "station_id": station_id,
        "all": revoke_all,
        "updated": count,
    })
    return jsonify({"updated": count})

@app.route('/api/loans/<int:loan_id>/manual_return', methods=['POST'])
@require_api_token("manual_return")
def manual_return_loan(loan_id):
    conn = get_conn()
    try:
        try:
            tool_uid, borrower_uid = complete_loan_manually(conn, loan_id)
        except RuntimeError as e:
            log_api_action("manual_return", status="error", detail={"loan_id": loan_id, "error": str(e)})
            return jsonify({"error": str(e)}), 404
        tool_name = name_of_tool(conn, tool_uid)
        borrower_name = name_of_user(conn, borrower_uid)
        message = f"✅ 手動返却：{tool_name} を {borrower_name} から回収しました"
        socketio.emit('transaction_complete', {
            'user_uid': borrower_uid,
            'user_name': borrower_name,
            'tool_uid': tool_uid,
            'tool_name': tool_name,
            'message': message,
            'action': 'return'
        })
        log_api_action("manual_return", detail={"loan_id": loan_id, "tool_uid": tool_uid, "borrower_uid": borrower_uid})
        return jsonify({"status": "success", "message": message})
    except Exception as e:
        log_api_action("manual_return", status="error", detail={"loan_id": loan_id, "error": str(e)})
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/loans/<int:loan_id>', methods=['DELETE'])
@require_api_token("delete_open_loan")
def delete_open_loan_api(loan_id):
    conn = get_conn()
    try:
        try:
            tool_uid, tool_name = delete_open_loan(conn, loan_id)
        except RuntimeError as e:
            log_api_action("delete_open_loan", status="error", detail={"loan_id": loan_id, "error": str(e)})
            return jsonify({"error": str(e)}), 404
        message = f"🗑️ 貸出記録を削除しました: {tool_name} ({tool_uid})"
        log_api_action("delete_open_loan", detail={"loan_id": loan_id, "tool_uid": tool_uid})
        return jsonify({"status": "success", "message": message, "tool_uid": tool_uid})
    except Exception as e:
        log_api_action("delete_open_loan", status="error", detail={"loan_id": loan_id, "error": str(e)})
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/usb_sync', methods=['POST'])
@require_api_token("usb_sync")
def api_usb_sync():
    device = '/dev/sda1'
    if request.is_json:
        device = request.json.get('device', device)
    try:
        result = run_usb_sync(device)
        code = int(result.get("returncode", 1))
        status = "success" if code == 0 else "error"
        payload = {
            "status": status,
            "returncode": code,
            "stdout": result.get("stdout", ""),
            "stderr": result.get("stderr", ""),
            "steps": result.get("steps", []),
        }
        log_api_action("usb_sync", status=status, detail={"device": device, "returncode": code})
        return jsonify(payload), (200 if code == 0 else 500)
    except Exception as e:
        log_api_action("usb_sync", status="error", detail={"device": device, "error": str(e)})
        return jsonify({"status": "error", "stderr": str(e)}), 500

@app.route('/api/scan_tag', methods=['POST'])
@require_api_token("scan_tag")
def scan_tag():
    """手動スキャン用API"""
    print("📡 手動スキャン実行中...")
    uid = read_one_uid(timeout=5)
    if uid:
        print(f"✅ 手動スキャン成功: {uid}")
        log_api_action("scan_tag", detail={"status": "success", "uid": uid})
        return jsonify({"uid": uid, "status": "success"})
    else:
        print("❌ 手動スキャン タイムアウト")
        log_api_action("scan_tag", status="error", detail={"status": "timeout"})
        return jsonify({"uid": None, "status": "timeout"})

@app.route('/api/register_user', methods=['POST'])
@require_api_token("register_user")
def register_user():
    data = request.json
    uid = data.get('uid')
    name = data.get('name')
    
    if not uid or not name:
        log_api_action("register_user", status="error", detail="missing_uid_or_name")
        return jsonify({"error": "UID と 氏名 は必須です"}), 400
    
    conn = get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
              INSERT INTO users(uid, full_name)
              VALUES(%s,%s)
              ON CONFLICT(uid) DO UPDATE SET full_name=EXCLUDED.full_name
            """, (uid, name.strip()))
        print(f"👤 ユーザー登録: {name} ({uid})")
        log_api_action("register_user", detail={"uid": uid, "name": name})
        return jsonify({"status": "success", "message": "ユーザーを登録/更新しました"})
    except Exception as e:
        print(f"❌ ユーザー登録エラー: {e}")
        log_api_action("register_user", status="error", detail={"uid": uid, "error": str(e)})
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/register_tool', methods=['POST'])
@require_api_token("register_tool")
def register_tool():
    data = request.json
    uid = data.get('uid')
    name = data.get('name')
    
    if not uid or not name:
        log_api_action("register_tool", status="error", detail="missing_uid_or_name")
        return jsonify({"error": "UID と 工具名 は必須です"}), 400
    
    conn = get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
              INSERT INTO tools(uid, name)
              VALUES(%s,%s)
              ON CONFLICT(uid) DO UPDATE SET name=EXCLUDED.name
            """, (uid, name))
        print(f"🛠️ 工具登録: {name} ({uid})")
        log_api_action("register_tool", detail={"uid": uid, "name": name})
        return jsonify({"status": "success", "message": "工具を登録/更新しました"})
    except Exception as e:
        print(f"❌ 工具登録エラー: {e}")
        log_api_action("register_tool", status="error", detail={"uid": uid, "error": str(e)})
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tool_names')
def get_tool_names():
    conn = get_conn()
    try:
        names = list_tool_names(conn)
        return jsonify({"names": names})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/add_tool_name', methods=['POST'])
@require_api_token("add_tool_name")
def add_tool_name_api():
    data = request.json
    name = data.get('name')
    
    if not name:
        log_api_action("add_tool_name", status="error", detail="missing_name")
        return jsonify({"error": "工具名を入力してください"}), 400
    
    conn = get_conn()
    try:
        add_tool_name(conn, name.strip())
        print(f"📚 工具名追加: {name}")
        log_api_action("add_tool_name", detail={"name": name})
        return jsonify({"status": "success", "message": "追加しました"})
    except Exception as e:
        print(f"❌ 工具名追加エラー: {e}")
        log_api_action("add_tool_name", status="error", detail={"name": name, "error": str(e)})
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/delete_tool_name', methods=['POST'])
@require_api_token("delete_tool_name")
def delete_tool_name_api():
    data = request.json
    name = data.get('name')
    
    if not name:
        log_api_action("delete_tool_name", status="error", detail="missing_name")
        return jsonify({"error": "工具名を指定してください"}), 400
    
    conn = get_conn()
    try:
        delete_tool_name(conn, name)
        print(f"🗑️ 工具名削除: {name}")
        log_api_action("delete_tool_name", detail={"name": name})
        return jsonify({"status": "success", "message": "削除しました"})
    except Exception as e:
        print(f"❌ 工具名削除エラー: {e}")
        log_api_action("delete_tool_name", status="error", detail={"name": name, "error": str(e)})
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/check_tag', methods=['POST'])
@require_api_token("check_tag")
def check_tag():
    """タグ情報確認用API"""
    print("📡 タグ情報確認スキャン実行中...")
    uid = read_one_uid(timeout=5)
    if uid:
        print(f"✅ タグ情報確認成功: {uid}")
        
        conn = get_conn()
        try:
            # ユーザー情報確認
            with conn.cursor() as cur:
                cur.execute("SELECT full_name FROM users WHERE uid=%s", (uid,))
                user_result = cur.fetchone()
                
                cur.execute("SELECT name FROM tools WHERE uid=%s", (uid,))
                tool_result = cur.fetchone()
            
            result = {"uid": uid, "status": "success"}
            
            if user_result:
                result["type"] = "user"
                result["name"] = user_result[0]
                result["message"] = f"👤 ユーザー: {user_result[0]}"
            elif tool_result:
                result["type"] = "tool" 
                result["name"] = tool_result[0]
                result["message"] = f"🛠️ 工具: {tool_result[0]}"
            else:
                result["type"] = "unregistered"
                result["name"] = ""
                result["message"] = "❓ 未登録のタグです"
            log_api_action("check_tag", detail=result)
            return jsonify(result)
        finally:
            conn.close()
    else:
        print("❌ タグ情報確認 タイムアウト")
        log_api_action("check_tag", status="error", detail={"status": "timeout"})
        return jsonify({"uid": None, "status": "timeout"})

@app.route("/api/shutdown", methods=["POST"])
@require_api_token("shutdown")
def api_shutdown():
    """
    ローカル操作（127.0.0.1/::1）または有効なトークンでのみ受け付ける安全シャットダウン。
    UI側は confirm ダイアログを出し、confirm=True を必須にする。
    """
    try:
        data = request.get_json(silent=True) or {}
        confirmed = bool(data.get("confirm"))
        # トークンは JSON またはヘッダで受け取り可能
        token = (data.get("token")
                 or request.headers.get("X-Shutdown-Token")
                 or (request.headers.get("Authorization", "").replace("Bearer ", "")))

        if not confirmed:
            log_api_action("shutdown", status="error", detail="confirm_missing")
            return jsonify({"ok": False, "error": "confirm_required"}), 400

        if not (_is_local_request() or (SHUTDOWN_TOKEN and token == SHUTDOWN_TOKEN)):
            log_api_action("shutdown", status="denied", detail={"remote": request.remote_addr})
            return jsonify({"ok": False, "error": "forbidden"}), 403

        def do_shutdown():
            try:
                # 1秒後に実行（HTTP応答が返りやすいようディレイ）
                try:
                    subprocess.run(["sudo", "/sbin/shutdown", "-h", "now"], check=True)
                except FileNotFoundError:
                    subprocess.run(["sudo", "/usr/sbin/shutdown", "-h", "now"], check=True)
            except Exception as e:
                print(f"[shutdown] failed: {e}", flush=True)

        threading.Timer(1.0, do_shutdown).start()
        log_api_action("shutdown", detail={"remote": request.remote_addr})
        return jsonify({"ok": True, "message": "Shutting down..."})
    except Exception as e:
        log_api_action("shutdown", status="error", detail=str(e))
        return jsonify({"ok": False, "error": str(e)}), 500


# =========================
# 初期化・起動
# =========================
if __name__ == '__main__':
    ensure_tables()
    
    # バックグラウンドスキャンスレッド開始
    scan_thread = threading.Thread(target=scan_monitor, daemon=True)
    scan_thread.start()
    
    print("🚀 Flask 工具管理システムを開始します...")
    print("📡 NFCスキャン監視スレッド開始")
    print("🌐 http://0.0.0.0:8501 でアクセス可能")
    print("💡 タイムアウトエラーは正常動作（タグ待機中）なので無視してください")
    socketio.run(app, host='0.0.0.0', port=8501, debug=False, allow_unsafe_werkzeug=True)
