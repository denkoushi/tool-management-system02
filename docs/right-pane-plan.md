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
- **環境ファイルの配備**: `config/window-a-client.env.sample` を元に `sudo ./scripts/install_window_a_env.sh --with-dropin` を実行すると、Window A 用の設定ファイルと systemd ドロップインを同時に展開できる。初期構築時は以下の前提を満たすこと。
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
  4. `sudo ./scripts/install_window_a_env.sh --with-dropin` が `tools01` ユーザー不在で失敗する場合は、`/etc/toolmgmt/window-a-client.env` と `/etc/systemd/system/toolmgmt.service.d/window-a.conf` を手動で配置し、所有者を `tools02:tools02`（env）と `root:root`（drop-in）に設定する。
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

---
このプランに沿ってタスクを順次進め、各ステップ完了後にドキュメントへ反映していきます。
