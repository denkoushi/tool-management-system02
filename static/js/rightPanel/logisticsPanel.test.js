import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { initLogisticsPanel } from './logisticsPanel.js';
import { __resetSocketStateForTests } from './socketStatusManager.js';

vi.stubGlobal('CSS', { escape: (value) => value });

function mountDom({ active = true } = {}) {
  document.body.innerHTML = `
    <section id="logisticsPanel" class="future-panel-body future-panel-body--logistics${active ? ' active' : ''}">
      <div>
        <div id="logisticsMessage"></div>
        <span id="logisticsSocketStatus" data-state="loading" data-socket-chip="logistics"></span>
        <span id="logisticsTaskCount"></span>
        <span id="logisticsLastUpdated"></span>
        <button id="logisticsRefreshBtn">refresh</button>
        <span class="logistics-tab-badge"></span>
        <table id="logisticsTable"><tbody></tbody></table>
        <div id="logisticsEmpty"></div>
      </div>
    </section>
  `;
}

describe('logisticsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSocketStateForTests();
    mountDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    __resetSocketStateForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('hydrates initial jobs', () => {
    const panel = initLogisticsPanel({
      initialData: [
        {
          job_id: 'JOB-1',
          part_code: 'PART-A',
          from_location: '受入',
          to_location: '組立',
          status: 'pending',
          requested_at: '2025-10-31T11:55:00Z',
          updated_at: '2025-10-31T12:00:00Z',
        },
      ],
    });

    expect(panel).toBeTruthy();
    const rows = document.querySelectorAll('#logisticsTable tbody tr');
    expect(rows).toHaveLength(1);
    expect(document.getElementById('logisticsTaskCount').textContent).toContain('1');
    const statusCell = rows[0].querySelectorAll('td')[4];
    expect(statusCell.textContent).toBe('待機中');
  });

  it('refreshes from REST API', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            job_id: 'JOB-2',
            part_code: 'PART-B',
            from_location: '倉庫',
            to_location: '加工',
            status: 'completed',
            requested_at: '2025-10-31T12:10:00Z',
            updated_at: '2025-10-31T12:30:00Z',
          },
        ],
      }),
    }));

    const panel = initLogisticsPanel({ fetchImpl });
    await panel.refresh();

    const rows = document.querySelectorAll('#logisticsTable tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('td').textContent).toBe('JOB-2');
    const cells = rows[0].querySelectorAll('td');
    expect(cells[4].textContent).toBe('完了');
    expect(cells[5].textContent).toContain('2025/10/31');
    expect(document.getElementById('logisticsMessage').innerHTML).toContain('更新しました');
  });

  it('handles refresh errors gracefully', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'failed' }),
    }));

    const panel = initLogisticsPanel({ fetchImpl });
    await panel.refresh();

    expect(document.getElementById('logisticsMessage').innerHTML).toContain('構内物流タスクの取得に失敗しました');
  });

  it('updates via socket event', () => {
    const socket = {
      on: vi.fn((event, handler) => {
        if (event === 'logistics_job_updated') {
          handler({
            job_id: 'SOCKET-1',
            part_code: 'PART-Z',
            from_location: '受入',
            to_location: '出荷',
            status: 'in_transit',
            requested_at: '2025-10-31T12:45:00Z',
            updated_at: '2025-10-31T13:00:00Z',
          });
        }
      }),
    };

    initLogisticsPanel({ socket });
    const rows = document.querySelectorAll('#logisticsTable tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('td').textContent).toBe('SOCKET-1');
    expect(rows[0].querySelectorAll('td')[4].textContent).toBe('搬送中');
    expect(document.getElementById('logisticsMessage').innerHTML).toContain('搬送更新');
  });
});
