# E2E テスト方針（Window A クライアント）

RaspberryPiServer 側へサーバー機能を切り出した後も、Window A クライアントの UI 操作が期待通りに動作することを継続的に確認するため、Playwright ベースのエンドツーエンドテストを導入する計画を以下に整理する。

## 1. 対象フロー

| 優先度 | シナリオ概要 | 詳細手順 |
| --- | --- | --- |
| ★★★ | ハンディスキャン → 所在一覧反映 → DocumentViewer 表示 | `POST /api/v1/scans` を模擬し、所在一覧タブが更新されること、右ペインの Viewer がハイライトを受け取ることを確認する |
| ★★★ | 構内物流タスクの受信 → 物流タブ更新 | `/api/logistics/jobs` に搬送ジョブを POST し、物流タブのテーブル・バッジ・メッセージが更新されること、Socket.IO イベント (`logistics_job_updated`) が即時反映されることを確認する |
| ★★☆ | 工程設定の更新 | メンテナンスタブで工程を追加・保存し、`station.json` と Viewer への通知が反映されることを確認する |
| ★★☆ | タグ登録ワークフロー | タグ確認 → ユーザー登録 → アイテム登録の3段階を通しで検証し、API への POST が成功してトースト表示が切り替わることを確認する |
| ★☆☆ | USB 同期エラー時の警告 | `/api/usb_sync` がエラーを返した場合にオーバーレイとメッセージが期待通り表示されるか確認する |

## 2. 環境準備

- Playwright（Chromium）を採用し、ヘッドレス＆ヘッドフルを切り替え可能にする（`npx playwright install chromium`）。
- RaspberryPiServer・Window A クライアント双方を `docker compose` / systemd 上で起動したテスト用環境を想定。API トークンは `.env.test` で管理。
- `tests/e2e/fixtures/env.mjs`（未作成）に API ベース URL / トークン / テストユーザーなどを集約し、実環境との差分を最小化する。
- プレビュー用 HTML（`static/preview/right-panel.html`）を対象にした軽量スモークテストを `tests/e2e/smoke.spec.ts` として追加済み。実機 API と連携するフローを追加する場合は、ここから拡張する。
- GitHub Actions での自動実行は未定だが、ローカル・Raspberry Pi 双方で手動実行できるよう `npm run test:e2e` スクリプトを追加済み（`tests/e2e/playwright.config.ts` を参照）。`SKIP_PREVIEW_E2E=1 npm run test:e2e` でプレビュー系テストのみスキップ可能。

## 3. 実行イメージ

```bash
# 事前に Playwright を導入（初回のみ）
npm install @playwright/test --save-dev
npx playwright install chromium

# .env.test に API ベース URL とトークンを記述
cp config/window-a-client.env.sample .env.test

# RaspberryPiServer / tool-management-system02 をテストモードで起動
sudo systemctl restart postgres docker
sudo systemctl restart toolmgmt.service

# E2E テストを実行
npm run test:e2e
```

`npm run test:e2e` は `playwright test --config=tests/e2e/playwright.config.ts` を呼び出す。ブラウザを初回実行前に `npx playwright install chromium` でインストールしておく。
プレビュー専用テストを有効化する場合は `RUN_PREVIEW_E2E=1 npm run test:e2e` を使用する（未指定時はスキップされる）。

## 4. スクリプト雛形

`tests/e2e/smoke.spec.mjs` に下記のような骨子を置き、実装時に `test.skip` を解除する。

```javascript
import { test, expect } from '@playwright/test';

test.describe.skip('Window A smoke flow', () => {
  test('scan event propagates to viewer', async ({ page }) => {
    await page.goto(process.env.TOOLMGMT_BASE_URL);

    // 認証トークン入力（必要に応じて）
    if (await page.getByText('APIトークン').isVisible()) {
      await page.fill('input[type="password"]', process.env.TOOLMGMT_API_TOKEN);
      await page.click('button:has-text("送信")');
    }

    // REST API を叩いて疑似スキャン
    await page.request.post(`${process.env.RASPI_SERVER_BASE}/api/v1/scans`, {
      headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
      data: {
        part_code: 'testpart',
        location_code: 'RACK-A1',
        device_id: 'preview-device',
      },
    });

    // 所在一覧タブを開き、反映を待つ
    await page.locator('[data-target="partLocationsPanel"]').click();
    await expect(page.locator('#partLocationsTable tbody tr').first()).toContainText('testpart');

    // DocumentViewer 側もハイライトが更新されることを確認
    await page.locator('[data-target="docViewerPanel"]').click();
    await expect(page.locator('#docViewerPartChip')).toContainText('testpart');
  });
});
```

## 5. TODO

- [ ] Playwright の依存関係追加と `package.json` スクリプト更新（`test:e2e`）。
- [ ] `.env.test` サンプルとフィクスチャユーティリティの実装。
- [ ] 上記シナリオをベースにしたテスト実装＆実機（Window A / RaspberryPiServer）での動作検証。
- [ ] `/api/logistics/jobs` を利用した構内物流タブの検証ケースを Playwright に実装し、Socket.IO イベントの反映を確認する。
- [ ] GitHub Actions での自動実行要否の検討（長時間化を避けるため、手動実行から開始予定）。
