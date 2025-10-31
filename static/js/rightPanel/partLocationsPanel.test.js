import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { initPartLocations } from './partLocationsPanel.js';

vi.mock('./socketClient.js', () => ({
  bindSocketLifecycle: vi.fn((socket, callbacks = {}) => {
    if (!socket || typeof socket.on !== 'function') return;
    const { onConnect, onDisconnect, onError } = callbacks;
    if (onConnect) socket.on('connect', onConnect);
    if (onDisconnect) socket.on('disconnect', onDisconnect);
    if (onError) socket.on('connect_error', onError);
  }),
}));

const originalCSS = global.CSS;
const originalSetInterval = global.setInterval;

function mountDom({ active = false } = {}) {
  document.body.innerHTML = `
    <section id="partLocationsPanel" class="${active ? 'active' : ''}">
      <div id="partLocationsMessage"></div>
      <button id="partLocationRefreshBtn" type="button">refresh</button>
      <span id="partLocationSocketStatus" data-state="loading"></span>
      <span id="partLocationCount"></span>
      <span id="partLocationLastUpdated"></span>
      <table id="partLocationsTable">
        <tbody></tbody>
      </table>
      <div id="partLocationsEmpty"></div>
    </section>
  `;
}

function createSocket(connected = true) {
  const listeners = {};
  const socket = {
    connected,
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    io: {},
  };
  return { socket, listeners };
}

describe('partLocationsPanel', () => {
  beforeEach(() => {
    global.CSS = { escape: (value) => value };
    global.setInterval = vi.fn(() => 0);
    mountDom({ active: true });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    global.CSS = originalCSS;
    global.setInterval = originalSetInterval;
  });

  it('refreshes part locations via REST API', async () => {
    const { socket } = createSocket(true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            order_code: 'A-100',
            location_code: 'RACK-1',
            device_id: 'window-a',
            scanned_at: '2025-10-31T00:00:00Z',
            updated_at: '2025-10-31T00:01:00Z',
          },
        ],
      }),
    }));

    const panel = initPartLocations({
      socket,
      socketOptions: { autoConnect: false },
      fetchImpl,
      initialData: [],
    });

    await panel.refresh();

    expect(fetchImpl).toHaveBeenCalledWith('/api/part_locations?limit=200');
    const rows = document.querySelectorAll('#partLocationsTable tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll('td')[0].textContent).toBe('A-100');
    expect(document.getElementById('partLocationCount').textContent).toContain('1');
    expect(document.getElementById('partLocationsEmpty').style.display).toBe('none');
  });

  it('updates table when socket event arrives', () => {
    const { socket, listeners } = createSocket(true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [] }),
    }));

  initPartLocations({
    socket,
    socketOptions: { autoConnect: true },
    fetchImpl,
    initialData: [],
  });

  listeners.part_location_updated?.({
    order_code: 'ZX-999',
      location_code: 'A-01',
      device_id: 'pi-zero',
      scanned_at: '2025-10-31T00:10:00Z',
      updated_at: '2025-10-31T00:10:05Z',
    });

    const rows = document.querySelectorAll('#partLocationsTable tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains('is-flash')).toBe(true);
    expect(document.getElementById('partLocationsMessage').innerHTML).toContain('ZX-999');
    expect(document.getElementById('partLocationSocketStatus').dataset.state).toBe('live');
  });

  it('shows error message when REST refresh fails', async () => {
    const { socket } = createSocket(false);
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'failed' }),
    }));

    const panel = initPartLocations({
      socket,
      socketOptions: { autoConnect: false },
      fetchImpl,
      initialData: [],
    });

    await panel.refresh();

    expect(document.getElementById('partLocationsMessage').innerHTML).toContain('failed');
    expect(document.getElementById('partLocationsEmpty').style.display).not.toBe('none');
    expect(document.getElementById('partLocationSocketStatus').dataset.state).toBe('disabled');
  });

  it('updates socket status on disconnect', () => {
    const { socket, listeners } = createSocket(true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [] }),
    }));

    initPartLocations({
      socket,
      socketOptions: { autoConnect: true },
      fetchImpl,
      initialData: [],
    });

    listeners.connect?.();
    expect(document.getElementById('partLocationSocketStatus').dataset.state).toBe('live');

    listeners.disconnect?.();
    expect(document.getElementById('partLocationSocketStatus').dataset.state).toBe('offline');

    listeners.connect_error?.();
    expect(document.getElementById('partLocationSocketStatus').dataset.state).toBe('error');
  });
});
