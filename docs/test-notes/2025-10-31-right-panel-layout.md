# 2025-10-31 右ペインレイアウト確認ログ

## 前提
- リポジトリ: tool-management-system02（branch: feature/client-socket-cutover）
- ブラウザ: Pi4 Chrome kiosk（1080px 幅）
- RaspberryPiServer 側は最新の `feature/server-app` を稼働

## 手順
1. Pi4 にて以下を実行しコードを更新。
   ```bash
   cd ~/tool-management-system02
   git pull --rebase origin feature/client-socket-cutover
   sudo systemctl restart toolmgmt.service
   ```
2. Chrome で右ペインをハードリロード（Ctrl+Shift+R）。
3. 要領書／所在一覧／構内物流タブを順に開き、レイアウト崩れがないか確認。
4. `docs/requirements.md` のステータス（✅）を更新。

## 結果
- タブヘッダの余白・ボタン配列が意図どおり復元され、各パネルが全面表示された。
- リロード後も崩れは再現せず。`view-switch` ボタンのスタイルがベーステンプレートへ統合されたことを確認。

## 備考
- CSS は `templates/layout/base.html` に統合し、preview 用 CSS との乖離を解消。
- 今後、右ペイン UI を変更する際は同テンプレートと `static/preview/right-panel.html` を同時に更新する。

## 追加メモ (Socket.IO ステータス)
- partLocations / logistics パネルのステータスチップに再接続表示を追加。Pi4 での断線シナリオ確認は次回メンテ時に実施。
- 2025-10-31 (再接続修正後): Socket.IO manager の reconnect イベントを監視するよう更新。Pi4 実機での再接続表示確認は次回実施予定。
