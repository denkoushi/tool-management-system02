# CHANGELOG

## 2025-11-02

- Socket.IO ステータス制御を状態マシン化し、右ペインのウォッチドッグ専用 DOM 操作を統合 (`static/js/rightPanel/socketStatusManager.js`, `static/js/rightPanel/initRightPanel.js`)。`SOCKET_STATUS_WATCHDOG` で抑制可能なまま、Vitest に状態管理テストを追加。
- `static/js/rightPanel/socketWatchdog.js` を削除し、所在／物流／DocViewer のパネルテストを更新。`static/js/rightPanel/socketStatusManager.test.js` を追加。
- 要件・運用ドキュメントを状態マシン表現へ更新し、`docs/requirements.md` を ✅ へ反映。
- 構内物流タブに日本語ステータスバッジと依頼時刻列を追加し、`logisticsPanel` のテーブル表示・テスト・プレビューを更新。
- DocumentViewer の `dv-barcode` 通知で所在一覧をハイライトできるよう `partLocationsPanel.highlightOrder` を追加し、ページ連携を更新。

## 2025-11-01

- 右ペインの Socket.IO ステータスにウォッチドッグを追加し、Pi5 停止中も「再接続中…」表示を維持するよう改善。Pi4 実機で停止→再開を確認。
- `scripts/install_window_a_env.sh` をデフォルトで systemd ドロップインを展開する仕様に変更し、`config/systemd/toolmgmt.service.d/window-a.conf.sample` へ `SOCKET_STATUS_WATCHDOG` / `TOOLMGMT_CLIENT_ROLE` を追加。README / RUNBOOK / docs/right-pane-plan を更新。
- `docs/requirements.md` / `docs/test-notes/2025-10-31-right-panel-layout.md` / `docs/docs-index.md` をウォッチドッグ適用後の内容へ更新。
- 再接続時に `ERR_CONNECTION_REFUSED` がコンソールへ出力される挙動を想定内として整理し、次段の恒久対策（状態マシン化）を要件に残した。

## 2025-10-31

- 右ペインのレイアウト崩れを修正し、CSS を `templates/layout/base.html` に統合。Pi4 実機でタブ表示を確認。
- Socket.IO ステータスチップ（所在一覧／物流）に再接続・エラー表示を追加し、`docs/requirements.md` に進捗を反映。
- `docs/test-notes/2025-10-31-right-panel-layout.md` を追加し、実機検証ログを記録。

本リポジトリ（tool-management-system02）で行った復旧・強化の履歴です。  
※ 日付は JST、内容は要点のみ。

## 2025-10-27

### RaspberryPiServer 連携の開始
- Window A から RaspberryPiServer REST API への取得処理を実装。`RaspiServerClient` を新規追加し、`build_production_view()` / `fetch_part_locations()` / `station_config` が `/api/v1/...` を参照するよう切り替え（フォールバックは従来どおり維持）。
- 工程設定 UI からの保存時に RaspberryPiServer へ POST し、ローカル `station.json` はバックアップ用途に限定。
- pytest に REST 成功／失敗のモックテストを追加し、station 設定のリモート・フォールバックのカバレッジを拡張。
- README / RUNBOOK / docs/requirements.md / docs/data-source-migration.md を更新し、`RASPI_SERVER_BASE` 系の環境変数・運用手順を追記。`requirements.txt` に `requests` を追加。

## 2025-10-27 (Window A REST 固定化)

- Window A を RaspberryPiServer REST 前提に更新。ローカル CSV/DB のフォールバックや plan_cache モジュールを廃止し、`RASPI_SERVER_BASE` 未設定時は警告表示のみとした。
- `raspi_client.py` を新設し、plan/part-locations/station-config 取得を統一。`plan_cache.py` と関連テストを削除。
- README / RUNBOOK / docs を更新し、`PLAN_REMOTE_BASE_URL` 等の旧設定を撤去。pytest スイートをリモート専用の動作に合わせて更新。
- Window A から RaspberryPiServer REST API への取得処理を実装。`RaspiServerClient` を新規追加し、`build_production_view()` / `fetch_part_locations()` / `station_config` が `/api/v1/...` を参照するよう切り替え（フォールバックは従来どおり維持）。
- 工程設定 UI からの保存時に RaspberryPiServer へ POST し、ローカル `station.json` はバックアップ用途に限定。
- pytest に REST 成功／失敗のモックテストを追加し、station 設定のリモート・フォールバックのカバレッジを拡張。
- README / RUNBOOK / docs/requirements.md / docs/data-source-migration.md を更新し、`RASPI_SERVER_BASE` 系の環境変数・運用手順を追記。`requirements.txt` に `requests` を追加。

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

### 2025-09-21
- レイアウトを左右 2 カラム化し、左半分に操作エリアを集約（右半分は将来拡張用に空けておく構造）。
- 貸出中テーブルに下記の操作ボタンを追加：
  - **手動返却**: スキャンできない場合も返却済みにでき、履歴へ移動。
  - **削除**: 貸出記録のみを破棄し、タグIDとアイテム名の紐づけは維持。
- バックエンド API を拡張：`POST /api/loans/<id>/manual_return` と `DELETE /api/loans/<id>` を追加し、Socket.IO 通知を既存フローと共通化。
- USB メモリ挿入でマスターデータ（tool_master/users/tools）を自動取り込み・書き戻しするスクリプトを追加。ラベル `TOOLMASTER` の USB を挿すだけで同期が完了。
- README / RUNBOOK に Raspberry Pi 初期セットアップの具体的な手順（Docker 公式スクリプト、`docker compose up -d` など）を追記し、再構築時の手順を明確化。

## 2025-10-19

- OnSiteLogistics（ハンディリーダ）からの所在データ受信を `feature/scan-intake` へ統合し、`POST /api/v1/scans` → `part_locations` upsert → `Socket.IO` 配信まで検証。
- README に連携サマリーを追加し、ブランチ更新・UFW 設定・トークン発行・DB 確認手順を記載。
- `RUNBOOK.md` 3.4 にトラブルシュートを含む詳細手順を追記。
- `docs/requirements.md` の完了セクションへ所在連携を明記し、重複していたバックログ記述を整理。

## 2025-10-31

- `docs/requirements.md` を RaspberryPiServer 集約後の Window A クライアント向けに更新。
- `docs/AGENTS.md` / `docs/documentation-guidelines.md` / `docs/docs-index.md` を棚卸し状況付きに整備し、Pi5 連携構成へ整合。
- README を Pi4 クライアント前提の内容へ刷新し、主要環境変数と Pi5 サーバー連携手順を追記。
- `docs/window-a-restore-plan.md` を追加し、復元工程と棚卸し手順を明文化。

## 2025-10-31

- 右ペインのレイアウト崩れを修正し、CSS を `templates/layout/base.html` に統合。Pi4 実機でタブ表示を確認。
- `docs/requirements.md` の優先度表を ✅/☐ 管理に更新し、進捗を可視化。
- `docs/test-notes/2025-10-31-right-panel-layout.md` に検証ログを追加。
