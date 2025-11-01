# 右側ドキュメントビューア統合プラン

## 1. 現状整理
- **Tool Management System (TMS)**: 既存リポジトリ。本番環境では `toolmgmt.service` が Flask + Socket.IO を `http://127.0.0.1:8501` で提供し、左半分 UI のみ使用中。
- **DocumentViewer (DV)**: 2025-10 時点で RaspberryPiServer へ統合済み。`/viewer` UI と `/api/documents/<part>`、`/documents/<filename>` を Docker コンテナ内の Flask Blueprint が提供し、Window A からは iframe で利用する。
- **運用スタイル**: Window A はクライアント専用とし、サーバー機能（PDF 配信・Socket.IO ブロードキャスト）は RaspberryPiServer（ラズパイ 5）で一元提供する。

## 2. 右側エリアの表示方針（ベストプラクティス）
- **iframe 埋め込みを基本**: TMS の右半分 (`.future-panel`) を DV の iframe で常時占有させ、ユーザー体験を「1 画面で 2 システムが並列動作する」構成にする。
- **ヘッダ内トグルで複合表示**: 右ペインは「要領書」を既定とし、ステータスバー内のスイッチボタンから所在一覧（`part_locations`）へ切り替えられる。所在一覧は Socket.IO でリアルタイム更新し、接続断時は 20 秒間隔の REST ポーリングで自動再取得する。
- **URL/ポート管理**: 既定値は `raspi-server.local:8501` を想定。`DOCUMENT_VIEWER_URL` を省略しても `RASPI_SERVER_BASE` が設定されていれば自動的に `/viewer` へ誘導される。
- **Socket.IO 接続先の切替**: `UPSTREAM_SOCKET_BASE`（ベース URL）と `UPSTREAM_SOCKET_PATH` で RaspberryPiServer（ラズパイ 5）を指定。既定では同一ホストを参照し、`UPSTREAM_SOCKET_AUTO=0` でクライアント側接続を抑止できる。
- **再接続ステートマシン**: `SOCKET_STATUS_WATCHDOG=1` を既定とし、Pi5 停止中もステータスチップが「再接続中…」表示を維持する状態マシンを有効化する。無効化したい場合のみ環境値を `0` に変更する。
- **環境ファイルの配備**: `config/window-a-client.env.sample` を元に `sudo ./scripts/install_window_a_env.sh` を実行すると、Window A 用の設定ファイルと systemd ドロップインを同時に展開できる。既存の drop-in を保持したい場合は `--no-dropin` を付与して実行する。初期構築時は以下の前提を満たすこと。
  - `sudo apt install -y build-essential python3-dev swig libpcsclite-dev pcscd postgresql-client` を事前に実行し、`pyscard` のビルドと `psql` クライアントが利用できる状態を整える。
  - 依存ライブラリは RaspberryPiServer 側と同じバージョンを利用する。特に `psycopg2-binary` は **2.9.10** を使用し、`source venv/bin/activate && pip install -r requirements.txt -r requirements-dev.txt` を再実行する。
  - systemd drop-in の `EnvironmentFile` は `-/etc/toolmgmt/window-a-client.env` ではなく `=/etc/toolmgmt/window-a-client.env` とし、読み込みに失敗した際に黙って無視されないようにする（2025-10-28 修正）。
- **フォーカスとイベント分離**: 左側のバーコード入力と右側のキーボードイベントが干渉しないように tabindex / pointer-event の制御、または iframe 内でキーボードフォーカスを明示的に管理。
- **ヘルスチェック表示**: iframe 読み込み失敗時にアラートを表示する簡易監視を TMS に組み込み、DV 停止を即時検知できるようにする。
- **サービスの起動／停止統一**: systemd を利用し、TMS (`toolmgmt.service`) と DV (`docviewer.service` など仮称) を個別ユニットとして管理。キオスク起動手順では「両サービスが稼働中であること」をチェックリスト化。

## 3. 実装タスク一覧
1. **DocumentViewer 側整備（完了）**
   - RaspberryPiServer リポジトリで `document_viewer` Blueprint を追加し、Docker 内で常駐化。`/viewer` UI・`/api/documents`・`/documents` を提供。
   - systemd 環境ファイル（Pi5）で `VIEWER_*` 系の環境変数とログパスを管理する。
2. **通信エンドポイントの確定**
   - Window A からは `RASPI_SERVER_BASE`（例: `http://raspi-server.local:8501`）で REST / Socket.IO / DocumentViewer を共通化。
   - 別マシンへ移す場合は README / RUNBOOK にホスト名と DNS 設定（`/etc/hosts` を含む）を明記する。
3. **TMS テンプレート改修**（第一段階完了）
   - `templates/index.html` を DocumentViewer 埋め込み用レイアウトに刷新し、状態表示と再読み込みボタンを追加済み。
   - iframe 読み込み状態を UI に反映（ローディング表示／エラー表示切替など）まで完了。
   - 生産計画セクションに「サーバー再読込」ボタンを追加し、`/api/plan/refresh`（RaspberryPiServer の `/internal/plan-cache/refresh` を呼び出すラッパ）を POST して手動同期できるようにした。処理結果は `productionHighlightMessage` にトースト表示し、API 監査ログへも記録する。
   - 今後、DocumentViewer からのイベント連携や左右レイアウトの最終調整を継続。
4. **TMS API・設定追加**
   - Flask の設定値に DV のベース URL を注入（`app.config` / `.env` / 設定ファイル）。
   - 将来的な API 連携（例えば貸出操作後に DV をリフレッシュ）を想定し、共通ユーティリティを検討。
5. **USB 共有運用の整備**（実施中）
   - `usb_master_sync.sh` と DocumentViewer の importer を直列実行するラッパを追加（UI ボタンから利用できるよう改修）。
   - USB 内のフォルダ構成（`master/`, `docviewer/`）と `meta.json` 運用ルールを明確化。
   - README / RUNBOOK / DocumentViewer docs を更新し、手順と sudoers 設定、ログ確認方法を追記。
6. **システムテスト**
   - 両サービス同時起動の動作検証（起動スクリプト、systemd、キオスク自動起動）。
   - 左右 UI のキーボード操作・スキャン動作が干渉しないことを確認。
   - ネットワーク切断や DV 停止時の復旧手順を RUNBOOK に追加。

### 3.1 右ペイン JavaScript モジュール構成（2025-10-28 更新）
| モジュール | 役割 | 主な依存・公開インターフェイス |
| --- | --- | --- |
| `static/js/rightPanel/index.js` | 右ペイン初期化エントリ。ESM のエントリポイント。 | `bootstrapRightPanel()` を呼び出し。 |
| `static/js/rightPanel/bootstrap.js` | 初期化の調整役。 | `initRightPanel` で Socket.IO や初期データを取得し、`bootstrapLegacy` を呼び出す。 |
| `static/js/rightPanel/initRightPanel.js` | Socket.IO クライアント生成と共通状態の準備。 | `createSocket`・`initPartLocations`・`initDocViewer` を使用し、socket/partLocations/docViewer を返す。 |
| `static/js/rightPanel/partLocationsPanel.js` | 所在一覧の描画・ソケット監視・REST フォールバック。 | `socket.io-client`、`fetch`。`refresh()/setSocketStatus()` を公開。 |
| `static/js/rightPanel/docViewerPanel.js` | DocumentViewer iframe の状態管理と postMessage 連携。 | iframe load/error、`window.handleViewerBarcode` を通して pageLegacy と連携。 |
| `static/js/rightPanel/apiTokensPanel.js` | API トークン管理 UI。 | `loadTokens/issueToken/revokeToken` を公開、クリックはモジュール内でバインド。 |
| `static/js/rightPanel/maintenancePanel.js` | USB 同期 + 工程設定 UI。 | `/api/usb_sync` と `/api/station_config` を担当。`refresh/fetch/runUsbSync` を返す。 |
| `static/js/rightPanel/pageLegacy.js` | 既存 UI の橋渡し。タブ切替・スキャン開始/停止・登録系ハンドラを担当し、新モジュールと連携。 | `window.appScan` のみグローバル保持。各モジュールの戻り値を利用。 |

### 3.2 テスト観点・検証メモ
1. **所在一覧 (`partLocationsPanel.js`)**
   - Socket.IO 接続時に `LIVE` へ遷移し、`part_location_updated` で即時差分反映されること。
   - 接続断後 20 秒以内に REST フォールバックが走り、`OFFLINE` → `LIVE` へ戻ること。
   - ハイライト対象が切り替わる際にクラスが正しくトグルされること（`is-flash` が 2.2 秒後解除）。
2. **DocumentViewer (`docViewerPanel.js`)**
   - フレームロード成功時に `ONLINE` 表示／失敗時にオーバーレイ表示へ切り替わること。
   - `viewer-state` postMessage を受けてステータスチップが更新されること。
   - `dv-barcode` が pageLegacy の `handleViewerBarcode` と連携し生産計画テーブルがハイライトされること。
3. **API トークン管理 (`apiTokensPanel.js`)**
   - 発行／無効化で `<pre>` やメッセージ欄が期待する内容へ更新されること。
   - `keep_existing` チェック時に既存トークンが保持されるケース、`revoke all` 時に件数表示が期待通りになること。
   - バリデーション（未入力・フォーマット不備）が UI メッセージで通知されること。
4. **メンテナンス (`maintenancePanel.js`)**
   - USB 同期ボタンでオーバーレイ表示、`steps` のサマリ整形、成功/失敗メッセージが確認できること。
   - 工程設定の保存／候補追加／削除が `/api/station_config` 経由で反映され、チップやセレクトボックスへ即時反映されること。
   - station_config 更新が失敗した場合、`stationConfigNotice` とメッセージ欄にエラーテキストが表示されること。
5. **レガシー橋渡し (`pageLegacy.js`)**
   - タブ切替でスキャン状態がリセットされること（`appScan.stop()` の自動呼び出し）。
   - スキャン開始→停止でボタン状態とメッセージがトグルすること。
   - 登録／マスタ系アクションが `data-action` ベースのイベントで機能し続けること。

#### 自動テストの方針
- **ユニットレベル**（Node.js + Jest など）  
  - `partLocationsPanel` の normalize/render ロジック、`apiTokensPanel` のバリデーション関数、`maintenancePanel` のプレゼンテーション整形（`formatTimestamp` 等）をモック DOM 上で検証。
- **統合テスト**（Playwright などブラウザ E2E）  
  - Socket.IO をモックサーバーで疑似し、ビューの状態遷移をスナップショットで確認。
  - DocumentViewer iframe はテスト用スタブを用意し、postMessage 送受信を確認。
- **手動検証**  
  - 実機（Window A）でのカードリーダー・バーコードスキャナ連携、USB メディア実際の入れ替えを伴うテストを RUNBOOK に沿って実施。

## 4. 接続・構築検証メモ（2025-10-28 更新）
- RaspberryPiServer 側で `docker compose exec -T app python /app/tests/socketio_listener.py` を起動し、`curl -X POST http://127.0.0.1:8501/api/v1/scans ...` を実行して Socket.IO ブロードキャストを確認する。
- Window A で `UPSTREAM_SOCKET_BASE=http://raspi-server.local:8501` を設定し、画面右上のチップが `LIVE` になること、`part_location_updated` 受信時に所在一覧と DocumentViewer が自動更新されることを確認する。
- 接続できない場合は `UPSTREAM_SOCKET_PATH`、`API_TOKEN`、RaspberryPiServer 側の `docker compose logs app` を確認し、必要なら `UPSTREAM_SOCKET_AUTO=0` で自動接続を一時的に無効化して REST ポーリングのみで動作させる。
- Window A（Pi4）をまっさらな状態から構築する手順
  1. `git pull origin feature/client-socket-cutover` でリポジトリを最新化し、`requirements.txt` の更新（`psycopg2-binary==2.9.10`）を取得する。
  2. `sudo apt install -y build-essential python3-dev swig libpcsclite-dev pcscd postgresql-client` を実行してビルドツール・PCSC ライブラリ・`psql` を整備する。
  3. `source venv/bin/activate && pip install -r requirements.txt -r requirements-dev.txt && deactivate` を実行して Python 依存を揃える。
  4. `sudo ./scripts/install_window_a_env.sh` が `tools01` ユーザー不在で失敗する場合は、`/etc/toolmgmt/window-a-client.env` と `/etc/systemd/system/toolmgmt.service.d/window-a.conf` を手動で配置し、所有者を `tools02:tools02`（env）と `root:root`（drop-in）に設定する（drop-in を適用したくない場合は `--no-dropin` を付与）。
  5. `sudo systemctl daemon-reload` → `sudo systemctl restart toolmgmt.service` → `sudo journalctl -u toolmgmt.service -n 20 --no-pager` で DB 接続が成功し、`curl` + Socket.IO リスナーで 201／イベント受信を確認する。

## 5. 検討中・将来課題
- **起動シーケンス自動化**: キオスク起動時に DV の `/health` をチェックし、未起動なら自動スタート or 警告を出す。
- **共通ログ／監視**: 両サービスのログを journalctl / systemd でまとめて確認できるようにし、障害時の原因切り分けを簡潔に。
- **右側 UI の高度化**: 例えば TMS の貸出履歴と連動して DV へメタ情報を渡す、もしくは DV からの通知を TMS へ返すなど、双方向連携 API の検討。
- **将来的なスケーリング**: 別ラズパイに DV を配置するケースに備え、CORS 設定や TLS 化、ネットワーク越しの遅延対策を検討。

### 優先度整理（2025-10-05 時点）

全体の優先度とバックログは `docs/requirements.md` を参照してください。右ペイン統合に関わるタスクのみ、ここで補足します。

1. **DocumentViewer 側サービス整備**  
   - Raspberry Pi 上での常駐化（systemd）、依存パッケージ、ヘルスチェック API の整備。
2. **iframe 連携強化**  
   - station.json 更新時の再読込、postMessage 経由の状態連携の安定化。 
3. **USB 共有運用**  
   - `usb_master_sync.sh` と DocumentViewer importer の直列動作確認、ログ整備、エラーメッセージ統一。

## 6. 次に着手するモジュール化タスク（2025-10-30 更新）

| 優先度 | 対象モジュール | 目的 | 主な Todo |
| --- | --- | --- | --- |
| 高 | 左ペイン「借用/返却」ビュー (`templates/index.html` 内) | 右ペインと同様にテンプレートを分割し、再利用しやすい構造へ改修する | 1. `templates/left_panel/operations.html`（仮）への抽出<br>2. `static/js/rightPanel/pageLegacy.js` で依存している DOM ID を洗い替え<br>3. pytest + Jinja を用いたレンダリングテストを追加 |
| 中 | 登録・マスタ関連フォーム | REST API 化後の再利用を見据えてフロントロジックを整理 | 1. `data-action` ベースのイベントハンドラを ES モジュール化<br>2. API コールを共通ラッパに集約し、エラー処理を統一<br>3. 成功/失敗トーストを `showMessage` の改良版へ置き換え |
| 中 | API トークン管理 UI | 他端末からも利用できるコンポーネントとして切り出す | 1. テンプレートを `templates/partials/` へ移動<br>2. `static/js/rightPanel/apiTokensPanel.js` を単体実行可能な ES モジュールへ整理<br>3. レスポンスモックを用いた単体テストを追加 |
| 低 | スタイルガイド整備 | 将来的な CSS ツール導入に備えてデザイントークンを整理 | 1. 共通スタイルを `static/css/`（新設）へ移管<br>2. 長期的には PostCSS / Tailwind 等の導入を検討 |

> 各タスクは着手時に専用ブランチを作成し、完了後に `docs/right-pane-plan.md` と `docs/implementation-plan.md` の進捗を更新する。

- 進捗: 2025-10-30 時点で借用/返却タブの HTML を `templates/left_panel/operations.html` へ切り出し、フロントロジックは `static/js/modules/operationsPanel.js` として ES モジュール化済み。共通レイアウト化・登録タブの分割を次フェーズで進める。

### 6.1 左ペイン借用/返却ビュー 抜き出し案

**テンプレート構成案**
- `templates/layout/base.html`（新規）  
  - `<head>` と全体レイアウト、共通スタイル/スクリプト読込を集約。
- `templates/left_panel/operations.html`（新規）  
  - 現在 `index.html` に直書きされている借用/返却タブ一式を移動。  
  - `scanStatus` や `openLoansTable` などの DOM ID は維持し、インクルード先で `{{ include(...) }}` を利用。
- `templates/left_panel/registration.html` / `master.html` / `maintenance.html`（段階的追加）  
  - それぞれのタブを独立ファイル化し、今後の機能別モジュール化に備える。

**JavaScript 再編案**
- `static/js/modules/operationsPanel.js`（新規）  
  - 既存 `pageLegacy.js` から借用/返却タブに関係する関数（`startScan`, `stopScan`, `loadLoansData`, `manualReturnLoan` 等）を移行。  
  - 初期化関数 `initOperationsPanel({ fetchImpl, socket })` を公開し、イベントバインドを内部に隠蔽する。
- `pageLegacy.js` は橋渡しのみに縮小し、各モジュールの `init` を呼び出す役割へ移行。
- Socket.IO 経由のイベント (`transaction_complete`, `state_reset` 等) は `operationsPanel` 内で購読し、`socketClient.js` から DI する。

**API/I/O の整理**
- REST エンドポイント呼出（例: `/api/loans`, `/api/loan/manual-return` 等）は `static/js/modules/httpClient.js`（新規）に凝集。  
  - 共通で `fetchJSON(path, { method, body })` を提供し、401/500 のエラー表示を統一。
- トースト表示は右ペインで利用している `showMessage` を改修し、`modules/ui/flash.js` などに切り出して左右で共通利用する。

**テスト戦略**
- pytest + Jinja2 のサンプルデータで `left_panel/operations.html` をレンダリングし、主要 DOM ID が存在することを確認するスナップショットテストを追加。
- JS は `vitest` もしくは `jest` で `operationsPanel` の主要関数（貸出データ整形、テーブル更新、トースト表示）をモック DOM 上で検証する。

この抜き出し案をベースにブランチ `feature/operations-panel-extraction` を作成し、段階的にテンプレートと JS の分割を進める。

---
このプランに沿ってタスクを順次進め、各ステップ完了後にドキュメントへ反映していきます。

### 6.2 2025-10-31 作業ログ

- 左ペイン 4 タブ（借用/返却・タグ登録・マスタ・メンテ）を `templates/left_panel/` 配下へ分割し、`templates/layout/base.html` にフォーム・テーブル・タブ共通スタイルを新設。
- `static/js/rightPanel/maintenancePanel.js`｜`pageLegacy.js` を更新し、USB 同期オーバーレイのクラス制御と履歴タブ表示のクラス切替（`.is-hidden`）へ移行。
- `partials/api_tokens.html` 含めインラインスタイルを撤廃し、`.button-row` / `.card-grid` / `.maintenance-output` などのユーティリティクラスで UI を統一。
- Vitest を導入し、`operationsPanel` / `registrationPanel` / `maintenancePanel` の主要フロー（貸出一覧読み込み、タグ登録、工程設定更新・USB同期）を単体テスト化。
- DocumentViewer / 所在一覧のプレビュー用サンドボックス（`static/preview/right-panel.html`）を整備し、Playwright からも参照できる環境を追加。

### 6.3 構内物流モジュール化 — 進捗と残タスク

**進捗（2025-10-31）**
- 右ペイン UI/JS を `templates/right_panel/logistics.html` / `static/js/rightPanel/logisticsPanel.js` に分離し、RaspberryPiServer の `/api/logistics/jobs` から初期ロード＋`logistics_job_updated` Socket.IO イベントでの差分反映まで実装。
- Window A Flask 側で `fetch_logistics_jobs()` と `/api/logistics/jobs` プロキシ API を追加。API トークン判定と監査ログ（`logistics_jobs_list`）を統合した。
- pytest（`tests/test_logistics_proxy.py`）で REST プロキシ／バリデーション／未設定時の挙動をカバー。Vitest では `logisticsPanel.test.js` で REST 取得・Socket 更新・エラーハンドリングを検証。
- プレビュー環境 `static/preview/right-panel.html` を物流タスク対応へ拡張し、Playwright smoke (`tests/e2e/smoke.spec.ts`) で REST → Socket → カウントバッジ反映まで確認できるようにした。

**残タスク**
- Playwright 実機 E2E（Window A ⇔ Pi5）を有効化し、Pi Zero からの実データと同期できることを自動検証する。
- 構内物流タスクの状態遷移仕様（`pending`→`in_transit`→`done` 等）を整理し、`docs/logistics-module-plan.md`（新規予定）にデータフローと責務分担を明記する。
- Pi Zero 側スクリプトと連携した通知内容（担当者・推定到着時刻など）を合意し次第、API スキーマおよび UI 表示項目を拡張する。

## 7. モジュール化ロードマップ（Pi5／Pi Zero／Pi4）

1. **DocumentViewer クライアント分離（完了）**  
   RaspberryPiServer 側で `/viewer`・`/api/documents`・`/documents` を提供。Window A は iframe で参照し、Socket.IO 連携は `UPSTREAM_SOCKET_BASE` に統一。ログは Pi5 の `VIEWER_LOG_PATH` へ集約する。
2. **工具管理 UI のクライアント化（進行中）**  
   Window A の Flask は UI 表示と REST プロキシのみに縮退。`config/window-a-client.env.sample` を基に API ホストを Pi5 へ切り替え、不要なサーバー処理を停止する。
3. **構内物流 UI の Socket.IO 化（進行中）**  
   OnSiteLogistics の `handheld_scan_display.py` を活用し、Pi5 からの `scan_update`／`logistics_job_updated` を受信して右ペインへ反映。接続断時の再試行とアラート表示を共通化する。
4. **標準工数・生産日程の取り込み移行（未着手）**  
   CSV → SQLite のローカル処理を Pi5 側バッチへ移し、Window A は参照専用とする。データ投入 CLI は RaspberryPiServer の `tool-ingest-sync.sh` へ統合検討。
5. **14 日連続検証（未着手）**  
   Pi5・Pi Zero・Pi4 の組み合わせで日次チェックを 14 日連続実施し、`docs/templates/test-log-mirror-daily.md` を用いて証跡を残す。完了後に Decision Log へ記録。

## 8. 追加課題

- Pi4 用の共通 `EnvironmentFile` テンプレートを整備し、DocumentViewer／工具管理／構内物流で流用する。  
- Pi5 へのアクセス要件（mDNS、静的 IP）を RUNBOOK に記載し、Window A での DNS 解決手順を統一する。  
- 旧 Pi4 に残る cron／ログ出力を棚卸しし、必要なものは Pi5 へ集約。  
- 左右 UI で共通利用する Socket.IO リスナー／HTTP クライアントをモジュール化し、重複コードを排除する。

## 4. 現在の状況と残課題（2025-10-31）
- ✅ DocumentViewer iframe は RaspberryPiServer `/viewer` で稼働し、Window A から参照できている。Socket.IO も `UPSTREAM_SOCKET_BASE` で Pi5 に統一済み。
- ✅ 構内物流タブは Pi5 の `/api/logistics/jobs` と `logistics_job_updated` を利用して動作。状態ラベルは日本語バッジ化し、依頼時刻も表示。
- ▶ Socket.IO 断検知と再接続表示を改善し、状態チップが Pi5 の実状態と同期するようにする。
- ▶ Playwright による E2E シナリオ（スキャン → 所在 → DocumentViewer）を `docs/e2e-plan.md` に沿って追加する。
- ▶ 左ペインのテンプレート分割・モジュール化（`operationsPanel.js` など）とテスト拡充を継続する。
- ▶ Pi5 のホスト名が `raspi-server-*.local` へ変わった場合の表示・設定ミス防止策を検討し、環境生成スクリプトへ反映する。
