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
| ★★☆ | DocumentViewer エラー表示 | 登録されていない部品番号で `/api/v1/scans` を呼び出し、DocumentViewer iframe のオーバーレイとステータスチップが `viewer-message` の内容に更新されることを確認する |

## 2. 環境準備

- Playwright（Chromium）を採用し、ヘッドレス／ヘッドフルは環境変数で切り替える（初回は `npx playwright install chromium` を実行）。
- RaspberryPiServer（Pi5）と Window A（Pi4）の実機サービスを systemd で起動した状態を前提にし、API トークンなどの接続情報は `.env.test` に集約する。サンプルとして `.env.test.sample` をリポジトリ直下に配置済み。
- 環境変数の読み込みは `tests/e2e/utils/env.ts` で行い、`PLAYWRIGHT_ENV_FILE` を指定すれば任意パスの設定ファイルを利用できる。Playwright 設定（`tests/e2e/playwright.config.ts`）からは `loadEnv()` / `snapshotEnv()` を通じて参照する。
- 主要な環境変数は以下の通り。

| 変数名 | 用途 | 備考 |
| --- | --- | --- |
| `TOOLMGMT_BASE_URL` | Window A UI へのアクセス URL | 例: `http://raspi-window-a.local:8501` |
| `TOOLMGMT_API_TOKEN` | Window A UI に表示される API トークン入力欄用 | トークン入力ダイアログが無効なら空で可 |
| `RASPI_SERVER_BASE` | Pi5 REST / Socket.IO のベース URL | 例: `http://raspi-server.local:8501` |
| `RASPI_SERVER_API_TOKEN` | Pi5 の API 認証トークン | `/etc/default/raspi-server` と一致させる |
| `VIEWER_API_TOKEN` | DocumentViewer API が別トークンを要求する場合の予備枠 | 現状未使用 |
| `PLAYWRIGHT_HEADLESS` | `1` でヘッドレス、`0` でブラウザを表示 | 既定は `1` |

- プレビュー用 HTML（`static/preview/right-panel.html`）を対象にした軽量スモークテストが `tests/e2e/smoke.spec.ts` にあり、実機 API と連携する流れは `tests/e2e/window-a-live.spec.ts` の骨子に集約する方針。
- `tests/e2e/window-a-live.spec.ts` は必要な環境変数が未指定の場合に自動で `describe.skip` されるため、通常の CI では影響せず、ライブ検証時のみ `.env.test` を準備して実行する。
- GitHub Actions での自動実行は未定だが、ローカル／Pi 両方で手動実行できるよう `npm run test:e2e` スクリプトを定義済み。プレビューのみを実行したい場合は `RUN_PREVIEW_E2E=1 npm run test:e2e`、ライブ系のみを試す場合は `npx playwright test tests/e2e/window-a-live.spec.ts --config=tests/e2e/playwright.config.ts` を使用する。

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

`npm run test:e2e` は `playwright test --config=tests/e2e/playwright.config.ts` を呼び出す。Pi4 / Pi5 実機と連携する際は `.env.test` を作成した上で `PLAYWRIGHT_ENV_FILE=.env.test npm run test:e2e -- tests/e2e/window-a-live.spec.ts` のように対象ファイルを絞ると確実に検証できる。

## 4. スクリプト雛形

`tests/e2e/window-a-live.spec.ts` に下記のような骨子を置き、実装時に `test.describe.skip` を解除する。

```typescript
import { test, expect } from '@playwright/test';
import { snapshotEnv, requireEnv } from './utils/env.js';

test.describe.skip('Window A live flow', () => {
  const env = snapshotEnv();

  test.beforeAll(() => {
    requireEnv(['TOOLMGMT_BASE_URL', 'RASPI_SERVER_BASE', 'RASPI_SERVER_API_TOKEN']);
  });

  test('scan event propagates to viewer', async ({ page, request }) => {
    await page.goto(env.TOOLMGMT_BASE_URL!);

    if (env.TOOLMGMT_API_TOKEN) {
      const tokenField = page.locator('input[type="password"]');
      if (await tokenField.isVisible()) {
        await tokenField.fill(env.TOOLMGMT_API_TOKEN);
        await page.locator('button:has-text("送信")').click();
      }
    }

    await request.post(`${env.RASPI_SERVER_BASE}/api/v1/scans`, {
      headers: { Authorization: `Bearer ${env.RASPI_SERVER_API_TOKEN}`, 'Content-Type': 'application/json' },
      data: { part_code: 'testpart', location_code: 'RACK-A1', device_id: 'playwright-device' },
    });

    await page.locator('[data-target="partLocationsPanel"]').click();
    await expect(page.locator('#partLocationsTable tbody tr').first()).toContainText('testpart');
  });
});
```

## 5. TODO

- [x] Playwright の依存関係追加と `package.json` スクリプト更新（`test:e2e`）。
- [x] `.env.test` サンプル (`.env.test.sample`) とフィクスチャユーティリティ（`tests/e2e/utils/env.ts`）の実装。
- [ ] 上記シナリオをベースにしたテスト実装＆実機（Window A / RaspberryPiServer）での動作検証。※ `tests/e2e/window-a-live.spec.ts` へのスキャン・物流タブ・DocumentViewer エラーオーバーレイ検証を追加済み。定期的な実機実行と結果記録が未着手。
- [x] `/api/logistics/jobs` を利用した構内物流タブの検証ケースを Playwright に実装し、Socket.IO イベントの反映を確認する。※ `tests/e2e/window-a-live.spec.ts` でジョブ作成→テーブル表示を検証済み。
- [ ] GitHub Actions での自動実行要否の検討（長時間化を避けるため、手動実行から開始予定）。
