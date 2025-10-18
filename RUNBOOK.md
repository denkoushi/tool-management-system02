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

    sudo apt update && sudo apt upgrade -y
    sudo apt install -y git curl python3-venv python3-dev build-essential swig pkg-config
    sudo apt install -y pcscd pcsc-tools libpcsclite1 libpcsclite-dev libccid
    sudo systemctl enable --now pcscd
    # 認識テスト（表示を確認したら Ctrl+C）
    pcsc_scan

2) Docker / Compose（公式スクリプト）

    cd ~
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    # ログアウト→再ログイン、または newgrp docker で反映
    newgrp docker  # 同一セッションで続ける場合
    docker --version
    docker compose version

3) リポジトリ取得と Python 仮想環境

    git clone https://github.com/denkoushi/tool-management-system02.git
    cd tool-management-system02
    python3 -m venv venv
    source venv/bin/activate
    pip install -U pip setuptools wheel
    pip install -r requirements.txt

4) Postgres / Grafana 起動

    docker compose pull
    docker compose up -d
    docker compose ps
    docker inspect -f '{{.State.Health.Status}}' pg

5) psql クライアント

    sudo apt install -y postgresql-client

6) 前面起動テスト（まずは手動）

    source venv/bin/activate
    python app_flask.py
    curl -I http://localhost:8501 | head -n 1

    - Pi 上で Chromium などを起動し `http://127.0.0.1:8501` へアクセスできれば OK。LAN 側の IP（例: `http://192.168.x.x:8501`）でも UI は表示されるが、安全シャットダウンボタンは localhost アクセス時のみ許可される点に注意。

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
   - **借用/返却**：左半分の操作エリアで借用/返却を実施。**ユーザー → 工具** の順でスキャンすると貸出、同じ順序で再スキャンすると返却。
3) 補助操作：
   - **手動返却**ボタン（貸出中リスト内）… スキャンできない場合でも返却済みにでき、履歴へ移動します。
   - **削除**ボタン（貸出中リスト内）… 誤登録等で貸出記録を破棄する用途。貸出リストのみから削除され、タグIDとアイテム名の紐づけは維持されます。

> 画面は左半分のみを操作領域として使用し、右半分は今後の拡張用に空けています。

> 注意：並行で `pcsc_scan` を起動しない（PC/SC を占有して競合します）

---

### 3.1 マスターデータ同期（USB）

1. **USB の準備**
   - ext4 などでフォーマットし、必ずラベルを **`TOOLMASTER`** に設定（例: `sudo e2label /dev/sdX1 TOOLMASTER`）。
   - ルート直下に `master/`（CSV 用）と `docviewer/`（PDF 用）を作成し、初回は空でも構いません（Pi 側が自動生成します）。
2. **Pi での初期設定**
   - `sudo bash scripts/install_usb_master_sync.sh` を実行し、`/usr/local/bin/tool_master_sync.sh` と `tool-master-sync@.service` / udev ルールを配置。
   - 設定は 1 度だけで OK。以後は USB を挿すだけで同期が走ります。
3. **同期の流れ**
   - USB を挿入 → `/media/tool-master/` に自動マウント → `master/*.csv` を取り込み（USB の更新が新しければ Pi を上書き）。
   - 取り込み対象の CSV/JSON は拡張子と MIME タイプをホワイトリスト検証し、許可外のファイルや形式が見つかった場合は同期を中断し `/var/log/toolmgmt/usbsync.log` に記録。
   - 取り込み後、Pi 側の最新マスターデータを USB に書き戻し、`meta.json` に更新時刻を記録。
   - 続けて `../DocumentViewer/scripts/usb-import.sh` を呼び出し、`docviewer/*.pdf` を取り込み（USB 側が新しい場合）。完了後に自動アンマウント。`docviewer.service` が起動していることが前提。
   - ログは `journalctl -u tool-master-sync@*`（直近なら `journalctl -u tool-master-sync@$(ls /dev/disk/by-label/TOOLMASTER)` 等）および `/var/log/toolmgmt/usbsync.log`、DocumentViewer 側は `/var/log/document-viewer/import.log` を参照。
   - **バリデーション警告が出たときの確認手順**
     1. 画面やログに `USB ファイル検証に失敗` / `unexpected file 'xxx'` が出たら USB を抜かずに置く。
     2. `tail -n 20 /var/log/toolmgmt/usbsync.log` で対象ファイル名を確認。DocumentViewer 側の警告は `tail -n 20 /var/log/document-viewer/import.log` で確認。
     3. 別 PC で USB を開き、ログに載ったファイルを削除または正しい形式に修正（例: `.csv`/.`pdf` 以外を削除）。
     4. USB を安全に取り外し、ラズパイへ再接続した上で再度同期を実行。
     5. 正常に完了したかをログで再確認。疑わしいファイルが原因であれば、USB を初期化して正規データのみコピーし直す。
   - **ウイルス検知時の対応（exit=3）**
     1. ログに `ClamAV が脅威を検知` が出た場合は、その USB を隔離し業務で使用しない。
     2. 安全な PC で USB 内の感染ファイルを削除するか、USB 全体を再フォーマット。
     3. 定義ファイルを最新化した別 USB で再スキャンし、脅威がないことを確認してから再配布する。
     4. 必要であれば情シスへ報告し、他端末への影響が無いか確認する。
   - **ウイルススキャンエラー時の対応（exit=4）**
     1. ログに `ウイルススキャンエラーのため手動確認が必要です` が出た場合、`clamscan` 実行環境を確認。
     2. `which clamscan` でコマンド有無、`clamscan --version` で動作確認。
     3. 定義ファイルが壊れている可能性があるため後述の更新手順で `main.cvd` などを入れ直す。
     4. 解決後に USB を再スキャンし、正常終了することを確認。
   - UI から同期する場合は「🛠 メンテナンス」タブ内の「USB 同期を実行」ボタンを利用。内部的に上記 2 ステップを直列で実行し、結果は画面のログに整形して表示されます。
   - sudoers に下記エントリを追加し、パスワード無しでスクリプトを実行できるようにしておくと運用が楽になります（ユーザー名/パスは環境に合わせて変更）。

        sudo tee /etc/sudoers.d/toolmgmt-usbsync >/dev/null <<'SUDO'
        tools01 ALL=(root) NOPASSWD: /bin/bash /home/tools01/tool-management-system02/scripts/usb_master_sync.sh
        tools01 ALL=(root) NOPASSWD: /bin/bash /home/tools01/DocumentViewer/scripts/usb-import.sh
        SUDO
        sudo visudo -cf /etc/sudoers.d/toolmgmt-usbsync
4. **CSV を人手で編集する場合**
   - `master/tool_master.csv`（工具名マスタ：1列、重複不可）
   - `master/users.csv`（2列：`uid`,`full_name`）
   - `master/tools.csv`（2列：`uid`,`name`。`name` は `tool_master.csv` に存在する値）
   - いずれも UTF-8・ヘッダー付きで保存後、USB を Pi に挿すと取り込み → 最新 CSV に書き戻し。
   - 編集後は PC で安全な取り外しを行ってから Pi に接続（書き込みキャッシュ破損を防ぐ）。
   - DocumentViewer に追加する PDF は `docviewer/` 配下へコピーし、必要に応じて `meta.json` の `updated_at` を更新してください（未設定の場合はスクリプトが自動で補完します）。
5. **トラブルシューティング**
   - 取り込みエラー時は CSV の列順やヘッダー、参照整合性（`tools.csv` の `name` が `tool_master.csv` に存在するか）を確認。
   - `meta.json` はスクリプトが管理するので手動で編集しないこと。

> すべての処理がワンショットで完了するため、USB を抜き差しするだけで他拠点へマスターデータを配布できます。履歴（貸出ログ）は含まれない点に注意してください。

#### ClamAV 定義ファイルのオフライン更新手順

1. インターネットに接続できる PC で [ClamAV Signature Database](https://www.clamav.net/downloads) から `main.cvd`, `daily.cvd`, `bytecode.cvd` をダウンロード。
2. USB メモリなどで `/var/lib/clamav/` にコピー。例：

    ```bash
    sudo cp /media/USB/main.cvd /var/lib/clamav/
    sudo cp /media/USB/daily.cvd /var/lib/clamav/
    sudo cp /media/USB/bytecode.cvd /var/lib/clamav/
    sudo chown clamav:clamav /var/lib/clamav/*.cvd
    ```

3. 既存の定義ファイルが壊れている場合は `sudo rm /var/lib/clamav/*.cvd` で削除してからコピー。
4. 反映後に `sudo systemctl restart clamav-freshclam.service 2>/dev/null || true` を実行し、`clamscan --version` でエラーがないか確認。
5. USB を再スキャンして正常に完了することを確認。

### 3.2 キオスク運用（任意）

- `sudo bash setup_auto_start.sh` で Flask アプリを systemd サービス化。
- `bash scripts/install_kiosk_autostart.sh` を通常ユーザーで実行し、`~/.config/autostart/chromium-kiosk.desktop` を生成。
- `sudo raspi-config` → System Options → Boot / Auto Login → Desktop Autologin を選択。
- 再起動すると GUI ログイン直後に Chromium が `http://127.0.0.1:8501` を全画面表示します。停止したい場合は `~/.config/autostart/chromium-kiosk.desktop` を削除し、再ログインしてください。

### 3.3 OS レベル防御（Firewall / SSH）

1. **事前調査**
   - 現在のネットワークを把握：`ip -4 addr show` や `hostname -I` で管理端末の IP を確認。
   - 管理端末からの接続テスト：`ssh tools01@<ラズパイIP>` が鍵認証で成功すること。

2. **UFW の設定**
   - スクリプトを利用：

        cd ~/tool-management-system02
        sudo ./scripts/configure_ufw.sh <許可したいCIDR> [追加CIDR...] --no-enable

     - 例：`sudo ./scripts/configure_ufw.sh 192.168.10.0/24 --no-enable`
     - 現場でネットワークを確認後、`sudo ufw enable` を実行して有効化。
     - 別端末からの疎通確認後、`sudo ufw status numbered` を記録。

3. **SSH 設定強化**
   - `/etc/ssh/sshd_config` に以下を明示的に追加（既存行があれば上書き）：

        PermitRootLogin no
        PasswordAuthentication no
        PubkeyAuthentication yes
        AllowUsers tools01

   - 編集後に構文確認：`sudo sshd -t`
   - 反映：`sudo systemctl restart ssh`
   - 別セッションで鍵認証ログインできるか確認。

4. **fail2ban**（ブルートフォース対策）
   - インストール：`sudo apt install fail2ban`
   - `/etc/fail2ban/jail.local` を作成し、以下を追記：

        [sshd]
        enabled = true
        maxretry = 5
        bantime = 600

   - 有効化：`sudo systemctl enable --now fail2ban`
   - 状態確認：`sudo fail2ban-client status sshd`

5. **ロールバック手順**
   - UFW を一時停止：`sudo ufw disable`
   - SSH を元に戻す場合はバックアップしておいた `sshd_config` を復旧してから `sudo systemctl restart ssh`
   - fail2ban を停止：`sudo systemctl disable --now fail2ban`

> **注意**: UFW を有効化する前に必ず現地ネットワークからログイン操作を行い、想定外の遮断が発生していないか確認してください。

### 3.4 管理 API の認証と監査ログ

1. **API トークンの設定**
   - 環境変数 `API_AUTH_TOKEN` を設定してから Flask アプリを起動する（systemd ユニットの場合は `Environment=API_AUTH_TOKEN=<token>` を追記）。
   - 一時的に入力を省略したい場合は、以下の手順で `API_TOKEN_ENFORCE=0` を設定するとダイアログが表示されません。
     1. `sudo systemctl edit toolmgmt.service` を実行し、ドロップインファイルに `[Service]` と `Environment=API_TOKEN_ENFORCE=0` を追記して保存。
     2. `sudo systemctl daemon-reload`
     3. `sudo systemctl restart toolmgmt.service`
     4. 元に戻すときはこの記述を削除（または `API_TOKEN_ENFORCE=1` に変更）し、同様に reload / restart を行う。
   - UI で操作を行う際は、強制が有効な場合にトークンダイアログが表示され、`sessionStorage` に保存される。
   - 401 が返った場合はトークンが無効化されるため、ダイアログで再入力する。

2. **ヘッダ仕様**
   - 既定では `X-API-Token` ヘッダを使用。必要なら `API_TOKEN_HEADER` で名称を変更可能。
   - `API_AUTH_TOKEN` が未設定の場合は従来どおりトークン無しで利用できる（開発用途）。

3. **監査ログ**
   - ログファイル：`logs/api_actions.log`（`API_AUDIT_LOG` で上書き可能）。
   - 記録内容：action / status（success,error,denied）/ remote_addr / 詳細。
   - ローテーション推奨：`logrotate` を追加し、90 日程度を目安に保管。

4. **対象エンドポイント**
   - USB 同期、貸出管理（手動返却・削除）、手動スキャン、ユーザー／工具登録、マスタ編集、状態制御（start/stop/reset）、安全シャットダウン。
   - GET の参照系（例：`/api/loans`）は現状トークン無しで閲覧可。必要に応じて `require_api_token` を追加する。

5. **運用メモ**
   - ログに 401 が連続する場合は不正アクセスまたはトークン入力ミスの可能性があるため、`fail2ban` の結果と併せて確認する。
   - トークンを変更したい場合は、`systemctl restart toolmgmt.service` 後にブラウザの `sessionStorage` をクリアする。

### 3.5 ログローテーション（toolmgmt/document-viewer）

1. 初回セットアップ：

        cd ~/tool-management-system02
        ./scripts/install_logrotate_toolmgmt.sh

   - `/etc/logrotate.d/toolmgmt` が作成され、`usbsync.log` / `api_actions.log` / `import.log` が 14 日保持で圧縮される。
2. 反映確認：`sudo logrotate --debug /etc/logrotate.d/toolmgmt | head -n 20`
3. ルール追加後は `sudo systemctl status cron`（または `anacron`）を確認し、デフォルトの logrotate が有効であることを確認する。
4. ローテーション後のログは `/var/log/toolmgmt/*.log.*.gz` へ保存されるため、保管ポリシーに従って外部媒体へコピーする。

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

### 4.3 バックアップ点検（週次推奨）

1. 最新バックアップの健全性チェック：

        cd ~/tool-management-system02
        ./scripts/check_backup_status.sh            # 24時間以内を確認

   - しきい値を変更したい場合は `./scripts/check_backup_status.sh 48` のように時間を指定。
   - 結果に `WARNING` や `ERROR` が出た場合は、バックアップパスを再確認し、`journalctl -u backup_db.service -n 20` で失敗原因を追う。

2. `systemctl status backup_db.timer` でタイマーが `active (running)` か確認。
3. `backups/` ディレクトリを週次で外部媒体にコピーする（USB 等）。
4. 点検結果は運用ノート（例：Google Sheets）に日付・担当者・判定を記録する。

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
- **このRaspberry Pi 上のブラウザ（キオスク含む）**からのみ実行可能（127.0.0.1/::1 および Pi 自身の NIC アドレスを自動判定）。  
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
  - 許可: Pi 自身のIPからのみ（`127.0.0.1`/`::1`/NICのローカルIPを自動発見）。もしくは `SHUTDOWN_TOKEN` によるトークン一致時に許可。  
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

> **運用メモ**: LAN 側の IP で画面を開いた場合は `forbidden` が返る仕様。Pi 本体で `http://127.0.0.1:8501` を開く運用が基本となります。

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

- RealVNC での接続（Mac 例）：

    # Mac 側で IP を確認
    ipconfig getifaddr en1

    # ラズパイ側で VNC (5900/tcp) を許可
    sudo ufw allow from <MacのIP> to any port 5900 proto tcp

    # ルールを確認
    sudo ufw status numbered

    # VNC サーバーの稼働確認
    systemctl status vncserver-x11-serviced --no-pager

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
