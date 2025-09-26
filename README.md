# tool-management-system02 (Raspberry Pi 5 / ZIP Restore Baseline)

このリポジトリは、Raspberry Pi 5 上で実運用していた **ZIP 版の安定構成**をそのまま保存する復旧用ベースラインです。  
当面の起動は **python app_flask.py** を前提とします（ポート既定: **8501**）。

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

6. **psql クライアント（USB 同期で利用）**

        sudo apt install -y postgresql-client

7. **USB 同期（手動ボタン）**

    画面上の「🛠 メンテナンス」タブに USB 同期ボタンがあります。ラベル `TOOLMASTER` の USB メモリを挿した状態で押すと、`scripts/usb_master_sync.sh` を経由してマスターデータを同期します。ログは画面内の `USB 同期を実行` セクションと、`journalctl -u tool-master-sync@*` で確認できます。

    > 実行権限: UI からの同期では内部で `sudo bash .../scripts/usb_master_sync.sh` を呼び出します。パスワード入力を求められないよう、運用ユーザーに sudoers エントリを追加してください。

        sudo tee /etc/sudoers.d/toolmgmt-usbsync >/dev/null <<'SUDO'
        tools01 ALL=(root) NOPASSWD: /bin/bash /home/tools01/tool-management-system02/scripts/usb_master_sync.sh
        SUDO
        sudo visudo -cf /etc/sudoers.d/toolmgmt-usbsync

8. **ブラウザのキオスク自動起動（任意）**

        sudo bash setup_auto_start.sh                # Flask アプリを systemd 管理に
        bash scripts/install_kiosk_autostart.sh       # Chromium オートスタート設定（sudo 不要）
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

複数拠点で同じマスターデータを使い回すため、USB メモリ（ラベル: `TOOLMASTER`）を挿すだけで CSV を同期できる仕組みを用意しています。USB を準備するとき、空にする必要はありませんが、`master/` ディレクトリ配下はマスターデータ専用にしてください。

1. **初期セットアップ**
   1. USB メモリを ext4 等でフォーマットし、ラベルを `TOOLMASTER` に設定します。例: `sudo e2label /dev/sdX1 TOOLMASTER`
   2. Pi 上で `sudo bash scripts/install_usb_master_sync.sh` を実行し、`/usr/local/bin/tool_master_sync.sh` と udev/systemd 連携を導入します。
2. **通常運用**
   1. USB を挿すと自動で `/media/tool-master/` にマウントされます。
   2. `master/tool_master.csv` / `master/users.csv` / `master/tools.csv` が存在し、USB 側の更新が Pi 側より新しければ **Pi に取り込み**。
   3. 取り込み後は Pi 側の最新マスターデータを CSV に **書き戻してアンマウント**（安全に取り外せる状態）します。
   4. ログは `journalctl -u tool-master-sync@*` で確認できます。失敗時は CSV の列順・ヘッダー・文字コード（UTF-8）を点検してください。
3. **大量登録 / 手作業更新**
   - `master/tool_master.csv`（工具名マスタ）、`master/users.csv`（UID と氏名）、`master/tools.csv`（工具タグと工具名の紐づけ）を任意の PC で編集 → 上書き保存 → Pi に挿すだけで反映されます。
   - USB 内には `meta.json`（最終更新時刻）が自動で生成されます。手動編集時は触らず、そのまま残してください。
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
