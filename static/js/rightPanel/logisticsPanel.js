import { onSocketStateChange, getSocketState } from './socketStatusManager.js';

const DEFAULT_LIMIT = 100;
const STATUS_META = {
  pending: { label: '待機中', badge: 'pending' },
  in_transit: { label: '搬送中', badge: 'in-transit' },
  completed: { label: '完了', badge: 'completed' },
  cancelled: { label: 'キャンセル', badge: 'cancelled' },
};

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function parseDate(value) {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const formatter = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium' });

function formatDatetime(value) {
  const dt = parseDate(value);
  return dt ? formatter.format(dt) : '—';
}

function normalizeStatus(value) {
  if (!value) return 'pending';
  return String(value).trim().toLowerCase();
}

function getStatusMeta(value) {
  const key = normalizeStatus(value);
  return STATUS_META[key] || { label: key || '-', badge: 'pending' };
}

function normalizeJob(entry) {
  if (!entry) return null;
  const id = entry.job_id || entry.id || entry.task_id || entry.scan_id || '';
  if (!id) return null;
  const requested = entry.requested_at || entry.requestedAt || entry.created_at || entry.createdAt || null;
  const updated = entry.updated_at || entry.updatedAt || requested;
  const status = normalizeStatus(entry.status || 'pending');
  return {
    job_id: id,
    part_code: entry.part_code || entry.partCode || entry.part || '',
    from: entry.from_location || entry.fromLocation || entry.source || '',
    to: entry.to_location || entry.toLocation || entry.destination || '',
    status,
    requested_at: requested,
    updated_at: updated,
  };
}

export function initLogisticsPanel({
  socket,
  socketOptions = {},
  fetchImpl = window.fetch.bind(window),
  initialData = [],
  selectors = {},
} = {}) {
  const el = {
    panel: document.getElementById('logisticsPanel'),
    tableBody: document.querySelector('#logisticsTable tbody'),
    message: document.getElementById('logisticsMessage'),
    empty: document.getElementById('logisticsEmpty'),
    refreshBtn: document.getElementById('logisticsRefreshBtn'),
    socketStatus: document.getElementById('logisticsSocketStatus'),
    taskCount: document.getElementById('logisticsTaskCount'),
    lastUpdated: document.getElementById('logisticsLastUpdated'),
    badges: Array.from(document.querySelectorAll('.logistics-tab-badge')),
    ...selectors,
  };

  if (!el.panel || !el.tableBody) {
    console.warn('[logistics] panel elements not found');
    return null;
  }

  const state = {
    jobs: new Map(),
    messageTimer: null,
    lastRender: 0,
  };

  function setBadgeCount(count) {
    el.badges.forEach((badge) => {
      if (badge) badge.textContent = String(count);
    });
  }

  function showMessage(level, message, duration = 5000) {
    const container = el.message;
    if (!container) return;
    if (!message) {
      container.innerHTML = '';
      return;
    }
    const classes = {
      success: 'alert-success',
      info: 'alert-info',
      warning: 'alert-warning',
      danger: 'alert-danger',
    };
    container.innerHTML = `<div class="alert ${classes[level] || classes.info}">${message}</div>`;
    if (state.messageTimer) clearTimeout(state.messageTimer);
    if (duration && duration > 0) {
      state.messageTimer = setTimeout(() => {
        container.innerHTML = '';
      }, duration);
    }
  }

  function setSocketStatus(status, label) {
    if (!el.socketStatus) return;
    const map = {
      live: 'LIVE',
      offline: 'OFFLINE',
      loading: '接続確認中…',
      reconnect: '再接続中…',
      disabled: 'DISABLED',
      error: 'ERROR',
    };
    const resolved = map[status] || label || '—';
    el.socketStatus.dataset.state = status;
    el.socketStatus.textContent = resolved;
  }

  function render({ highlightId } = {}) {
    const entries = Array.from(state.jobs.values()).sort((a, b) => {
      const aTime = parseDate(a.updated_at)?.getTime() || 0;
      const bTime = parseDate(b.updated_at)?.getTime() || 0;
      return bTime - aTime;
    });

    const fragment = document.createDocumentFragment();
    entries.forEach((job) => {
      const tr = document.createElement('tr');
      tr.dataset.key = job.job_id;
      const columns = [
        { type: 'text', value: job.job_id },
        { type: 'text', value: job.part_code || '-' },
        { type: 'text', value: job.from || '-' },
        { type: 'text', value: job.to || '-' },
        { type: 'status', value: job.status },
        { type: 'text', value: formatDatetime(job.requested_at) },
        { type: 'text', value: formatDatetime(job.updated_at) },
      ];

      columns.forEach((col) => {
        const td = document.createElement('td');
        if (col.type === 'status') {
          const meta = getStatusMeta(col.value);
          const badge = document.createElement('span');
          badge.className = `logistics-status logistics-status--${meta.badge}`;
          badge.textContent = meta.label;
          td.appendChild(badge);
        } else {
          td.textContent = col.value;
        }
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });

    el.tableBody.innerHTML = '';
    el.tableBody.appendChild(fragment);

    const count = entries.length;
    if (el.taskCount) el.taskCount.textContent = `件数: ${count}`;
    setBadgeCount(count);

    if (el.lastUpdated) {
      const latest = entries.length ? entries[0].updated_at : null;
      el.lastUpdated.textContent = `最終更新: ${latest ? formatDatetime(latest) : '—'}`;
    }

    if (el.empty) {
      el.empty.style.display = count ? 'none' : 'block';
    }

    if (highlightId) {
      const selector = `tr[data-key="${cssEscape(highlightId)}"]`;
      const row = el.tableBody.querySelector(selector);
      if (row) {
        row.classList.add('is-flash');
        setTimeout(() => row.classList.remove('is-flash'), 2000);
      }
    }

    state.lastRender = Date.now();
  }

  function hydrate(list) {
    state.jobs.clear();
    (list || []).forEach((item) => {
      const normalized = normalizeJob(item);
      if (normalized) state.jobs.set(normalized.job_id, normalized);
    });
    render();
  }

  async function refresh() {
    const snapshot = getSocketState();
    if (snapshot.state === 'reconnect') {
      setSocketStatus('reconnect');
      return;
    }
    if (snapshot.state === 'offline' || snapshot.state === 'disabled') {
      setSocketStatus(snapshot.state);
      return;
    }
    let hadError = false;
    try {
      if (el.refreshBtn) el.refreshBtn.disabled = true;
      setSocketStatus('loading');
      const res = await fetchImpl(`/api/logistics/jobs?limit=${DEFAULT_LIMIT}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '構内物流タスクの取得に失敗しました');
      }
      hydrate(data.items || []);
      showMessage('success', `物流タスクを更新しました（${(data.items || []).length}件）`, 3000);
    } catch (error) {
      hadError = true;
      console.error('logistics refresh error', error);
      const detail = error && typeof error.message === 'string' ? error.message : '';
      const baseError = '構内物流タスクの取得に失敗しました';
      const composed = detail ? `${baseError} (${detail})` : baseError;
      showMessage('danger', composed);
      if (socketOptions.autoConnect !== false) {
        setSocketStatus('error');
      }
    } finally {
      if (el.refreshBtn) el.refreshBtn.disabled = false;
      if (!hadError && socketOptions.autoConnect !== false) {
        const snapshot = getSocketState();
        setSocketStatus(snapshot.state);
      }
    }
  }

  function upsertJob(payload) {
    const normalized = normalizeJob(payload);
    if (!normalized) return;
    state.jobs.set(normalized.job_id, normalized);
    render({ highlightId: normalized.job_id });
    const meta = getStatusMeta(normalized.status);
    showMessage('info', `搬送更新: ${normalized.job_id} → ${meta.label}`, 3000);
  }

  function registerSocketHandlers(sock) {
    if (!sock) return;
    sock.on('logistics_job_updated', (payload) => {
      upsertJob(payload);
    });
  }

  if (el.refreshBtn) {
    el.refreshBtn.addEventListener('click', (event) => {
      event.preventDefault();
      refresh();
    });
  }

  const statusLabels = {
    live: 'LIVE',
    offline: 'OFFLINE',
    reconnect: '再接続中…',
    error: 'ERROR',
    loading: '接続確認中…',
    disabled: 'DISABLED',
  };

  const applyStatus = (detail) => {
    const stateName = detail?.state || 'offline';
    setSocketStatus(stateName, statusLabels[stateName] || '—');
  };

  hydrate(initialData);

  if (socketOptions.autoConnect === false) {
    setSocketStatus('disabled', 'DISABLED');
  } else {
    applyStatus(getSocketState());
    onSocketStateChange(applyStatus);
  }

  registerSocketHandlers(socket);

  return {
    hydrate,
    refresh,
    setSocketStatus,
    registerSocketHandlers,
    getLastRender: () => state.lastRender,
  };
}
