# Window A クライアント RUNBOOK

本書は Raspberry Pi 4（Window A）で動作するクライアントアプリの運用手順をまとめています。サーバー機能はすべて RaspberryPiServer（Pi5）へ集約済みであり、Window A は以下の役割に専念します。

- 右ペイン UI（DocumentViewer iframe／所在一覧／構内物流）の表示
- Pi5 からの Socket.IO / REST イベントの可視化
- Pi4 に直結した周辺機器（NFC リーダー、USB ハンディ）の橋渡し

Pi5 側の手順は RaspberryPiServer リポジトリの `RUNBOOK.md` を参照してください。

## 1. 設定ファイルと systemd ドロップイン

Window A のサービスは `toolmgmt.service` で管理します。Pi5 のホスト名・トークンと一致させるため、以下の EnvironmentFile を整備してください。

```bash
cd ~/tool-management-system02
sudo cp config/window-a-client.env.sample /etc/toolmgmt/window-a-client.env
sudo nano /etc/toolmgmt/window-a-client.env
```

主な変数:

| 変数名 | 目的 | 備考 |
| --- | --- | --- |
| `RASPI_SERVER_BASE` | Pi5 の REST ベース URL | 例: `http://raspi-server-3.local:8501` |
| `DOCUMENT_VIEWER_URL` | 右ペイン iframe の URL | 未指定時は `/viewer` を自動解決 |
| `UPSTREAM_SOCKET_BASE` | Pi5 の Socket.IO ベース URL | `http://raspi-server-3.local:8501` |
| `SOCKET_STATUS_WATCHDOG` | 再接続ウォッチドッグ | 既定 `1`（Pi5 停止中も「再接続中…」表示） |
| `ENABLE_LOCAL_SCAN` | Pi4 直結 NFC スキャン | 既定 `0`（Pi Zero へ移行済み） |
| `RASPI_SERVER_API_TOKEN` | Pi5 の API トークン | `/etc/default/raspi-server` と一致 |
| `TOOLMGMT_CLIENT_ROLE` | ログ識別子 | `window-a` など |

systemd ドロップインには以下を設定します。

```bash
sudo mkdir -p /etc/systemd/system/toolmgmt.service.d
sudo cp config/systemd/toolmgmt.service.d/window-a.conf.sample     /etc/systemd/system/toolmgmt.service.d/window-a.conf
```

Pi5 側で `SOCKET_STATUS_WATCHDOG=1` やトークン整合を行う方法は RaspberryPiServer リポジトリ `RUNBOOK.md` の 3.2 節を参照してください。

## 2. サービス操作

```bash
sudo systemctl daemon-reload
sudo systemctl restart toolmgmt.service
sudo systemctl status toolmgmt.service --no-pager
journalctl -u toolmgmt.service -n 50
```

## 3. Playwright ライブテスト

レイアウトや DocumentViewer 連携に変更があった場合は、Pi4 実機でライブテストを実行し、Pi5 との疎通を確認します。

```bash
cd ~/tool-management-system02
PLAYWRIGHT_ENV_FILE=.env.test   npx playwright test tests/e2e/window-a-live.spec.ts   --config=tests/e2e/playwright.config.ts
```

- `.env.test` のサンプルはリポジトリ直下にあり、Pi5 のホスト名とトークンを設定します。
- 成功時：所在サマリーが `testpart` の最新情報を表示し、構内物流タブにテストジョブが追加されます。
- 失敗時：`test-results/` に保存された trace / video（`npx playwright show-trace ...`）を確認してください。
- 実施ログは `docs/test-notes/2025-11-02-window-a-live-playwright.md` に追記済み。

## 4. 手動確認チェックリスト（抜粋）
1. ブラウザで右ペインを開き、タブ切替／ウィンドウリサイズでレイアウト崩れがない。
2. ステータスバーの「所在一覧を開く」を Tab → Enter で操作でき、所在一覧タブへ遷移する。
3. Pi5 停止中もステータスチップが「再接続中…」を維持し、再開後に `LIVE` へ戻る。
4. `/srv/rpi-server/documents/testpart.pdf` を更新した場合、DocumentViewer が最新 PDF を表示する。

## 5. 参考ドキュメント
- `README.md` — クライアント概要とセットアップ手順
- `docs/requirements.md` — 要件と進捗
- `docs/right-pane-plan.md` — 右ペイン構成・テスト指針
- `docs/requirements/window-a-statusbar.md` — ステータスバー改修要件
- `docs/test-notes/` — 実機検証ログ
- RaspberryPiServer リポジトリ `RUNBOOK.md` — サーバー側運用手順
