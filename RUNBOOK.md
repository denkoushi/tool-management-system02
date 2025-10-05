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
   - UI から同期する場合は「🛠 メンテナンス」タブ内の「USB 同期を実行」ボタンを利用。内部的に上記 2 ステップを直列で実行し、結果はボタン右側のログ表示に整形して流れます。ClamAV スキャンと PDF 検証を行うため、データが少ない場合でも 1 分前後を見込んでください（ファイル数・サイズに比例して延びます）。
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
   - 既定では `/etc/toolmgmt/api_token.json` に `{ "token": "...", "station_id": "CUTTING-01", "issued_at": "..." }` 形式で保存する。
   - メンテナンス → API トークン管理 から一覧・発行・無効化が可能。発行時に表示されるトークンは必ず控えておく。
   - 確認：`python scripts/manage_api_token.py show`（`--reveal` で全表示）
   - 発行：`python scripts/manage_api_token.py issue --station-id CUTTING-01`
   - 再発行：`python scripts/manage_api_token.py rotate --station-id CUTTING-01`
   - 無効化：`python scripts/manage_api_token.py revoke --token <値>` または `--station-id`, `--all`, `--file`
   - `/etc/toolmgmt` が存在しない場合は `sudo mkdir -p /etc/toolmgmt && sudo chown tools01:tools01 /etc/toolmgmt && sudo chmod 755 /etc/toolmgmt`
   - 旧来どおり環境変数 `API_AUTH_TOKEN` を設定した場合はフォールバックとして利用される。
   - キオスクブラウザではトークンを `localStorage` に保存するため、毎朝再入力する必要はない。端末入れ替え時や漏洩懸念がある場合はブラウザのサイトデータを削除するか `localStorage.removeItem('apiToken')` を実行し、再発行・再入力する。
   - **設置の目的**:
     1. **正当な端末の識別** … トークンを保持する端末だけが API を叩けるため、同一ネットワーク内に不審な端末があっても操作できない。
     2. **ステーション単位の監査** … station_id とひも付いてログに残るので、どの工程の端末が操作したか追跡できる。
     3. **容易な無効化** … 端末の入れ替え・紛失時は `revoke` + 再発行で即座にアクセスを止められる。

     > **運用イメージ**: 物理的に管理されたキオスク端末で鍵を差したまま使うイメージです。トークンは `localStorage` に保存されるため毎朝の入力は不要ですが、鍵を抜きたいとき（端末移設・漏洩疑い）は `localStorage` を削除 → 再発行するだけでリセットできます。

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
   - トークンをすべて無効化した場合は、次のコマンドですぐに再発行できる。

        cd ~/tool-management-system02
        python3 scripts/manage_api_token.py issue --station-id CUTTING-01 --reveal

     station_id は現場に合わせて置き換え、発行後は `sudo systemctl restart toolmgmt.service` → `sudo systemctl status toolmgmt.service --no-pager` で再起動と状態確認を行う。
   - トークンを再発行した場合は、発行コマンドの出力に表示される新しいトークンを利用者に周知し、ブラウザの `localStorage`/`sessionStorage` をクリアして再入力を促す。

### 3.5 ログローテーション（toolmgmt/document-viewer）

1. 初回セットアップ：

        cd ~/tool-management-system02
        ./scripts/install_logrotate_toolmgmt.sh

   - `/etc/logrotate.d/toolmgmt` が作成され、`usbsync.log` / `api_actions.log` / `import.log` が 14 日保持で圧縮される。
2. 反映確認：`sudo logrotate --debug /etc/logrotate.d/toolmgmt | head -n 20`
3. ルール追加後は `sudo systemctl status cron`（または `anacron`）を確認し、デフォルトの logrotate が有効であることを確認する。
4. ローテーション後のログは `/var/log/toolmgmt/*.log.*.gz` へ保存されるため、保管ポリシーに従って外部媒体へコピーする。

### 3.6 生産計画／標準工数の同期（USB）

USB メモリ経由で生産計画と標準工数の CSV を配布し、左上ダッシュボードに表示する仕組みを用意しています。

1. **USB 内の配置場所（`master/` 直下）**

        production_plan.csv      # 生産計画：納期,個数,部品番号,部品名,製番,工程名
        standard_times.csv       # 標準工数：部品名,機械標準工数,製造オーダー番号,部品番号,工程名

   - サンプルデータは `docs/sample-data/` を参照。
   - 文字コードは UTF-8（BOM 可）、ヘッダー行は上記と同一であること。

2. **取り込み先**
   - USB 同期 (`scripts/usb_master_sync.sh`) 実行時に `/var/lib/toolmgmt/plan/` へコピーされる。
   - ファイル所有者は `tools01:tools01`、パーミッションは 640。

3. **検証内容**
   - 拡張子と MIME を確認し、想定外形式は WARN としてログに残しスキップ。
   - ヘッダーが一致しない場合は `usbsync.log` に WARN を出しコピーしない。

4. **表示**
   - Flask UI 左上ペインに「生産計画」と「標準工数」の 2 つのテーブルが並び、USB から取り込んだ最新データを別々に確認できる。
   - 生産計画は納期順にソートされ、標準工数テーブルは部品番号＋工程名で昇順表示。
   - 将来突合のため、両テーブルは部品番号と工程名の共通情報で参照可能。

5. **よくあるケース**
   - CSV が置かれていない：UI にメッセージを表示するだけでエラーにはならない。
   - 形式エラー：`/var/log/toolmgmt/usbsync.log` を確認し、CSV を修正して再同期。

---

### 3.7 工程設定（station.json）

1. **設定ファイルとフォーマット**
   - 既定パス: `/var/lib/toolmgmt/station.json`（`STATION_CONFIG_PATH` で変更可）
   - 例:

        {
          "process": "切削",
          "available": ["切削", "研磨"],
          "updated_at": "2025-10-05T12:34:56"
        }

   - ファイルが存在しない場合は環境変数 `STATION_PROCESS` をフォールバックとして採用し、UI 上では「未設定」表示になる。

2. **UI 操作手順（推奨）**
   - 画面「🛠 メンテナンス」タブ → 「工程設定」で候補追加・削除と現在の工程の保存が可能。
   - 保存成功時は station.json が即座に更新され、DocumentViewer の表示と生産計画ハイライトに反映される。

3. **CLI 操作手順**

        python scripts/manage_station_config.py show
        python scripts/manage_station_config.py add 切削
        python scripts/manage_station_config.py set --process 切削 --available 切削,研磨

   - `remove` サブコマンドで候補から除外できる（現在の工程を削除した場合は「未設定」へ戻る）。

4. **トラブルシュート**
   - station.json が破損している場合: CLI で `set` を実行するかファイルを削除すると再生成される。
   - UI でエラー表示が出る場合: 書き込み権限、ディスク容量、API トークンの有効性を確認。
   - 初回にディレクトリが存在しない場合:  
        sudo mkdir -p /var/lib/toolmgmt  
        sudo chown tools01:tools01 /var/lib/toolmgmt  
        sudo chmod 755 /var/lib/toolmgmt

---

### 3.8 リモート配布（任意）

- 環境変数 `PLAN_REMOTE_BASE_URL` を設定すると、`/var/lib/toolmgmt/plan/` を自動更新する。例: `https://example.com/toolmgmt/plan` 配下に `production_plan.csv`, `standard_times.csv` を配置。
- 600 秒ごと（`PLAN_REMOTE_REFRESH_SECONDS`）に更新を確認。`PLAN_REMOTE_TOKEN` を設定すると Bearer トークンとして送信する。
- `file://` スキームも利用可能（例: `PLAN_REMOTE_BASE_URL=file:///mnt/share`）。
- 取得に失敗した場合はログに `[plan-cache]` が出力され、ローカルの前回データをそのまま使う。

---

### 3.9 テスト（pytest）

- 単体テスト / スモークテスト: `make test`（内部で `python -m pytest` を実行）
- **実行手順**（仮想環境上で実施）

        python3 -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt -r requirements-dev.txt
        pytest -q

- リモート配布を模擬する場合: `PLAN_REMOTE_BASE_URL=file:///path/to/sample make test`
- CI 導入時は `make test-smoke` をジョブに登録し、将来的には実機スモークテストを追加する。


### 3.10 トラブルシュート（抜粋）

- **工程設定が保存できない (`Permission denied: /var/lib/toolmgmt/station.json`)**
  - `sudo mkdir -p /var/lib/toolmgmt && sudo chown tools01:tools01 /var/lib/toolmgmt && sudo chmod 755 /var/lib/toolmgmt`
- **左上ペインがハイライトしない**
  - DocumentViewer が `{type:'dv-barcode', part, order}` を postMessage しているか確認。ブラウザの Console にエラーがないか確認する。
- **API トークンが無効（401）になる**
  - ブラウザのサイトデータ（`localStorage`/`sessionStorage`）を削除し、`python3 scripts/manage_api_token.py rotate --station-id <既存ID>` で再発行したトークンを再入力。
- **リモート配布が更新されない**
  - `journalctl -u toolmgmt.service --since now-5m | grep plan-cache` などでログを確認し、環境変数やネットワーク障害を点検。

### 決定記録 (Decision Log)

1. **DocumentViewer 工程設定の保持方法**  
   - **方針**: 各ラズパイに工程設定ファイル（例: `/var/lib/toolmgmt/station.json`）を配置し、管理 UI からユーザーが工程を選択して保存できるようにする。Flask / DocumentViewer はこのファイルを優先的に読み取り、環境変数 `STATION_PROCESS` は初期値のフォールバックとして残す。設定ファイルは JSON 形式で `{"process": "研磨", "updated_at": "...", "available": ["切削", "研磨"]}` のように工程候補リストも保持し、UI から追加・削除できる。  
   - **理由**: 工程切替を UI 操作のみで完結させ、再起動後も設定を保持するため。systemd 設定の書き換えや sudo 権限をユーザーに求めず、安全に運用できる。  
   - **TODO**: 設定編集 API・管理 UI の追加（工程リストの CRUD 含む）、設定ファイル初期化スクリプトの整備、DocumentViewer 側で新設定を読み込む処理。設定変更時は JSON 更新→即時通知で反映し、サービス再起動後も同じファイルを読み込む。Runbook/README の手順更新。設定ファイルが欠損・破損した場合は、UI 上で「工程未設定」を表示して再設定を促す。DocumentViewer は同じ JSON を直接読み込み、定期的に更新を検知する。

2. **バーコード連携（部品番号／製造オーダー）**  
   - **決定済み要素**: 移動票のバーコードは「部品番号 → 製造オーダー番号」の順にスキャンする。部品番号だけでも DocumentViewer は工程設定で該当手順書を開き、TMS 左上ダッシュボードでは該当候補を一覧表示する。続けて製造オーダー番号を読み取ると候補を 1 件に確定しハイライトする。  
   - **イベント連携**: DocumentViewer (iframe) から `postMessage` で `{type: "dv-barcode", part, order}` を送信し、TMS 側 `message` リスナーで受信してハイライト処理を行う。将来 iframe 以外に対応する場合は Socket.IO / REST API への拡張を検討。
   - **UI 方針**: 生産計画テーブルで部品番号一致の行をハイライトし、上部に候補件数とオーダー番号入力案内を表示。未確定の場合は行末に「オーダー未確定」バッジを出す。バーコードが読めない場合は候補行をタップして暫定確定でき、後から再スキャンで上書きできる。


---

3. **データ配布（USB → サーバー／クラウド移行）**  
   - **方針**: 当面は USB 同期を維持しつつ、将来的に API 経由で計画データを取得できるハイブリッド構成へ移行する。具体的には、Flask 起動時に API から最新 CSV を取得し `/var/lib/toolmgmt/plan` にキャッシュ、ネットワーク障害時は最後に取得したローカルファイルを使用する。USB は手動バックアップ/緊急手段として残す。  
   - **TODO**: API エンドポイント設計、キャッシュ更新ロジック、失敗時のフォールバックメッセージ、認証/監査の見直し。移行フェーズでの運用手順（USB vs API）を README/RUNBOOK に追記。

---

4. **API トークン運用（ステーション単位）**  
   - **方針**: 各ラズパイ/ステーションごとに API トークンを個別発行し、`/etc/toolmgmt/api_token.json` に保存して認証する。初期段階では CLI ツールで発行・失効を行い、将来的に管理 UI からも発行できるようにする。  
   - **運用**: `scripts/manage_api_token.py issue --station-id CUTTING-01` で発行し、出力されたトークンを利用者に共有。`show` で現在値確認、`revoke` で削除。監査ログ（`logs/api_actions.log`）には station_id が記録される。  
   - **TODO**: トークン管理スクリプトの高度化（複数トークン対応や履歴管理）、初期セットアップ手順への組み込み、GUI 連携を見据えた API 設計。

---

5. **運用ドキュメント整備**  
   - **優先順**: ① 新規ラズパイ構築フロー（OS 書き込み→リポジトリ取得→工程設定→トークン適用→動作確認）を README/RUNBOOK に詳述 ② トラブルシュート集（USB 同期・バーコード・トークン失効など） ③ 管理 UI や候補表示の操作説明 ④ Decision Log の要約版。  
   - **TODO**: 初期構築ガイドを書き起こし、必要な CLI コマンドと設定ファイル例を追記。代表的な障害対応手順を整理し、スクリーンショットや図は UI 安定後に追加する。Decision Log 更新と内容の相互参照を維持する。

---

6. **テスト戦略**  
   - **方針**: ラズパイ上でのスモークテストを整備し、USB 同期・工程設定・バーコード絞り込みがひと通り動くことを `make test-smoke` 等で確認できるようにする。同時に主要スクリプトや Python 関数は pytest で単体テストを用意する。  
   - **TODO**: テストデータセットと USB モックを用意し、ラズパイ向け pytest スイート／シェルテストを追加。GitHub Actions 等の CI にも一部テスト（lint, unit）を組み込み、チェックリストを README/RUNBOOK に追記する。

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
