import { onSocketStateChange, getSocketState } from './socketStatusManager.js';

const SUMMARY_EVENT = 'toolmgmt:part-location-summary';

function sanitize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function coalesceTimestamp(entry) {
  if (!entry) return null;
  return entry.updated_at || entry.updatedAt || entry.scanned_at || entry.scannedAt || null;
}

export function initDocViewer(config = {}) {
  const {
    iframeId = 'docViewerFrame',
    panelId = 'docViewerPanel',
    overlayId = 'docViewerOverlay',
    statusId = 'docViewerStatus',
    stateChipId = 'docViewerStateChip',
    partChipId = 'docViewerPartChip',
    reloadBtnId = 'docViewerReloadBtn',
    returnBtnId = 'docViewerReturnBtn',
    initialUrl = '',
    initialOnline = false,
    partLocationsApi = null,
    summarySelectors = {},
  } = config;

  const panel = document.getElementById(panelId);
  if (!panel) {
    console.warn('[docViewer] panel not found, returning no-op handlers');
    return {
      reload() {},
      updateStateChips() {},
      notifyStationChange() {},
      setUrl() {},
      dispose() {},
    };
  }

  const frame = document.getElementById(iframeId);
  const overlay = document.getElementById(overlayId);
  const statusEl = document.getElementById(statusId);
  const statusLabel = statusEl ? statusEl.querySelector('.doc-viewer-status__label') : null;
  const stateChip = document.getElementById(stateChipId);
  const partChip = document.getElementById(partChipId);
  const reloadBtn = document.getElementById(reloadBtnId);
  const returnBtn = document.getElementById(returnBtnId);
  const datasetUrl = panel.dataset.docViewerUrl ? panel.dataset.docViewerUrl.trim() : '';
  let docViewerUrl = (initialUrl || datasetUrl || '').trim();

  const summaryIds = {
    containerId: 'docViewerSummary',
    locationId: 'docViewerSummaryLocation',
    deviceId: 'docViewerSummaryDevice',
    updatedId: 'docViewerSummaryUpdated',
    actionBtnId: 'docViewerSummaryShowLocations',
    ...summarySelectors,
  };

  const summary = {
    container: document.getElementById(summaryIds.containerId),
    location: document.getElementById(summaryIds.locationId),
    device: document.getElementById(summaryIds.deviceId),
    updated: document.getElementById(summaryIds.updatedId),
    actionBtn: document.getElementById(summaryIds.actionBtnId),
  };

  const summaryEnabled = !!summary.container;
  const summaryFormatter = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const summaryState = {
    keys: [],
    lastEntry: null,
  };

  const teardownFns = [];

  const socketStatusLabels = {
    live: '接続済み',
    reconnect: '再接続中…',
    offline: '未接続',
    error: '通信エラー',
    loading: '接続確認中…',
    disabled: '停止中',
  };

  function formatSummaryTimestamp(value) {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '-';
    return summaryFormatter.format(dt);
  }

  function clearSummary() {
    if (!summaryEnabled) return;
    summary.container.dataset.state = 'empty';
    if (summary.location) summary.location.textContent = '-';
    if (summary.device) summary.device.textContent = '-';
    if (summary.updated) summary.updated.textContent = '-';
    summaryState.lastEntry = null;
    summaryState.keys = [];
  }

  function setSummaryPending() {
    if (!summaryEnabled) return;
    summary.container.dataset.state = 'pending';
    if (summary.location) summary.location.textContent = '-';
    if (summary.device) summary.device.textContent = '-';
    if (summary.updated) summary.updated.textContent = '更新待ち…';
    summaryState.lastEntry = null;
  }

  function applySummary(entry) {
    if (!summaryEnabled || !entry) return;
    summary.container.dataset.state = 'ready';
    if (summary.location) summary.location.textContent = entry.location_code || '-';
    if (summary.device) summary.device.textContent = entry.device_id || '-';
    if (summary.updated) summary.updated.textContent = formatSummaryTimestamp(coalesceTimestamp(entry));
    summaryState.lastEntry = entry;
  }

  function handleSummaryBroadcast(event) {
    if (!summaryEnabled || !event || typeof event.detail !== 'object') return;
    const entry = event.detail;
    if (!entry || !entry.order_code) return;
    const match = summaryState.keys.some((key) => key && key === entry.order_code);
    if (match) {
      applySummary(entry);
    }
  }

  if (summaryEnabled) {
    clearSummary();
    window.addEventListener(SUMMARY_EVENT, handleSummaryBroadcast);
    teardownFns.push(() => window.removeEventListener(SUMMARY_EVENT, handleSummaryBroadcast));
  }

  function dedupeKeys(list) {
    const unique = [];
    list.forEach((value) => {
      if (value && !unique.includes(value)) {
        unique.push(value);
      }
    });
    return unique;
  }

  function resolveSummaryFromPayload(payload) {
    const part = sanitize(payload.part || payload.part_number || payload.partNumber || '');
    const order = sanitize(payload.order || payload.order_code || payload.orderNumber || '');
    const primary = sanitize(payload.order_code || order || part);
    const fallback = part && part !== primary ? part : '';
    const keys = dedupeKeys([primary, fallback]);
    if (summaryEnabled) {
      summaryState.keys = keys;
      summaryState.lastEntry = null;
    }

    if (!keys.length) {
      if (summaryEnabled) clearSummary();
      return;
    }

    if (!partLocationsApi) {
      if (summaryEnabled) setSummaryPending();
      return;
    }

    let applied = false;
    for (const key of keys) {
      if (!key) continue;
      const existing = partLocationsApi.getEntry?.(key) || null;
      if (existing && summaryEnabled && !applied) {
        applySummary(existing);
        applied = true;
      }
      if (typeof partLocationsApi.highlightOrder === 'function') {
        const result = partLocationsApi.highlightOrder(key, { refreshFallback: true }) || null;
        if (summaryEnabled && !applied && result && result.entry) {
          applySummary(result.entry);
          applied = true;
        }
        if (result && result.found) {
          return;
        }
      }
    }

    if (summaryEnabled && !applied) {
      setSummaryPending();
    }
  }

  function setStatus(state, label) {
    if (!statusEl) return;
    statusEl.classList.remove(
      'doc-viewer-status--online',
      'doc-viewer-status--live',
      'doc-viewer-status--offline',
      'doc-viewer-status--reconnect',
    );
    if (state === 'online' || state === 'live') {
      statusEl.classList.add('doc-viewer-status--live');
    } else if (state === 'reconnect') {
      statusEl.classList.add('doc-viewer-status--reconnect');
    } else {
      statusEl.classList.add('doc-viewer-status--offline');
    }
    if (statusLabel) statusLabel.textContent = label;
    statusEl.dataset.state = state;
  }

  function showOverlay(message, { lock = false } = {}) {
    if (!overlay) return;
    overlay.innerHTML = message;
    overlay.dataset.locked = lock ? 'true' : 'false';
    overlay.classList.remove('is-hidden');
  }

  function hideOverlay({ force = false } = {}) {
    if (!overlay) return;
    if (!force && overlay.dataset.locked === 'true') return;
    overlay.classList.add('is-hidden');
    overlay.dataset.locked = 'false';
  }

  function applySocketState(detail) {
    const stateName = detail && detail.state ? detail.state : 'offline';
    const label = socketStatusLabels[stateName] || '未接続';
    if (!docViewerUrl && stateName !== 'live' && stateName !== 'disabled') {
      setStatus('offline', label);
      return;
    }
    if (stateName === 'live') {
      setStatus('live', label);
      hideOverlay({ force: true });
    } else if (stateName === 'reconnect') {
      setStatus('reconnect', label);
      if (docViewerUrl) {
        showOverlay('DocumentViewer へ再接続中です…');
      }
    } else if (stateName === 'error') {
      setStatus('error', label);
      if (docViewerUrl) {
        showOverlay('DocumentViewer との通信でエラーが発生しました。');
      }
    } else if (stateName === 'disabled') {
      setStatus('offline', 'DISABLED');
      showOverlay('DocumentViewer 連携は無効化されています。', { lock: true });
    } else if (stateName === 'loading') {
      setStatus('offline', socketStatusLabels.loading);
      if (docViewerUrl) {
        showOverlay('DocumentViewer を接続待ちです…');
      }
    } else {
      setStatus('offline', label);
      if (docViewerUrl) {
        showOverlay('DocumentViewer が応答しません。サービスを起動してから再試行してください。');
      }
    }
  }

  function postToViewer(payload) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(payload, '*');
    } catch (err) {
      console.warn('postMessage failed', err);
    }
  }

  function reloadFrame() {
    if (!frame) return;
    if (!docViewerUrl) {
      showOverlay(
        'DocumentViewer の URL が設定されていません。<br>環境変数 <code>DOCUMENT_VIEWER_URL</code> または <code>RASPI_SERVER_BASE</code> を確認してください。',
        { lock: true },
      );
      setStatus('offline', '未設定');
      return;
    }
    showOverlay('ドキュメントビューアを読み込み中です…');
    const currentState = getSocketState();
    const label = socketStatusLabels[currentState.state] || '接続確認中…';
    if (currentState.state === 'reconnect') {
      setStatus('reconnect', socketStatusLabels.reconnect);
    } else {
      setStatus('offline', label);
    }
    const cacheBust = docViewerUrl.includes('?') ? '&' : '?';
    frame.src = `${docViewerUrl}${cacheBust}v=${Date.now()}`;
  }

  function updateStateChips(payload) {
    if (stateChip && payload.state) {
      const labels = {
        idle: '状態: 待機中',
        viewer: '状態: 表示中',
        searching: '状態: 検索中…',
        error: '状態: エラー',
      };
      stateChip.textContent = labels[payload.state] || '状態: -';
      stateChip.dataset.state = payload.state;
    }
    if (partChip) {
      if (payload.part) {
        partChip.textContent = `部品番号: ${payload.part}`;
        partChip.dataset.empty = 'false';
      } else {
        partChip.textContent = '部品番号: -';
        partChip.dataset.empty = 'true';
      }
    }
  }

  function notifyStationChange(payload) {
    if (!payload) return;
    postToViewer({
      type: 'station-change',
      process: payload.process || '',
      available: payload.available || [],
      updated_at: payload.updated_at || null,
    });
    if (!frame || !frame.src) {
      reloadFrame();
    }
  }

  if (!docViewerUrl) {
    setStatus('offline', '未設定');
    showOverlay(
      'DocumentViewer の URL が設定されていません。<br>環境変数 <code>DOCUMENT_VIEWER_URL</code> または <code>RASPI_SERVER_BASE</code> を確認してください。',
      { lock: true },
    );
  } else if (frame) {
    if (initialOnline) {
      frame.src = docViewerUrl;
    } else {
      setStatus('offline', socketStatusLabels.offline);
      reloadFrame();
    }
  } else if (!initialOnline) {
    setStatus('offline', socketStatusLabels.offline);
  }

  if (reloadBtn) reloadBtn.addEventListener('click', () => reloadFrame());
  if (returnBtn) returnBtn.addEventListener('click', () => postToViewer({ type: 'viewer-return' }));

  if (summary.actionBtn) {
    summary.actionBtn.addEventListener('click', () => {
      if (typeof window.switchFuturePanel === 'function') {
        window.switchFuturePanel('partLocationsPanel');
      }
      const primary = summaryState.keys[0] || null;
      if (primary && partLocationsApi?.highlightOrder) {
        partLocationsApi.highlightOrder(primary, { refreshFallback: true });
      }
    });
  }

  if (frame) {
    frame.addEventListener('load', () => {
      if (!frame.src) return;
      setStatus('live', socketStatusLabels.live);
      hideOverlay({ force: true });
    });
    frame.addEventListener('error', () => {
      const snapshot = getSocketState();
      if (snapshot.state === 'live') {
        setStatus('error', '読み込み失敗');
        showOverlay('DocumentViewer が応答しません。サービスを起動してから再試行してください。');
      } else {
        applySocketState(snapshot);
      }
    });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'viewer-state') {
      updateStateChips(data);
    } else if (data.type === 'dv-barcode') {
      resolveSummaryFromPayload(data);
      if (typeof window.handleViewerBarcode === 'function') {
        window.handleViewerBarcode(data);
      }
    }
  });

  panel.dataset.docViewerUrl = docViewerUrl;

  const unsubscribeSocket = onSocketStateChange(applySocketState);
  if (typeof unsubscribeSocket === 'function') {
    teardownFns.push(() => unsubscribeSocket());
  }
  applySocketState(getSocketState());

  panel.__requestViewerFocus = () => postToViewer({ type: 'focus-request' });
  window.requestDocViewerFocus = panel.__requestViewerFocus;
  window.notifyDocViewerStationChange = notifyStationChange;

  if (document.getElementById('operations')?.classList.contains('active')) {
    panel.__requestViewerFocus();
  }

  return {
    reload: reloadFrame,
    updateStateChips,
    notifyStationChange,
    setUrl(newUrl) {
      docViewerUrl = (newUrl || '').trim();
      panel.dataset.docViewerUrl = docViewerUrl;
    },
    dispose() {
      teardownFns.forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.warn('docViewer dispose error', err);
        }
      });
    },
  };
}
