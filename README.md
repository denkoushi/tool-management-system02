# tool-management-system02 (Raspberry Pi 5 / ZIP Restore Baseline)

このリポジトリは、Raspberry Pi 5 上で実運用していた **ZIP 版の安定構成**をそのまま保存する復旧用ベースラインです。  
当面の起動は **python app_flask.py** を前提とします（ポート既定: **8501**）。

---

## 1) 依存関係

Raspberry Pi 側で下記を実行します（PC/SC 読み取りと Python 仮想環境）。

    sudo apt update
    sudo apt install -y pcscd libpcsclite1 libpcsclite-dev libccid
    # あると便利（任意・動作確認用）
    sudo apt install -y pcsc-tools

    python3 -m venv venv
    source venv/bin/activate
    pip install -U pip
    pip install -r requirements.txt

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
NFC スキャン（ユーザー → 工具）が完了すると、貸出/返却が自動判定され、Socket.IO で画面に反映されます。

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

## 6) よくあるトラブルと対処

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
    # サービス起動時のログを確認（下記 7) 参照）

**DB 接続エラー**
    
    # docker compose ps で postgres が起動しているか確認
    # .env 等で接続先を変えていないか確認（標準は localhost:5432 / app / app / sensordb）

---

## 7) ログ確認（systemd / 前面起動）

**systemd サービス運用時のログ**
    
    journalctl -u toolmgmt.service -f -n 200

**前面実行時のログ**
    
    source venv/bin/activate
    python app_flask.py

---

## 8) 方針

- まずは **ZIP 版そのままの挙動を安定運用**（`python app_flask.py`）。  
- 既存の別リポジトリにあるドキュメント整備や構造化（`app/` パッケージ化）は、**動作を壊さない範囲で段階的に取り込み**ます。

