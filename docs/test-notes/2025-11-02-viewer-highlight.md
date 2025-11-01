# 2025-11-02 DocumentViewer → 所在一覧ハイライト検証（Window A）

## 前提
- Window A (Pi4) `tool-management-system02` ブランチ: `feature/client-socket-cutover`
- RaspberryPiServer (Pi5) ブランチ: `feature/server-app`
- `config/window-a-client.env` を最新テンプレート通りに反映 (`RASPI_SERVER_BASE=http://raspi-server.local:8501`, `SOCKET_STATUS_WATCHDOG=1`)
- Pi5 `/srv/rpi-server/documents/testpart.pdf` を配置済み
- `npm test -- run` のユニットテストは通過済み

## 手順
1. Window A 側でサービスを再起動
   ```bash
   cd ~/tool-management-system02
   git pull origin feature/client-socket-cutover
   npm install
   sudo systemctl daemon-reload
   sudo systemctl restart toolmgmt.service
   ```
2. Pi4 ブラウザで右ペインを開き、`testpart` を検索して PDF が表示されることを確認。
3. Pi5 `/viewer` UI の検索欄に `testpart` を入力し、`dv-barcode` イベントを送出（もしくは Pi Zero スキャンを実施）。
4. Window A の所在一覧タブへ自動遷移し、該当行が `is-flash` クラスで点滅することを確認。存在しないオーダーの場合は、次回取得時にハイライトされることを合わせて確認。

## 結果
- `dv-barcode` 受信後、所在一覧タブが自動アクティブ化され該当行がハイライトし、約 2 秒後に自動解除された。
- 存在しないオーダーを指定した場合は、次の REST 取得で行が追加されたタイミングでハイライトが実行された。
- Pi5 停止 → 再開時もウォッチドッグ (`SOCKET_STATUS_WATCHDOG=1`) によりステータスチップが「再接続中…」を維持し、その後 `LIVE` に復帰。

## 備考
- 本検証で `docs/requirements.md` の「構内物流・所在一覧 UI の整合（DocumentViewer 連携イベント再テスト）」タスクが完了。
- 追加の自動化は Playwright E2E 整備タスクで実施予定。
