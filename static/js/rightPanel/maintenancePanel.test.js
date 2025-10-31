import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { initMaintenancePanel } from './maintenancePanel.js';

function mountMaintenanceDom() {
  document.body.innerHTML = `
    <div id="usbSyncOverlay" class="modal-overlay" aria-hidden="true">
      <div class="modal-body">
        <p id="usbSyncOverlayMessage"></p>
      </div>
    </div>
    <div id="stationConfigMessage"></div>
    <div id="stationConfigMeta"></div>
    <div id="stationConfigNotice" class="station-meta is-hidden"></div>
    <select id="stationProcessSelect">
      <option value="">（未設定）</option>
      <option value="加工">加工</option>
    </select>
    <input id="stationNewProcessInput">
    <div id="stationAvailableList"></div>
    <div id="usbSyncOutput"></div>
    <button data-action="station-save"></button>
    <button data-action="station-add"></button>
    <button data-action="usb-sync"></button>
  `;
}

function createFetchResponse(data, ok = true) {
  return {
    ok,
    json: async () => data,
  };
}

describe('maintenancePanel', () => {
  beforeEach(() => {
    mountMaintenanceDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('saves station config successfully', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (url === '/api/station_config' && init.method === 'POST') {
        return createFetchResponse({
          process: '加工',
          available: ['加工'],
          path: '/etc/station.json',
          updated_at: '2025-10-31T00:00:00Z',
        });
      }
      return createFetchResponse({}, true);
    });

    const showMessage = vi.fn();
    const panel = initMaintenancePanel({
      initialConfig: { process: '', available: [] },
      fetchImpl,
      showMessage,
    });
    panel.refresh({ process: '', available: ['加工'], path: '/etc/station.json' });

    const stationSelect = document.getElementById('stationProcessSelect');
    stationSelect.value = '加工';

    const saveButton = document.querySelector('[data-action="station-save"]');
    saveButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/station_config',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ process: '加工', available: ['加工'] }),
      }),
    );
    const successCall = showMessage.mock.calls.find(([level]) => level === 'success');
    expect(successCall).toBeTruthy();
    expect(successCall[1]).toBe('工程設定を保存しました');
    const meta = document.getElementById('stationConfigMeta').innerHTML;
    expect(meta).toContain('/etc/station.json');
  });

  it('runs USB sync and shows overlay', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/usb_sync') {
        return createFetchResponse({
          status: 'success',
          steps: [
            { title: 'sync', returncode: 0, stdout: 'ok' },
          ],
        });
      }
      return createFetchResponse({}, true);
    });
    const showMessage = vi.fn();
    const panel = initMaintenancePanel({ fetchImpl, showMessage });

    const overlay = document.getElementById('usbSyncOverlay');
    expect(overlay.classList.contains('is-visible')).toBe(false);

    await panel.runUsbSync();

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/usb_sync',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ device: '/dev/sda1' }),
      }),
    );
    const [level, message] = showMessage.mock.calls.at(-1);
    expect(level).toBe('success');
    expect(message).toBe('USB同期が完了しました');
    expect(overlay.classList.contains('is-visible')).toBe(false);
    expect(document.getElementById('usbSyncOutput').textContent).toContain('sync');
  });
});
