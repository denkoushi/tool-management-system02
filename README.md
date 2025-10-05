# tool-management-system02 (Raspberry Pi 5 / ZIP Restore Baseline)

このリポジトリは、Raspberry Pi 5 上で実運用していた **ZIP 版の安定構成**をそのまま保存する復旧用ベースラインです。  
当面の起動は **python app_flask.py** を前提とします（ポート既定: **8501**）。

> ドキュメント全体の役割分担と更新ルールは `docs/documentation-guidelines.md` にまとめています。新しい情報を追加するときは確認してください。

---

## 1) 依存関係（セットアップ手順）

1. **APT パッケージの更新と基本ツール**

        sudo apt update && sudo apt upgrade -y
        sudo apt install -y git curl python3-venv python3-dev build-essential swig pkg-config
        sudo apt install -y pcscd pcsc-tools libpcsclite1 libpcsclite-dev libccid

2. **Docker（compose を含む）**

   Raspberry Pi OS のリポジトリでは `docker-compose-plugin` が利用できない場合があるため、公式スクリプトでインストールします。

        cd ~
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker $USER

   実行後は一度ログアウトし再ログインするか `newgrp docker` でグループ反映、続いてバージョン確認を行います。

        docker --version
        docker compose version

3. **リポジトリと Python 仮想環境**

        cd ~
        git clone https://github.com/denkoushi/tool-management-system02.git
        cd tool-management-system02
        python3 -m venv venv
        source venv/bin/activate
        pip install -U pip
        pip install -r requirements.txt

4. **コンテナ起動（PostgreSQL/Grafana）**

        newgrp docker  # またはログアウト→ログイン後に実行
        docker compose pull
        docker compose up -d
        docker compose ps

   `pg` コンテナが `Up` になれば準備完了です。起動しない場合は `sudo systemctl status docker` や `docker logs pg` で原因を確認してください。

5. **アプリの疎通確認**

        source venv/bin/activate  # 新しいターミナルを開いた場合
        python app_flask.py

   ブラウザで `http://<RaspberryPiのIP>:8501` にアクセスし画面表示を確認します。`Ctrl+C` で停止後、必要に応じて `setup_auto_start.sh` で systemd 化します。

    > **Note**: 安全シャットダウンボタンは Raspberry Pi 本体上で `http://127.0.0.1:8501`（または `http://localhost:8501`）にアクセスしたときのみ動作します。LAN 側の IP から呼び出すと `forbidden` になります。どうしても遠隔から操作する場合は、環境変数 `SHUTDOWN_TOKEN` を設定し、トークンで認証してください。

6. **工程設定（station.json）**

   画面左の「🛠 メンテナンス」タブに「工程設定」カードが追加されています。工程候補を追加し、現在の工程を選択して保存すると `/var/lib/toolmgmt/station.json` に設定が反映され、DocumentViewer や生産計画ビューが対象工程で動作するようになります。初回は候補が空なので、実際の工程名（例: `切削`, `研磨` 等）を追加してから保存してください。

   CLI から設定したい場合は次のスクリプトを利用できます。

        python scripts/manage_station_config.py show
        python scripts/manage_station_config.py add 切削
        python scripts/manage_station_config.py set --process 切削

   JSON の保存先は `STATION_CONFIG_PATH` 環境変数でも上書き可能です。

   > 初回のみ: `/var/lib/toolmgmt/` が存在しない場合は次を実行して権限を与えてください。

        sudo mkdir -p /var/lib/toolmgmt
        sudo chown tools01:tools01 /var/lib/toolmgmt
        sudo chmod 755 /var/lib/toolmgmt

7. **管理 API トークンの発行**

   管理 API にアクセスするときは `X-API-Token` ヘッダでトークンを付与する必要があります。既定では `/etc/toolmgmt/api_token.json` を参照します。

   一覧表示（マスク表示。`--reveal` で全表示）:

        python scripts/manage_api_token.py show

   トークン発行（既存を無効化して新規発行。`--keep-existing` で並存させる）:

        python scripts/manage_api_token.py issue --station-id CUTTING-01

   トークン再発行（station_id を省略すると既存の station_id を引き継ぎ）:

        python scripts/manage_api_token.py rotate --station-id CUTTING-01

   トークンの無効化:

        python scripts/manage_api_token.py revoke --token <発行したトークン文字列>
        python scripts/manage_api_token.py revoke --station-id CUTTING-01
        python scripts/manage_api_token.py revoke --all   # すべて無効化
        python scripts/manage_api_token.py revoke --file  # ファイルごと削除

   初回は `/etc/toolmgmt` が存在しない場合があるため、次のコマンドでディレクトリを作成し書き込み権限を与えてください。

        sudo mkdir -p /etc/toolmgmt
        sudo chown tools01:tools01 /etc/toolmgmt
        sudo chmod 755 /etc/toolmgmt

   ブラウザの管理画面にアクセスすると、初回のみトークン入力を求められます。入力した値はキオスクブラウザの `localStorage` に保存されるため、通常は再起動後も再入力は不要です。保存済みトークンを入れ替えたい場合はブラウザのサイトデータを削除するか、開発者ツールから `localStorage.removeItem('apiToken')` を実行してください。
   トークンは「この端末が正規か」を識別する鍵で、ステーション単位で発行しておくと監査ログに station_id が残ります。端末を入れ替える際は `revoke` → 再発行 → 新しいトークンを入力するだけでアクセスを切り替えられます。すべてのトークンを無効化した場合は下記コマンドで再発行してください。

        cd ~/tool-management-system02
        python3 scripts/manage_api_token.py issue --station-id CUTTING-01 --reveal

   station_id は任意の識別子に置き換えてください。発行後は `sudo systemctl restart toolmgmt.service` で再起動し、画面で新しいトークンを入力します。

8. **psql クライアント（USB 同期で利用）**

        sudo apt install -y postgresql-client

9. **USB 同期（手動ボタン）**

    画面上の「🛠 メンテナンス」タブにある `USB 同期を実行` は、工具マスタとドキュメントビューア PDF を **一括** で処理します。ラベル `TOOLMASTER` の USB メモリを挿した状態で押すと、

    1. `scripts/usb_master_sync.sh` が `master/` 配下の CSV を双方向同期
    2. `../DocumentViewer/scripts/usb-import.sh` が `docviewer/` 配下の PDF を取り込み（`docviewer.service` が稼働している前提）

    の順に実行します。処理中は画面がロックされるので USB を抜かず完了メッセージを待ってください。実行結果はボタン右横のログ領域と `journalctl -u tool-master-sync@*` / `/var/log/document-viewer/import.log` で確認できます。ClamAV スキャンや PDF 検証を含むため、空に近い状態でも 1 分前後かかる点に留意してください（ファイル数が多いほど時間が延びます）。

    > 実行権限: UI からの同期では内部で `sudo bash .../scripts/usb_master_sync.sh` を呼び出します。パスワード入力を求められないよう、運用ユーザーに sudoers エントリを追加してください。

        sudo tee /etc/sudoers.d/toolmgmt-usbsync >/dev/null <<'SUDO'
        tools01 ALL=(root) NOPASSWD: /bin/bash /home/tools01/tool-management-system02/scripts/usb_master_sync.sh
        tools01 ALL=(root) NOPASSWD: /bin/bash /home/tools01/DocumentViewer/scripts/usb-import.sh
        SUDO
        sudo visudo -cf /etc/sudoers.d/toolmgmt-usbsync

10. **リモート配布（任意）**

    USB の代わりにサーバー上の CSV を取得したい場合は、環境変数 `PLAN_REMOTE_BASE_URL` を設定してください。例：`https://example.com/toolmgmt/plan` に `production_plan.csv` / `standard_times.csv` を配置しておくと、アプリ起動時にダウンロードされ `/var/lib/toolmgmt/plan/` が上書きされます。既定では 600 秒ごとに更新確認を行い（`PLAN_REMOTE_REFRESH_SECONDS` で調整）、失敗した場合はローカルの最終データを使います。

    - 認証が必要な場合は `PLAN_REMOTE_TOKEN` に Bearer トークンを指定。
    - LAN 上の共有を参照したい場合は `PLAN_REMOTE_BASE_URL=file:///path/to/share` 形式で `file://` を指定。
    - 取得状況は標準出力に `[plan-cache] ...` として記録されます。

11. **テスト（pytest）**

        make test

    `PLAN_REMOTE_BASE_URL` などの環境変数を与えたい場合は `PLAN_REMOTE_BASE_URL=... make test` のように実行します。簡易動作確認であれば `make test-smoke` を利用してください（現状 `make test` と同じです）。

    仮想環境上で次を実行してください（Pi ではシステム Python への `pip install` が禁止されているため）。

        python3 -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt -r requirements-dev.txt
        pytest -q

    ※ `make test` でも同じ処理を行います。

12. **UI 操作ガイド（抜粋）**

    - メンテナンス → 工程設定: 工程候補の追加・削除、現在の工程を保存（station.json 更新）――保存すると DocumentViewer 側も即座に更新されます
    - 左上ペイン: DocumentViewer で部品番号をスキャンすると、生産計画・標準工数の両表がハイライト表示
    - バーコードが見つからない場合はピンクのメッセージが表示されるので、CSV 更新状況を確認

13. **DocumentViewer 常駐化 + ブラウザのキオスク自動起動**

        sudo bash setup_auto_start.sh                        # toolmgmt.service を設定
        sudo ~/DocumentViewer/scripts/install_docviewer_service.sh  # docviewer.service を設定
        bash scripts/install_kiosk_autostart.sh               # Chromium オートスタート設定（sudo 不要）
        sudo raspi-config  # System Options → Boot / Auto Login → Desktop Autologin

    上記後に再起動すると、GUI ログイン直後に Chromium が `http://127.0.0.1:8501` をキオスクモードで開きます。設定ファイルは `~/.config/autostart/chromium-kiosk.desktop` に作成されます。必要に応じて `sudo systemctl restart toolmgmt.service` でアプリを再起動してください。

requirements.txt（最小構成）:
- Flask==2.3.3
- Flask-SocketIO==5.3.6
- psycopg2-binary==2.9.9
- pyscard==2.0.7

---

## 2) DB / Grafana（任意）

docker が使える場合は、下記で PostgreSQL / Grafana を起動できます。

    docker compose up -d
    # PostgreSQL: localhost:5432  (user: app / pass: app / db: sensordb)
    # Grafana:   http://localhost:3000

---

## 3) アプリ起動

まずは前面起動で動作確認します。別端末のブラウザから http://<RaspberryPiのIP>:8501 にアクセスします。

    source venv/bin/activate
    python app_flask.py

UI は `templates/index.html`、静的ファイルは `static/` 配下から提供されます。  
画面は **左半分に操作エリア**、右半分は将来拡張用に空けた 2 カラム構成です。  
借用/返却タブでは、従来の「ユーザー → 工具の順にスキャン」に加えて、以下の補助操作を利用できます。

- **手動返却**: 貸出中リストの各行に表示。スキャンできない場合でも返却済みにできます（履歴へ移動し、名前も保持）。
- **削除**: 誤登録などで貸出記録を破棄したいときに使用。貸出リストからのみ削除され、タグIDとアイテム名の紐づけは維持されます。

---

## 4) 自動起動（任意 / systemd）

テンプレートスクリプトを用意しています。サービス名はデフォルトで `toolmgmt` です。

    sudo bash setup_auto_start.sh
    # 状態確認
    systemctl --no-pager --full status toolmgmt.service
    # 停止/再起動
    sudo systemctl stop toolmgmt.service
    sudo systemctl restart toolmgmt.service

※ スクリプトは venv が無ければ自動作成し、`ExecStart` は `venv/bin/python app_flask.py` を指します。  
※ `pcscd.service` が有効であることが前提です。

---

## 5) ディレクトリ構成（最小）

    .
    ├─ app_flask.py
    ├─ templates/
    │   └─ index.html
    ├─ static/
    │   └─ js/
    │       └─ socket.io.js
    ├─ docker-compose.yml
    ├─ requirements.txt
    ├─ setup_auto_start.sh
    ├─ .gitignore
    └─ README.md

コミットしないもの：
- `venv/`、`__pycache__/`、`*.backup*`、動作に無関係な zip 等（`.gitignore` 済み）

---

## 6) USB マスターデータ同期

複数拠点で同じマスターデータと PDF を使い回すため、USB メモリ（ラベル: `TOOLMASTER`）を挿すだけで同期できる仕組みを用意しています。USB を準備するとき、空にする必要はありませんが、`master/` と `docviewer/` は以下の用途で管理してください。

    ```
    TOOLMASTER/
    ├── master/      # tool-management-system02 用 CSV
    │   ├── tool_master.csv
    │   ├── tools.csv
    │   └── users.csv
    ├── docviewer/   # DocumentViewer 用 PDF
    │   ├── meta.json         # {"updated_at": <UNIX 時刻>}
    │   └── *.pdf
    └── meta.json    # 工具マスタ同期の最終更新時刻
    ```

1. **初期セットアップ**
   1. USB メモリを ext4 等でフォーマットし、ラベルを `TOOLMASTER` に設定します。例: `sudo e2label /dev/sdX1 TOOLMASTER`
   2. Pi 上で `sudo bash scripts/install_usb_master_sync.sh` を実行し、`/usr/local/bin/tool_master_sync.sh` と udev/systemd 連携を導入します。
2. **通常運用**
   1. USB を挿すと自動で `/media/tool-master/` にマウントされます。
   2. `master/` と `docviewer/` の `meta.json`（およびファイル更新日時）を比較し、USB 側が新しければ **Pi に取り込み**。
   3. 取り込み後は Pi 側の最新マスターデータを CSV に **書き戻してアンマウント**（安全に取り外せる状態）します。
   4. ログは `journalctl -u tool-master-sync@*` で確認できます。失敗時は CSV の列順・ヘッダー・文字コード（UTF-8）を点検してください。
3. **大量登録 / 手作業更新**
   - `master/tool_master.csv`（工具名マスタ）、`master/users.csv`（UID と氏名）、`master/tools.csv`（工具タグと工具名の紐づけ）を任意の PC で編集 → 上書き保存 → Pi に挿すだけで反映されます。
   - `master/meta.json` と `docviewer/meta.json` はスクリプトが自動生成します。手動編集した場合も削除せずそのまま残してください。
   - 編集後は USB を Pi へ挿す前に確実に保存・安全な取り外しを行ってください。

> **補足**: 既存の CSV が無い状態で挿しても、Pi 側の最新マスターデータが自動で書き出されます。別の Pi へ持ち込むときは何もせず挿すだけでマスターデータが取り込まれます。

---

## 7) よくあるトラブルと対処

**PC/SC デーモンが起動していない**
    
    sudo systemctl enable --now pcscd
    sudo systemctl status pcscd

**カードリーダーが認識されない（CCID ドライバ）**
    
    # CCID ドライバは libccid に含まれます
    sudo apt install -y libccid
    # 必要に応じて再起動
    sudo systemctl restart pcscd

**NFC は読むが画面が更新されない（Socket.IO）**
    
    # ブラウザから http://<PiのIP>:8501 を開き直す
    # 同一LAN内でファイアウォール/ポートブロックが無いか確認
    # サービス起動時のログを確認（下記 8) 参照）

**DB 接続エラー**
    
    # docker compose ps で postgres が起動しているか確認
    # .env 等で接続先を変えていないか確認（標準は localhost:5432 / app / app / sensordb）

---

## 8) ログ確認（systemd / 前面起動）

**systemd サービス運用時のログ**
    
    journalctl -u toolmgmt.service -f -n 200

**前面実行時のログ**
    
    source venv/bin/activate
    python app_flask.py

---

## 9) 方針

- まずは **ZIP 版そのままの挙動を安定運用**（`python app_flask.py`）。  
- 既存の別リポジトリにあるドキュメント整備や構造化（`app/` パッケージ化）は、**動作を壊さない範囲で段階的に取り込み**ます。

### 用語について
- 本システムの UI は「工具」を **「アイテム」** と表記します。
- 互換性維持のため、コードやAPIの識別子（例: `tool`, `tools`）はそのままです。
