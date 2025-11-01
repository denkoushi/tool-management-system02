import { test, expect } from '@playwright/test';
import { snapshotEnv, requireEnv } from './utils/env.js';

/**
 * Live integration spec skeleton.
 * 実機（Window A + RaspberryPiServer）で実行する際に `describe.skip` を解除し、
 * 必要な DOM セレクタやアサーションをプロジェクト状況に合わせて調整してください。
 */

const env = snapshotEnv();

test.describe.skip('Window A live integration', () => {
  test.beforeAll(() => {
    requireEnv(['TOOLMGMT_BASE_URL', 'RASPI_SERVER_BASE', 'RASPI_SERVER_API_TOKEN']);
  });

  test('scan event propagates to viewer highlight', async ({ page, request }) => {
    const baseUrl = env.TOOLMGMT_BASE_URL!;
    const apiBase = env.RASPI_SERVER_BASE!;
    const apiToken = env.RASPI_SERVER_API_TOKEN!;
    const partCode = 'testpart';
    const locationCode = 'RACK-A1';
    const deviceId = 'playwright-device';

    await page.goto(baseUrl);

    if (env.TOOLMGMT_API_TOKEN) {
      const tokenField = page.locator('input[type="password"]');
      if (await tokenField.isVisible()) {
        await tokenField.fill(env.TOOLMGMT_API_TOKEN);
        await page.locator('button:has-text("送信")').click();
      }
    }

    const response = await request.post(`${apiBase}/api/v1/scans`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        part_code: partCode,
        location_code: locationCode,
        device_id: deviceId,
      },
    });

    expect(response.ok()).toBeTruthy();

    await page.locator('[data-target="partLocationsPanel"]').click();
    await expect(page.locator('#partLocationsTable tbody tr').first()).toContainText(partCode);

    await page.locator('[data-target="docViewerPanel"]').click();
    await expect(page.locator('.viewer-highlight-chip')).toContainText(partCode);
  });

  test('logistics job update appears in logistics tab', async ({ page, request }) => {
    const baseUrl = env.TOOLMGMT_BASE_URL!;
    const apiBase = env.RASPI_SERVER_BASE!;
    const apiToken = env.RASPI_SERVER_API_TOKEN!;
    const testJobId = `playwright-${Date.now()}`;

    await page.goto(baseUrl);

    const response = await request.post(`${apiBase}/api/logistics/jobs`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        job_id: testJobId,
        part_code: 'logistics-part',
        from_location: 'ZONE-A',
        to_location: 'ZONE-B',
        status: 'pending',
      },
    });
    expect(response.ok()).toBeTruthy();

    await page.locator('[data-target="logisticsPanel"]').click();
    const row = page.locator('#logisticsTable tbody tr').first();
    await expect(row).toContainText(testJobId);
  });
});
