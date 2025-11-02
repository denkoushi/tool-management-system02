# 2025-11-05 DocumentViewer オーバーレイエラー検証（Window A）

## 前提
- Window A (Pi4) リポジトリ: `tool-management-system02` ブランチ `feature/client-socket-cutover`
- RaspberryPiServer (Pi5) リポジトリ: `RaspberryPiServer` ブランチ `feature/server-app`
- `docs/right-pane-plan.md` のステータスに従い、`viewer-message` postMessage 実装を適用済み
- Node.js 20 系、`npm install` 済み

## 手順
1. Window A リポジトリでユニットテストを実行。
   ```bash
   cd ~/tool-management-system02
   npm run test:js
   ```
2. テスト結果を確認し、`static/js/rightPanel/docViewerPanel.test.js` の新規ケースが PASS していることをチェック。

## 結果
- `viewer-message` エラーを受け取った際にオーバーレイへテキストを表示し、HTML がエスケープされることを Vitest で確認。
- 情報メッセージ受信時はロックされていないオーバーレイが自動で閉じること、ロックされたオーバーレイは保持されることをテストで保証。
- 実行時間: 1.40s / 32 tests PASS（`vitest run` 出力より）。
- Pi4 ブラウザで存在しない部品番号 `NO1` を入力したところ、赤色オーバーレイに「PDF が見つかりません。USB 取り込みとファイル名をご確認ください。」が表示され、ステータスチップが「状態: エラー」、部品チップが「部品番号: NO1」に更新された（実機スクリーンショット取得）。

## 備考
- `docs/requirements.md` の「DocumentViewer iframe のフォールバックメッセージ改善」タスクを完了とし、`docs/right-pane-plan.md` の未完タスクも更新済み。
- Pi4 実機での再確認（Playwright）は次回リリース候補に合わせて実施する。
