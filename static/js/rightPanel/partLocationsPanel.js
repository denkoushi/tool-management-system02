import { bindSocketLifecycle } from './socketClient.js';

export function initPartLocations({
  socket,
  socketOptions,
  fetchImpl = window.fetch.bind(window),
  initialData = [],
  selectors = {},
}) {
  const el = {
    panel: document.getElementById('partLocationsPanel'),
    tableBody: document.querySelector('#partLocationsTable tbody'),
    empty: document.getElementById('partLocationsEmpty'),
    message: document.getElementById('partLocationsMessage'),
    count: document.getElementById('partLocationCount'),
    lastUpdated: document.getElementById('partLocationLastUpdated'),
    refreshBtn: document.getElementById('partLocationRefreshBtn'),
    socketStatus: document.getElementById('partLocationSocketStatus'),
    tabBadges: Array.from(document.querySelectorAll('.partlocations-tab-badge')),
    ...selectors,
  };

  const state = {
    rows: new Map(),
    messageTimer: null,
    highlightTimer: null,
    lastHighlight: null,
    lastRender: 0,
    fetchInFlight: false,
  };

  const formatter = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium' });

  const cssEscape = window.CSS && typeof window.CSS.escape === 'function'
    ? window.CSS.escape.bind(window.CSS)
    : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');

  function parseTimestamp(value) {
    if (!value) return null;
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function formatTimestamp(value) {
    const dt = parseTimestamp(value);
    return dt ? formatter.format(dt) : '—';
  }

  function normalize(entry) {
    if (!entry || !entry.order_code) return null;
    const scanned = entry.scanned_at || entry.scannedAt || null;
    const updated = entry.updated_at || entry.updatedAt || scanned;
    return {
      order_code: entry.order_code,
      location_code: entry.location_code || '',
      device_id: entry.device_id || '',
      scan_id: entry.scan_id || entry.last_scan_id || '',
      scanned_at: scanned,
      updated_at: updated,
    };
  }

  function render({ highlightKey } = {}) {
    if (!el.tableBody) return;
    const entries = Array.from(state.rows.values()).sort((a, b) => {
      const aTime = parseTimestamp(a.updated_at)?.getTime() || 0;
      const bTime = parseTimestamp(b.updated_at)?.getTime() || 0;
      return bTime - aTime;
    });

    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const tr = document.createElement('tr');
      tr.dataset.key = entry.order_code;
      [
        entry.order_code,
        entry.location_code || '-',
        entry.device_id || '-',
        formatTimestamp(entry.scanned_at),
        formatTimestamp(entry.updated_at),
      ].forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    }

    el.tableBody.innerHTML = '';
    el.tableBody.appendChild(fragment);

    if (el.count) el.count.textContent = `件数: ${entries.length}`;
    (el.tabBadges || []).forEach((badge) => { if (badge) badge.textContent = entries.length; });
    if (el.lastUpdated) {
      const latest = entries.length ? entries[0].updated_at : null;
      el.lastUpdated.textContent = `最終更新: ${latest ? formatTimestamp(latest) : '—'}`;
    }
    if (el.empty) {
      el.empty.style.display = entries.length ? 'none' : 'block';
    }

    const targetKey = highlightKey || state.lastHighlight;
    if (targetKey) {
      state.lastHighlight = targetKey;
      const selector = `tr[data-key="${cssEscape(targetKey)}"]`;
      const row = el.tableBody.querySelector(selector);
      if (row) {
        row.classList.add('is-flash');
        if (state.highlightTimer) clearTimeout(state.highlightTimer);
        state.highlightTimer = setTimeout(() => {
          row.classList.remove('is-flash');
          state.highlightTimer = null;
        }, 2200);
      }
    }

    state.lastRender = Date.now();
  }

  function showMessage(level, message, duration = 5000) {
    const container = el.message;
    if (!container) return;
    const classes = {
      success: 'alert-success',
      info: 'alert-info',
      warning: 'alert-warning',
      danger: 'alert-danger',
    };
    container.innerHTML = `<div class="alert ${classes[level] || classes.info}">${message}</div>`;
    if (state.messageTimer) clearTimeout(state.messageTimer);
    if (duration) {
      state.messageTimer = setTimeout(() => {
        if (container.innerHTML.includes(message)) container.innerHTML = '';
      }, duration);
    }
  }

  function setSocketStatus(status, label) {
    const target = el.socketStatus;
    if (!target) return;
    const messages = {
      live: 'LIVE',
      offline: 'OFFLINE',
      loading: '接続確認中…',
      reconnect: '再接続中…',
      disabled: 'DISABLED',
      error: 'ERROR',
    };
    if (socketOptions && socketOptions.autoConnect === false && status !== 'disabled') {
      status = 'disabled';
      label = messages.disabled;
    }
    target.dataset.state = status;
    target.textContent = label || messages[status] || '—';
  }

  async function refresh() {
    if (state.fetchInFlight) return;
    state.fetchInFlight = true;
    if (el.refreshBtn) el.refreshBtn.disabled = true;
    if (socketOptions && socketOptions.autoConnect !== false) setSocketStatus('loading', '更新中…');
    try {
      const res = await fetchImpl('/api/part_locations?limit=200');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '所在一覧の取得に失敗しました');
      state.rows.clear();
      (data.items || []).forEach((item) => {
        const normalized = normalize(item);
        if (normalized) state.rows.set(normalized.order_code, normalized);
      });
      render();
      if (el.panel && el.panel.classList.contains('active')) {
        showMessage('success', `所在一覧を更新しました（${(data.items || []).length}件）`, 3000);
      }
    } catch (err) {
      console.error('part_locations refresh error', err);
      showMessage('danger', err.message || String(err));
    } finally {
      if (el.refreshBtn) el.refreshBtn.disabled = false;
      if (socketOptions && socketOptions.autoConnect !== false) {
        setSocketStatus(socket.connected ? 'live' : 'offline', socket.connected ? 'LIVE' : 'OFFLINE');
      }
      state.fetchInFlight = false;
    }
  }

  function hydrate(list) {
    state.rows.clear();
    (list || []).forEach((item) => {
      const normalized = normalize(item);
      if (normalized) state.rows.set(normalized.order_code, normalized);
    });
    render();
  }

  function isActive() {
    return !!(el.panel && el.panel.classList.contains('active'));
  }

  function attachListeners() {
    if (el.refreshBtn) {
      el.refreshBtn.addEventListener('click', refresh);
    }

    if (socket) {
      socket.on('part_location_updated', (payload) => {
        const normalized = normalize(payload);
        if (!normalized) return;
        state.rows.set(normalized.order_code, normalized);
        render({ highlightKey: normalized.order_code });
        if (isActive()) {
          showMessage('info', `更新: ${normalized.order_code} → ${normalized.location_code || '-'}`, 4000);
        }
        setSocketStatus('live', 'LIVE');
      });
    }

    if (socket && socket.io) {
      bindSocketLifecycle(socket, {
        onConnect: () => setSocketStatus('live', 'LIVE'),
        onDisconnect: () => setSocketStatus('offline', 'OFFLINE'),
        onError: () => setSocketStatus('error', 'ERROR'),
      });
    }

    if (socketOptions && socketOptions.autoConnect !== false) {
      setInterval(() => {
        const now = Date.now();
        const stale = now - state.lastRender > 20000;
        if (stale || (socket && !socket.connected)) {
          refresh();
        }
      }, 20000);
    }
  }

  hydrate(initialData);
  if (socketOptions && socketOptions.autoConnect === false) {
    setSocketStatus('disabled', 'DISABLED');
  } else {
    setSocketStatus(socket && socket.connected ? 'live' : 'loading', socket && socket.connected ? 'LIVE' : '接続確認中…');
  }
  attachListeners();

  return {
    refresh,
    hydrate,
    render,
    setSocketStatus,
    getLastRender: () => state.lastRender,
  };
}
