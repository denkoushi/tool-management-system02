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

## 6. API トークンのローテーション

Pi5（RaspberryPiServer）と Pi4 クライアント、Pi Zero ハンディは同じ Bearer トークンを共有します。ローテーション時は以下の順序で更新し、値の不整合を避けてください。

1. **新しいトークンの発行**  
   ```bash
   cd ~/tool-management-system02
   python scripts/manage_api_token.py rotate --station-id WINDOW-A --reveal
   ```  
   - `/etc/toolmgmt/api_token.json` が更新され、管理 API 用トークンが最新化される。`station_id` は監査ログ用に端末名（例: `WINDOW-A`）を設定する。

2. **Pi5 / Pi4 / Pi Zero の設定ファイルを更新**  
   - Pi5: `/etc/default/raspi-server` の `API_TOKEN` と `VIEWER_API_TOKEN` を新しい値に差し替え。  
   - Pi4: `/etc/toolmgmt/window-a-client.env` の `RASPI_SERVER_API_TOKEN` を更新。  
   - Pi Zero: `/etc/onsitelogistics/config.json`（もしくはハンディ用リポジトリの `.env`）に記載した `api_token` を更新。  
   - Playwright 用 `.env.test` や開発マシンの環境変数も同じ値にしておく。

3. **サービス再起動**  
   ```bash
   # Pi5
   sudo systemctl restart raspi-server.service
   # Pi4
   sudo systemctl restart toolmgmt.service
   # Pi Zero (名称は運用に合わせる)
   sudo systemctl restart onsitelogistics.service
   ```  
   - `journalctl -u <service> -n 20` で再起動エラーがないか確認する。

4. **動作確認**  
   - Pi5:  
     ```bash
     curl -s -o /dev/null -w '%{http_code}\n' \
       -H "Authorization: Bearer <新しいトークン>" \
       http://127.0.0.1:8501/healthz
     ```  
     200 が返れば認証成功。  
   - Pi4: `python scripts/manage_api_token.py show --reveal` でトークンが更新されていることを確認し、ブラウザの管理画面に新しいトークンを入力。  
   - Pi Zero: ハンディから `/api/v1/scans` を送信し、Pi5 ログに 401 が出ていないことを確認。

5. **監査ログと記録**  
   - `logs/api_actions.log`（Pi4）と `/var/log/raspi-server/app.log`（Pi5）に station_id 付きで操作記録が残る。ローテーション日と反映端末を `docs/test-notes/` もしくは運用ノートに追記し、パスワード管理ツールにも保存する。

6. **フォールバック**  
   - トークンが不明になった場合は Pi5 `/etc/default/raspi-server` の値を基準に、Pi4 と Pi Zero を合わせる。旧トークンを無効化したいときは `python scripts/manage_api_token.py revoke --all` を実行する。詳細は `docs/security-overview.md` の「API トークン統合ポリシー」を参照。
