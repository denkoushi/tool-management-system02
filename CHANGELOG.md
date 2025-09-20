# CHANGELOG

本リポジトリ（tool-management-system02）で行った復旧・強化の履歴です。  
※ 日付は JST、内容は要点のみ。

## 2025-09-20 〜 2025-09-21

### 復旧用ベースラインの確立
- 新規リポジトリを作成し、ZIP 版の安定構成を移植（`app_flask.py` / `templates/index.html` / `static/js/socket.io.js`）。
- `.gitignore` 整備（venv / __pycache__ / *.backup* / backups/ などを除外）。
- `requirements.txt`（最小依存）：Flask / Flask-SocketIO / psycopg2-binary / pyscard。

### コンテナ基盤（Postgres / Grafana）
- `docker-compose.yml` を整備：
  - Postgres 16・Grafana latest
  - `restart: unless-stopped` で自動復帰
  - `healthcheck`（`pg_isready`）で DB 準備完了を監視
  - `TZ=Asia/Tokyo`
  - **ports を 127.0.0.1 バインド**（LAN 露出の初期無効化）

### アプリの堅牢化
- `app_flask.py`：DB 接続に **最大 30 秒のリトライ**を追加（DB 起動待ちで落ちない）。
- Flask-SocketIO による UI 更新、NFC スキャン監視、貸出/返却ロジックの動作確認。
- 起動到達性：`:8501` で 200 OK、Socket.IO で接続ログ確認。

### 自動起動（systemd）
- `setup_auto_start.sh` を刷新：
  - `After/Wants=pcscd.service docker.service`（起動順）
  - `LANG/LC_ALL/PYTHONIOENCODING/TZ`（**UTF-8 ログ + JST**）
  - `PYTHONUNBUFFERED=1`（ログの即時出力）
  - `ExecStart=venv/bin/python app_flask.py`

### バックアップとリストア
- `scripts/backup_db.sh`：`pg_dump | gzip`、保持 14 日の掃除付き。
- `scripts/install_backup_timer.sh`：`backup_db.timer`（毎日 02:30 JST）をセットアップ。
- **検証用 DB（sensordb_verify）で読み戻し検証**を実施し、テーブル・件数・連番（シーケンス）まで確認済み。

### DB チューニング
- `loans` に以下のインデックスを追加：
  - `loans_open_by_tool_idx`（`WHERE returned_at IS NULL`）
  - `loans_open_by_borrower_idx`（同上）
  - `loans_loaned_at_idx` / `loans_returned_at_idx`（降順ソート向け）
- `ANALYZE` 実施で統計更新。
- `ALTER DATABASE sensordb SET timezone='Asia/Tokyo';` を設定。

### 動作確認
- ユーザー/工具タグの登録、**ユーザー → 工具** の順での貸出、返却の双方で UI/DB が更新されることを確認。
- 再起動後の **完全自動復帰**（Docker + systemd + アプリ起動 + 到達性 200）を確認。

### 2025-09-20〜21 追記
- 再現スクリプトを追加（os_prereqs.sh / install_docker.sh / install_kiosk_autostart.sh / remove_kiosk_autostart.sh / apply_db_tuning.{sql,sh}）。
- RUNBOOK に「再現性確保（Scripts Inventory）」章を追記。

### 2025-09-21
- UI からの安全シャットダウンを実装：
  - バックエンド: `POST /api/shutdown`（ローカル許可、任意トークン対応、1秒ディレイで実行）
  - sudoers: `/sbin/shutdown -h now` のみ NOPASSWD で許可（ユーザー: tools01）
  - フロント: 右下フローティングボタン（動的挿入、z-index 最大、キオスクでも視認可能）
- RUNBOOK に運用手順を追記。

### 2025-09-21
- スキャンのタブ独立 & UI 同期を実装
  - タブ切替時に自動停止し、借用/返却タブに戻ると UI は停止状態（《開始》=有効/《停止》=無効/「● 停止中」）へ戻る
  - `scan_update` は借用/返却タブ時のみ反映（登録タブでの操作が混入しない）

### 2025-09-21
- 用語統一（UI表示）：「工具」→「アイテム」
  - 影響範囲：`templates/index.html` の日本語表記（見出し、ボタン、テーブル見出し、ガイダンス文）
  - 非影響：DBスキーマ/APIの識別子（`tool`, `tools`, `/api/tool_names` など）は従来のまま（互換性維持）
- UIスタイルのモダン化（フルHD・21インチ前提の高密度表示）
  - 色/余白/フォントサイズを見直し、テーブル行高・余白を圧縮して可視件数を増加
  - テーブルヘッダを `position: sticky` で固定（一覧の視認性向上）
  - ボタンと入力をコンパクト化（操作性を維持しつつ表示領域を拡大）
