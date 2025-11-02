import { test, expect, type Page } from '@playwright/test';
import { loadEnv, snapshotEnv, requireEnv } from './utils/env.js';

loadEnv();

const env = snapshotEnv();
const missingRequired = !env.TOOLMGMT_BASE_URL || !env.RASPI_SERVER_BASE || !env.RASPI_SERVER_API_TOKEN;
const describeLive = missingRequired ? test.describe.skip : test.describe;

async function navigateToWindowA(page: Page) {
  const targetUrl = env.TOOLMGMT_BASE_URL!;
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      break;
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await page.waitForTimeout(1000);
    }
  }

  if (env.TOOLMGMT_API_TOKEN) {
    const tokenField = page.locator('input[type="password"]');
    if (await tokenField.isVisible()) {
      await tokenField.fill(env.TOOLMGMT_API_TOKEN);
      await page.locator('button:has-text("送信")').click();
    }
  }
}

describeLive('Window A live integration', () => {
  test.beforeAll(() => {
    requireEnv(['TOOLMGMT_BASE_URL', 'RASPI_SERVER_BASE', 'RASPI_SERVER_API_TOKEN']);
  });

  test('scan event updates part locations and viewer summary', async ({ page, request }) => {
    await navigateToWindowA(page);

    const partCode = `playwright-${Date.now()}`;
    const locationCode = 'RACK-A1';
    const deviceId = 'playwright-device';

    const response = await request.post(`${env.RASPI_SERVER_BASE}/api/v1/scans`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RASPI_SERVER_API_TOKEN}`,
      },
      data: {
        part_code: partCode,
        location_code: locationCode,
        device_id: deviceId,
      },
    });
    expect(response.ok()).toBeTruthy();

    await page.locator('.future-panel-body.active .view-switch button[data-target="partLocationsPanel"]').first().click();
    const partRow = page.locator(`#partLocationsTable tbody tr:has-text("${partCode}")`).first();
    await expect(partRow).toBeVisible({ timeout: 15_000 });
    await expect(partRow.locator('td').nth(1)).toHaveText(locationCode);
    await expect(partRow.locator('td').nth(2)).toHaveText(deviceId);

    const docViewerTab = page.locator('.future-panel-body.active .view-switch button[data-target="docViewerPanel"]').first();
    await docViewerTab.scrollIntoViewIfNeeded();
    await docViewerTab.click();
    const summary = page.locator('#docViewerSummary');
    await expect(summary).toHaveAttribute('data-state', /ready/, { timeout: 15_000 });
    await expect(page.locator('#docViewerSummaryLocation')).toContainText(locationCode);
    await expect(page.locator('#docViewerSummaryDevice')).toContainText(deviceId);
    await expect(page.locator('#docViewerPartChip')).toContainText(partCode);
  });

  test('logistics job update appears in logistics tab', async ({ page, request }) => {
    await navigateToWindowA(page);

    const testJobId = `playwright-${Date.now()}`;
    const response = await request.post(`${env.RASPI_SERVER_BASE}/api/logistics/jobs`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RASPI_SERVER_API_TOKEN}`,
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

    await page.locator('.future-panel-body.active .view-switch button[data-target="logisticsPanel"]').first().click();
    const jobRow = page.locator(`#logisticsTable tbody tr:has-text("${testJobId}")`).first();
    await expect(jobRow).toBeVisible({ timeout: 15_000 });
    await expect(jobRow.locator('td').first()).toContainText(testJobId);
  });
});
