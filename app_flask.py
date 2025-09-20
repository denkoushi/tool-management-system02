#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import time
import threading
import json
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import psycopg2
from smartcard.CardRequest import CardRequest
from smartcard.util import toHexString
import os, subprocess, threading


# =========================
# 基本設定
# =========================
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
socketio = SocketIO(app, cors_allowed_origins="*")

# --- シャットダウンAPI用設定 ---
SHUTDOWN_TOKEN = os.getenv("SHUTDOWN_TOKEN")  # 任意。必要なら systemd に環境変数を追加して使う
ALLOWED_SHUTDOWN_ADDRS = {"127.0.0.1", "::1"}

def _is_local_request():
    try:
        addr = request.remote_addr or ""
        return addr in ALLOWED_SHUTDOWN_ADDRS
    except Exception:
        return False

DB = dict(host="127.0.0.1", port=5432, dbname="sensordb", user="app", password="app")
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
    finally:
        conn.close()

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
          SELECT COALESCE(t.name, l.tool_uid) AS tool,
                 COALESCE(u.full_name, l.borrower_uid) AS borrower,
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
    return render_template('index.html')

@app.route('/api/start_scan', methods=['POST'])
def start_scan():
    global scan_state
    scan_state["active"] = True
    scan_state["user_uid"] = ""
    scan_state["tool_uid"] = ""
    scan_state["message"] = "📡 スキャン待機中... ユーザータグをかざしてください"
    print("🟢 自動スキャン開始")
    return jsonify({"status": "started", "message": scan_state["message"]})

@app.route('/api/stop_scan', methods=['POST'])
def stop_scan():
    global scan_state
    scan_state["active"] = False
    scan_state["message"] = "⏹️ スキャン停止"
    print("🔴 自動スキャン停止")
    return jsonify({"status": "stopped", "message": scan_state["message"]})

@app.route('/api/reset', methods=['POST'])
def reset_state():
    global scan_state
    scan_state["user_uid"] = ""
    scan_state["tool_uid"] = ""
    scan_state["message"] = "🔄 リセット完了"
    print("🧹 状態リセット")
    return jsonify({"status": "reset"})

@app.route('/api/loans')
def get_loans():
    conn = get_conn()
    try:
        open_loans = fetch_open_loans(conn)
        history = fetch_recent_history(conn)
        return jsonify({
            "open_loans": [{"tool": r[0], "borrower": r[1], "loaned_at": r[2].isoformat()} for r in open_loans],
            "history": [{
                "action": r[0], "tool": r[1], "borrower": r[2], 
                "loaned_at": r[3].isoformat(), 
                "returned_at": r[4].isoformat() if r[4] else None
            } for r in history]
        })
    finally:
        conn.close()

@app.route('/api/scan_tag', methods=['POST'])
def scan_tag():
    """手動スキャン用API"""
    print("📡 手動スキャン実行中...")
    uid = read_one_uid(timeout=5)
    if uid:
        print(f"✅ 手動スキャン成功: {uid}")
        return jsonify({"uid": uid, "status": "success"})
    else:
        print("❌ 手動スキャン タイムアウト")
        return jsonify({"uid": None, "status": "timeout"})

@app.route('/api/register_user', methods=['POST'])
def register_user():
    data = request.json
    uid = data.get('uid')
    name = data.get('name')
    
    if not uid or not name:
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
        return jsonify({"status": "success", "message": "ユーザーを登録/更新しました"})
    except Exception as e:
        print(f"❌ ユーザー登録エラー: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/register_tool', methods=['POST'])
def register_tool():
    data = request.json
    uid = data.get('uid')
    name = data.get('name')
    
    if not uid or not name:
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
        return jsonify({"status": "success", "message": "工具を登録/更新しました"})
    except Exception as e:
        print(f"❌ 工具登録エラー: {e}")
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
def add_tool_name_api():
    data = request.json
    name = data.get('name')
    
    if not name:
        return jsonify({"error": "工具名を入力してください"}), 400
    
    conn = get_conn()
    try:
        add_tool_name(conn, name.strip())
        print(f"📚 工具名追加: {name}")
        return jsonify({"status": "success", "message": "追加しました"})
    except Exception as e:
        print(f"❌ 工具名追加エラー: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/delete_tool_name', methods=['POST'])
def delete_tool_name_api():
    data = request.json
    name = data.get('name')
    
    if not name:
        return jsonify({"error": "工具名を指定してください"}), 400
    
    conn = get_conn()
    try:
        delete_tool_name(conn, name)
        print(f"🗑️ 工具名削除: {name}")
        return jsonify({"status": "success", "message": "削除しました"})
    except Exception as e:
        print(f"❌ 工具名削除エラー: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/check_tag', methods=['POST'])
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
                
            return jsonify(result)
        finally:
            conn.close()
    else:
        print("❌ タグ情報確認 タイムアウト")
        return jsonify({"uid": None, "status": "timeout"})

@app.route("/api/shutdown", methods=["POST"])
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
            return jsonify({"ok": False, "error": "confirm_required"}), 400

        if not (_is_local_request() or (SHUTDOWN_TOKEN and token == SHUTDOWN_TOKEN)):
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
        return jsonify({"ok": True, "message": "Shutting down..."})
    except Exception as e:
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
