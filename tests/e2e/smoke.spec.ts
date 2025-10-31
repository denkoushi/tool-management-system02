// @ts-nocheck
import { test, expect } from '@playwright/test';
import httpServer from 'http-server';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..');

let previewServer;
let httpInstance;

function logPreviewConsole(page) {
  page.on('console', (msg) => console.log('[preview-console]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[preview-error]', err.message));
}

const shouldSkip = process.env.RUN_PREVIEW_E2E !== '1';
const describePreview = shouldSkip ? test.describe.skip : test.describe;

describePreview('Right panel preview smoke', () => {
  test.beforeAll(async () => {
    previewServer = httpServer.createServer({
      root: rootDir,
      cache: -1,
      showDir: false,
      cors: true,
      silent: true,
    });

    await new Promise((resolveStart, rejectStart) => {
      httpInstance = previewServer.server;
      const onError = (err) => {
        httpInstance?.off('error', onError);
        rejectStart(err);
      };
      httpInstance.on('error', onError);
      httpInstance.listen(4173, '127.0.0.1', () => {
        httpInstance.off('error', onError);
        resolveStart();
      });
    });
  });

  test.afterAll(async () => {
    if (httpInstance) {
      await new Promise((resolveStop) => httpInstance.close(resolveStop));
      httpInstance = null;
      previewServer = null;
    }
  });

  test('REST refresh and viewer highlight flow', async ({ page }) => {
    logPreviewConsole(page);

    await page.goto('http://127.0.0.1:4173/static/preview/right-panel.html');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => window.__previewHelpers !== undefined);

    const restPayload = {
      order_code: `E2E-${Date.now()}`,
      location_code: 'RACK-E2E',
      device_id: 'preview-device',
      scanned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await page.evaluate((payload) => window.__previewHelpers.refreshWith([payload]), restPayload);

    await expect(page.locator('#partLocationsTable tbody tr').first()).toContainText(restPayload.order_code);
    await expect(page.locator('#partLocationCount')).toContainText('1');

    const socketPayload = {
      order_code: restPayload.order_code,
      location_code: 'RACK-E2E-2',
      device_id: 'socket-device',
      scanned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await page.evaluate((payload) => window.__previewHelpers.triggerSocketUpdate(payload), socketPayload);
    await expect(page.locator('#partLocationsMessage')).toContainText(socketPayload.order_code);

    await page.evaluate((payload) => window.__previewHelpers.setViewerState({ part: payload, state: 'viewer' }), socketPayload.order_code);
    await expect(page.locator('#docViewerPartChip')).toContainText(socketPayload.order_code);
    await expect(page.locator('#docViewerStateChip')).toContainText('表示中');

    await page.evaluate(() => window.__previewHelpers.notifyStationChange({ process: '加工', available: ['加工'] }));
    await expect(page.locator('#docViewerOverlay')).toHaveClass(/is-hidden/);

    const logisticsRestPayload = {
      job_id: `JOB-${Date.now()}`,
      part_code: 'LOGI-REST',
      from_location: '倉庫-R',
      to_location: '組立-R',
      status: 'pending',
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await page.evaluate((payload) => window.__previewHelpers.refreshLogisticsWith([payload]), logisticsRestPayload);
    await expect(page.locator('#logisticsTable tbody tr').first()).toContainText(logisticsRestPayload.job_id);
    await expect(page.locator('#logisticsTaskCount')).toContainText('1');

    const logisticsSocketPayload = {
      job_id: `${logisticsRestPayload.job_id}-S`,
      part_code: 'LOGI-SOCKET',
      from_location: '倉庫-S',
      to_location: '組立-S',
      status: 'in_transit',
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await page.evaluate((payload) => window.__previewHelpers.triggerLogisticsSocketUpdate(payload), logisticsSocketPayload);
    await expect(page.locator('#logisticsMessage')).toContainText(logisticsSocketPayload.job_id);
  });
});
