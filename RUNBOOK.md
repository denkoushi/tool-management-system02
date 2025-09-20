# Tool Management System (Raspberry Pi 5) — RUNBOOK

本書は、Raspberry Pi 5 上で運用する **工具持ち出し・返却管理システム** の「セットアップ手順」「運用手順」「バックアップ/リストア」「トラブルシューティング」をまとめた運用ドキュメントです。  
本リポジトリは、過去に安定稼働していた ZIP 版をベースに再構成した **復旧用ベースライン**です。

---

## 目的と設計方針（What & Why）

- 単純・再現性重視：`app_flask.py` 単体で **Flask + Socket.IO** を起動。NFC（PC/SC）スキャン → DB 記録 → 画面更新を 1 本化。
- 依存は最小限：`Flask / Flask-SocketIO / psycopg2-binary / pyscard`。
- DB は Docker で Postgres を起動（**healthcheck** と **restart ポリシー**で自動復帰）。Grafana は任意。
- 運用で落ちない工夫：
  - アプリ側：**DB 接続の 30 秒リトライ**（DB 起動待ちで落ちない）
  - Docker 側：**restart: unless-stopped** と **pg_isready healthcheck**
  - systemd：**UTF-8 ログ**・**pcscd / docker 待ち合わせ**・**自動起動**
- データ保全：**日次バックアップ（保持 14 日）**＋**リストア検証手順**を常備。
- 可観測性：journal（systemd）＋（任意）Grafana。
- セキュリティ初期値：Postgres と Grafana は **127.0.0.1 バインド**（LAN へ無用に露出しない）。

---

## ディレクトリ構成（最小）

    .
    ├─ app_flask.py               # 本体（Flask + Socket.IO + NFC 監視 + API + DB I/O）
    ├─ templates/
    │   └─ index.html             # 画面（借用/返却・タグ登録・工具名マスタ）
    ├─ static/
    │   └─ js/
    │       └─ socket.io.js       # クライアントSDK（オフライン対応）
    ├─ docker-compose.yml         # Postgres + Grafana（localhostバインド、restart, healthcheck）
    ├─ setup_auto_start.sh        # systemd 自動起動（UTF-8 ログ、pcscd/docker 待ち合わせ）
    ├─ scripts/
    │   ├─ backup_db.sh           # pg_dump → gzip、保持14日
    │   └─ install_backup_timer.sh# systemd timer (毎日 02:30 JST)
    ├─ backups/                   # バックアップ出力先（.gitignore）
    ├─ requirements.txt
    ├─ .gitignore
    ├─ README.md                  # 簡易版（当面の起動手順）
    └─ RUNBOOK.md                 # 本ドキュメント

---

## 0. 前提

- OS: Raspberry Pi OS (64bit, Bookworm 想定)
- NFCリーダー: PC/SC 対応（`pcscd` 経由）
- ポート:
  - アプリ: `:8501`（0.0.0.0）
  - Postgres: `127.0.0.1:5432`（Docker でローカルバインド）
  - Grafana: `127.0.0.1:3000`（任意）

---

## 1. 初期セットアップ（まっさらな環境）

1) APT と PC/SC

    sudo apt update
    sudo apt install -y git curl python3-venv python3-dev build-essential swig pkg-config
    sudo apt install -y pcscd pcsc-tools libpcsclite1 libpcsclite-dev libccid
    sudo systemctl enable --now pcscd
    # 認識テスト（表示を確認したら Ctrl+C）
    pcsc_scan

2) リポジトリ取得

    cd ~
    git clone https://github.com/denkoushi/tool-management-system02.git
    cd tool-management-system02

3) Docker / Compose

    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    newgrp docker
    docker --version
    docker compose version || (sudo apt install -y docker-compose-plugin && docker compose version)

4) Postgres / Grafana 起動

    docker compose pull
    docker compose up -d
    docker compose ps
    # Postgres のヘルス（healthy になるまで数秒）
    docker inspect -f '{{.State.Health.Status}}' pg

5) Python 仮想環境と依存

    python3 -m venv venv
    source venv/bin/activate
    pip install -U pip setuptools wheel
    pip install -r requirements.txt
    # インポート確認（OK と出ればOK）
    python -c 'import flask, flask_socketio, smartcard, psycopg2; print("OK")'

6) 前面起動テスト（まずは手動）

    source venv/bin/activate
    python app_flask.py
    # 別ターミナルで到達性確認（200 OK）
    curl -I http://localhost:8501 | head -n 1

---

## 2. 自動起動（systemd）と UTF-8 ログ

- スクリプト実行：

    cd ~/tool-management-system02
    sudo bash setup_auto_start.sh
    systemctl --no-pager --full status toolmgmt.service
    # ログ追尾（日本語/絵文字が正しく表示される）
    journalctl -u toolmgmt.service -f -n 100

- 仕組み（要点）  
  - `After=network-online.target pcscd.service docker.service`：起動順の安定化  
  - `LANG/LC_ALL/PYTHONIOENCODING/TZ`：**UTF-8 ログ/日本時間**  
  - `ExecStart=.../venv/bin/python app_flask.py`：仮想環境から起動

---

## 3. 画面操作（基本運用）

1) ブラウザで `http://<PiのIP>:8501` を開く（Pi 本体なら `http://localhost:8501`）。  
2) タブ構成：
   - **工具名マスタ**：工具名とコードを登録
   - **タグ登録**：ユーザー用タグ、工具用タグの紐づけ
   - **借用/返却**：**ユーザー → 工具** の順でスキャンすると貸出、返却時も同様（設計による）

> 注意：並行で `pcsc_scan` を起動しない（PC/SC を占有して競合します）

---

## 4. データ保全（バックアップ／リストア）

### 4.1 日次バックアップ（保持 14 日）

- タイマー導入（済であれば不要）：

    cd ~/tool-management-system02
    chmod +x scripts/*.sh
    sudo bash scripts/install_backup_timer.sh
    systemctl list-timers --all | grep backup_db

- 即時バックアップ実行：

    sudo systemctl start backup_db.service
    ls -lh backups | tail -n 3

- 仕様：
  - 実行：毎日 02:30（JST）
  - 出力：`backups/sensordb-YYYYmmdd-HHMMSS.sql.gz`
  - 保持：14 日より古いファイルは自動削除

### 4.2 復元テスト（検証用 DB：`sensordb_verify`）

- 最新バックアップの取得：

    LATEST=$(ls -1t backups/sensordb-*.sql.gz | head -n 1); echo "$LATEST"

- 検証用 DB 作成と読み戻し：

    docker exec -i pg psql -U app -d postgres -c "DROP DATABASE IF EXISTS sensordb_verify;"
    docker exec -i pg psql -U app -d postgres -c "CREATE DATABASE sensordb_verify OWNER app;"
    gunzip -c "$LATEST" | docker exec -i pg psql -U app -d sensordb_verify

- 確認：

    docker exec -it pg psql -U app -d sensordb_verify -c "\dt"
    docker exec -it pg psql -U app -d sensordb_verify -c "SELECT COUNT(*) AS users FROM users;"
    docker exec -it pg psql -U app -d sensordb_verify -c "SELECT COUNT(*) AS tools FROM tools;"
    docker exec -it pg psql -U app -d sensordb_verify -c "SELECT COUNT(*) AS open_loans FROM loans WHERE returned_at IS NULL;"

- 片付け（任意）：

    docker exec -i pg psql -U app -d postgres -c "DROP DATABASE sensordb_verify;"

---

## 5. 調整・強化点（実装済み）

- **DB 接続リトライ（最大 30 秒）**：DB 起動待ちでアプリが落ちない
- **docker-compose**：`restart: unless-stopped`、`pg_isready` **healthcheck**、**localhost バインド**、`TZ=Asia/Tokyo`
- **systemd 自動起動**：UTF-8 ログ、`pcscd/docker` 待ち合わせ、`PYTHONUNBUFFERED=1`
- **DB タイムゾーン**：`ALTER DATABASE sensordb SET timezone='Asia/Tokyo';`
- **日次バックアップ**：`scripts/backup_db.sh` + `backup_db.timer`（保持14日、検証手順付き）
- **インデックス追加（loans）**：未返却検索と履歴ソートの高速化
  - `loans_open_by_tool_idx`（`WHERE returned_at IS NULL`）
  - `loans_open_by_borrower_idx`（同上）
  - `loans_loaned_at_idx` / `loans_returned_at_idx`（降順ソート向け）

---

## 11. UI からの安全シャットダウン（ローカル限定）

**概要**  
- 画面右下に「安全にシャットダウン」ボタンを表示。  
- **このRaspberry Pi 上のブラウザ（キオスク含む）**からのみ実行可能（127.0.0.1/::1 判定）。  
- 必要に応じて、トークン（`SHUTDOWN_TOKEN`）でLAN内からの実行も許可できます。

**前提（sudoers を一度だけ設定）**  
- 運用ユーザー（例：`tools01`）に対し、`shutdown -h now` のみパスワード無しで許可。

    sudo tee /etc/sudoers.d/toolmgmt-shutdown >/dev/null <<'SUDO'
    tools01 ALL=(root) NOPASSWD: /sbin/shutdown -h now, /usr/sbin/shutdown -h now
    SUDO
    sudo visudo -cf /etc/sudoers.d/toolmgmt-shutdown && echo "sudoers OK"

**API**  
- `POST /api/shutdown`  
  - 要求: JSON `{"confirm": true}`  
  - 許可: ローカル(127.0.0.1/::1) からのみ。もしくは `SHUTDOWN_TOKEN` によるトークン一致時に許可。  
  - 応答: `{"ok": true, "message": "Shutting down..."}`（応答後、数秒で停止処理へ）

**フロントエンド**  
- 右下固定のフローティングボタン（`index.html` の `</body>` 直前でJSにより動的挿入）。  
- ボタン押下時、確認ダイアログ→ `/api/shutdown` を呼び出し。成功なら「開始しました」とトースト表示。

**任意: 遠隔で使う（推奨しない）**  
- `setup_auto_start.sh` の systemd ユニットへ環境変数を追加（例）  
    Environment=SHUTDOWN_TOKEN=<ランダムな長い文字列>
- その上でフロントの fetch にヘッダを追加  
    X-Shutdown-Token: <上と同じ値>
- 誤操作/悪用のリスクが上がるため、十分なネットワーク制御を前提とすること。

**注意点**  
- 実行後はLED消灯を確認してから電源を抜くこと。  
- `pcsc_scan` など別プロセスがカードリーダを掴んでいても、停止プロセスとは無関係。



## 6. 運用チートシート（よく使うコマンド）

- サービス状態とログ：

    systemctl is-active --quiet toolmgmt.service && echo "toolmgmt: OK" || (echo "toolmgmt: NG"; systemctl status toolmgmt.service --no-pager)
    journalctl -u toolmgmt.service -n 200 --no-pager
    journalctl -u toolmgmt.service -f

- DB/Grafana：

    docker compose ps
    docker inspect -f '{{.State.Health.Status}}' pg
    docker logs pg --tail 100

- アプリ疎通（HTTP ヘッダ）：

    curl -I http://localhost:8501 | head -n 1

- Postgres へ一発クエリ：

    docker exec -it pg psql -U app -d sensordb -c "\dt"
    docker exec -it pg psql -U app -d sensordb -P pager=off -c "SELECT id, tool_uid, borrower_uid, loaned_at, return_user_uid, returned_at FROM loans ORDER BY id DESC LIMIT 5;"

---

## 7. トラブルシューティング

- **DB 接続拒否（connection refused）**
  - `docker compose ps` → `pg` が Up/healthy か
  - `docker compose up -d`、`docker logs pg --tail 100`
  - 起動直後はアプリが **自動でリトライ**するので数十秒待つ

- **NFC が読めない / 反応がない**
  - `sudo systemctl status pcscd`、`pcsc_scan`（競合注意：pcsc_scan を終了してからアプリへ）
  - USB の抜き差し、`sudo systemctl restart pcscd`

- **画面が更新されない / Socket.IO が不安定**
  - ブラウザを再読み込み、別端末でも再現か確認
  - `journalctl -u toolmgmt.service -n 200` でエラー有無

- **VNC 経由のコピペで文字化け**
  - VNC のクリップボード経路による文字コード問題
  - 回避：SSH で `pbpaste | ssh ... "wl-copy"` / `"wl-paste" | pbcopy` など

---

## 8. セキュリティと公開ポート

- 既定では Postgres/Grafana は **127.0.0.1** でのみ公開。
- LAN へ開きたい場合は、`docker-compose.yml` の `ports` を `3000:3000` のように変更。
- さらに制御する場合は `ufw` 等で許可元をセグメント限定。
- アプリ `:8501` は LAN からアクセス可能（必要に応じて Reverse Proxy 等で保護）。

---

## 9. 将来の計画（任意）

- 本番向けサーバ（`gunicorn -k eventlet` など）への移行
- 構造化（`app/` パッケージ分割）とテスト導入
- 未返却アラート（Slack/メール）、CSV エクスポート API、Grafana ダッシュボード雛形

---
## 10. 再現性確保（Scripts Inventory）

本番機で手作業した設定を、スクリプト化してリポジトリに保存しています。新しい環境では以下を順に実行すれば、同じ状態を再現できます。

- OS前提導入  
    bash scripts/os_prereqs.sh

- Docker + Compose 導入（実行後に一度ログアウト/ログイン）  
    bash scripts/install_docker.sh

- コンテナ起動（既存手順どおり）  
    docker compose up -d

- DBポストインストール（JSTタイムゾーン & インデックス）  
    bash scripts/apply_db_tuning.sh

- キオスク自動起動（XDG オートスタート、任意）  
    bash scripts/install_kiosk_autostart.sh
    # 無効化する場合:
    bash scripts/remove_kiosk_autostart.sh

## 12. スキャンのタブ独立 & UI 同期

- 「借用/返却」タブでスキャンを開始しても、タブを移動すると **自動的にスキャン停止** します。
- 「借用/返却」以外のタブにいる間は、UI が **停止状態（《スキャン開始》=押せる、《停止》=押せない、ステータス=「● 停止中」）** に戻ります。
- 各タブは独立して値を扱い、**登録タブでのスキャン結果が借用/返却の欄に混入しません**。
- 実装概要：
  - フロントで `appScan.start('loan') / appScan.stop()` のラッパを使用して文脈を管理
  - タブ切替検知で `appScan.stop()` を強制実行
  - `scan_update` 受信時、文脈が `loan` でない場合は UI 更新しない

 ## 用語統一（UI表示）について

- 本システムでは UI 上の表示文言を「工具」→「アイテム」に統一しています。
- 既存DB/APIの識別子（`tool`, `tools`, `/api/tool_names` 等）は **互換性維持のため変更しません**（外部連携や過去データへの影響回避）。
- ラベルのみを差し替えているため、既存運用・データはそのまま利用できます。

## 高密度表示（フルHD/21インチ前提）

- `templates/index.html` のスタイルをコンパクト化済み。テーブルの行高と余白を圧縮し、**貸出中／履歴**の可視件数を増やしています。
- 一覧ヘッダはスクロール時も見えるよう **固定化** しています（`position: sticky`）。

