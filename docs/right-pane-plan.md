# 右ペイン統合計画（Window A）

## 1. 目的と現状
- Window A（Pi4）は RaspberryPiServer（Pi5）のクライアントとして右ペイン UI（要領書／所在一覧／構内物流）を提供する。サーバー処理はすべて Pi5 に集約済み。
- 右ペインは DocumentViewer iframe を中心に、Pi5 の Socket.IO / REST イベントを表示・操作する役割に徹する。
- 2025-11-02 時点で以下を確認済み。
  - Pi4 実機の Playwright ライブテスト `tests/e2e/window-a-live.spec.ts` が PASS（スキャン→所在サマリー→構内物流更新）。
  - ステータスバー UI のレイアウト調整／アクセシビリティ改善を実施。
  - `.env.test` と `PLAYWRIGHT_ENV_FILE` により Pi4 で自動検証が再現可能。

## 2. UI 構成
```
.right-pane
 ├─ view-switch（要領書 / 所在一覧 / 構内物流）
 ├─ docViewerSummary（棚位置・デバイス・最終更新 + 所在一覧ボタン）
 ├─ iframe（DocumentViewer /viewer）
 ├─ #partLocationsPanel
 └─ #logisticsPanel
```
- レイアウト CSS: `templates/layout/base.html`
  - `.doc-viewer-header__section--switch` / `--status` / `--actions` でヘッダーを 3 分割し、高さを固定（44px）。
  - ステータスバーは `role="status"` `aria-live="polite"` を設定し、キーボード操作で「所在一覧を開く」にフォーカスできる。
- テンプレート: `templates/right_panel/doc_viewer.html`
  - タブは `data-target` / `aria-controls` で `initRightPanel.js` と連携。
  - サマリー項目は `aria-label` を付与し、スクリーンリーダーで読み上げ可能。

## 3. JavaScript モジュール
| ファイル | 概要 | 備考 |
| --- | --- | --- |
| `static/js/rightPanel/initRightPanel.js` | Socket.IO 初期化、タブ切替、各パネルの初期化を統括 | `highlightPartLocation` などのグローバル橋渡しをここで定義 |
| `static/js/rightPanel/docViewerPanel.js` | iframe 状態、サマリー更新、`dv-barcode`/`viewer-message` postMessage の受け口 | `toolmgmt:part-location-summary` カスタムイベントでサマリーを受信し、`viewer-message` エラーはオーバーレイに転送 |
| `static/js/rightPanel/partLocationsPanel.js` | 所在一覧テーブル、REST フォールバック、外部ハイライト | Playwright テストでエントリ更新を検証 |
| `static/js/rightPanel/logisticsPanel.js` | 構内物流タブ、ステータスバッジ、Socket.IO 更新 | 依頼時刻列を Pi5 API に合わせて表示 |
| `static/js/rightPanel/socketStatusManager.js` | 再接続ウォッチドッグ、状態イベント発行 | `SOCKET_STATUS_WATCHDOG=1` を既定有効 |

## 4. 設定と依存
- `.env` / systemd ドロップイン
  - `RASPI_SERVER_BASE`, `UPSTREAM_SOCKET_BASE`, `DOCUMENT_VIEWER_URL` を Pi5 のホスト名へ揃える。
  - `SOCKET_STATUS_WATCHDOG=1` を既定で有効にし、Pi5 停止中も「再接続中…」表示を維持。
  - サンプル: `config/window-a-client.env.sample`
- Pi5 側 `/etc/default/raspi-server`
  - `API_TOKEN` / `VIEWER_API_TOKEN` を Window A と一致させる。
  - `VIEWER_CORS_ORIGINS` / `SOCKETIO_CORS_ORIGINS` を Window A 実ホスト（例: `http://raspi-window-a.local:8501`）に設定。
  - RUNBOOK（Pi5）3.2 で設定手順を更新済み。

## 5. テストと検証
### 5.1 自動テスト
```bash
cd ~/tool-management-system02
PLAYWRIGHT_ENV_FILE=.env.test npx playwright test tests/e2e/window-a-live.spec.ts --config=tests/e2e/playwright.config.ts
```
- `testpart` を利用し、Pi5 上の `testpart.pdf` を読み込む。
- 成功時：所在サマリーが `RACK-A1` / `playwright-device-<timestamp>` を表示し、構内物流タブにジョブが追加される。
- 失敗時は `test-results/` に保存される trace / video を `npx playwright show-trace` で確認。

### 5.2 手動チェックリスト
1. Window A ブラウザで右ペインを開き、ピンチ/リサイズしてレイアウトが崩れないこと。
2. ステータスバーの「所在一覧を開く」ボタンを Tab → Enter で操作し、所在一覧タブへ切り替わること。
3. Pi5 を停止（`sudo systemctl stop raspi-server.service`）してもステータスチップが「再接続中…」に留まること。
4. Pi5 再起動後に Playwright を再実行し、PASS すること。

## 6. 未完タスク（右ペイン関連）
- ✅ ステータスバー UI 調整（2025-11-02）
- ✅ DocumentViewer iframe のエラー表示改善（HTTP エラー、PDF 404 などをユーザーに提示） — 2025-11-05: RaspberryPiServer から `viewer-message` postMessage を送出し、Window A 側オーバーレイに文言を表示。Vitest (`npm run test:js`) でハンドリングを検証。
- ☐ Logistics タブのフィルタ／ソート機能を検討
- ☐ postMessage プロトコル仕様書を追加（DocumentViewer ↔ Window A）

## 7. 参照ドキュメント
- `README.md` — Window A クライアント概要
- `RUNBOOK.md` — Pi5 との連携手順、Playwright 実行タイミング
- `docs/requirements.md` — 要件一覧
- `docs/requirements/window-a-statusbar.md` — ステータスバー改修要件
- `docs/test-notes/2025-11-02-window-a-live-playwright.md` — 実機検証ログ
- RaspberryPiServer 側 `docs/documentviewer-migration.md`
