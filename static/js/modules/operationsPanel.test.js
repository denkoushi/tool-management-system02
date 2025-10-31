import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { initOperationsPanel } from './operationsPanel.js';
import { requestJSON } from './httpClient.js';

vi.mock('./httpClient.js', () => ({
  requestJSON: vi.fn(),
}));

function mountOperationsDom() {
  document.body.innerHTML = `
    <div id="operations" class="tab-content active">
      <div class="operation-header">
        <div class="operation-controls">
          <div class="button-row">
            <button id="startScanBtn"></button>
            <button id="stopScanBtn"></button>
            <button id="resetScanBtn"></button>
          </div>
          <span id="scanStatus" class="status-indicator status-inactive">● 停止中</span>
        </div>
      </div>
      <div class="scan-progress">
        <div class="scan-step">
          <div id="userDisplay" class="scan-display"></div>
        </div>
        <div class="scan-step">
          <div id="toolDisplay" class="scan-display"></div>
        </div>
      </div>
      <div id="scanMessage"></div>
      <div id="transactionResult"></div>
      <div class="bottom-tables">
        <div class="table-section">
          <div class="scrollable-section">
            <table id="openLoansTable"><tbody></tbody></table>
          </div>
        </div>
        <div id="historySection" class="table-section table-section--history is-hidden">
          <div class="scrollable-section">
            <table id="historyTable"><tbody></tbody></table>
          </div>
        </div>
      </div>
    </div>
  `;
}

describe('operationsPanel', () => {
  beforeEach(() => {
    mountOperationsDom();
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('loads loan data into tables', async () => {
    requestJSON.mockImplementation(async (url) => {
      if (url === '/api/loans') {
        return {
          data: {
            open_loans: [
              { id: '1', tool: 'カッター', tool_uid: 'tool-1', borrower: '山田', loaned_at: '2025-10-31T01:23:00Z' },
            ],
            history: [
              { action: '返却', tool: 'カッター', borrower: '山田', returned_at: '2025-10-31T02:00:00Z' },
            ],
          },
        };
      }
      return { data: {} };
    });

    const showMessage = vi.fn();
    const panel = initOperationsPanel({ showMessage });
    await panel.loadLoansData();

    const openRows = document.querySelectorAll('#openLoansTable tbody tr');
    const historyRows = document.querySelectorAll('#historyTable tbody tr');
    expect(openRows).toHaveLength(1);
    expect(historyRows).toHaveLength(1);
    expect(openRows[0].querySelector('td')?.textContent).toBe('カッター');
    expect(showMessage).not.toHaveBeenCalled();
  });

  it('start and stop scan toggle status indicator', async () => {
    requestJSON.mockImplementation(async (url) => {
      if (url === '/api/start_scan' || url === '/api/stop_scan') {
        return { data: {} };
      }
      if (url === '/api/loans') {
        return { data: { open_loans: [], history: [] } };
      }
      return { data: {} };
    });

    const panel = initOperationsPanel({ showMessage: vi.fn() });
    const appScan = panel.getAppScan();

    const started = await appScan.start('loan');
    expect(started).toBe(true);
    expect(requestJSON).toHaveBeenCalledWith('/api/start_scan', expect.objectContaining({ method: 'POST' }));

    const status = document.getElementById('scanStatus');
    expect(status.textContent).toBe('● スキャン中');
    expect(status.classList.contains('status-active')).toBe(true);

    const stopped = await appScan.stop();
    expect(stopped).toBe(true);
    expect(requestJSON).toHaveBeenCalledWith('/api/stop_scan', expect.objectContaining({ method: 'POST' }));
    expect(status.textContent).toBe('● 停止中');
    expect(status.classList.contains('status-inactive')).toBe(true);
  });

  it('notifies when scan start fails', async () => {
    requestJSON.mockImplementation(async (url) => {
      if (url === '/api/start_scan') {
        const error = new Error('start failed');
        error.status = 500;
        throw error;
      }
      if (url === '/api/loans') {
        return { data: { open_loans: [], history: [] } };
      }
      return { data: {} };
    });

    const showMessage = vi.fn();
    const panel = initOperationsPanel({ showMessage });
    const appScan = panel.getAppScan();

    const started = await appScan.start('loan');
    expect(started).toBe(false);
    expect(showMessage).toHaveBeenCalledWith('scanMessage', 'start failed', 'danger');

    const status = document.getElementById('scanStatus');
    expect(status.textContent).toBe('● 停止中');
    expect(status.classList.contains('status-inactive')).toBe(true);
  });
});
