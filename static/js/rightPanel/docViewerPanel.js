import { onSocketStateChange, getSocketState } from './socketStatusManager.js';

export function initDocViewer({
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
}) {
  const panel = document.getElementById(panelId);
  if (!panel) {
    console.warn('[docViewer] panel not found, returning no-op handlers');
    return {
      reload() {},
      updateStateChips() {},
      notifyStationChange() {},
      setUrl() {},
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

  const socketStatusLabels = {
    live: '接続済み',
    reconnect: '再接続中…',
    offline: '未接続',
    error: '通信エラー',
    loading: '接続確認中…',
    disabled: '停止中',
  };

  function setStatus(state, label) {
    if (!statusEl) return;
    statusEl.classList.remove('doc-viewer-status--online', 'doc-viewer-status--live', 'doc-viewer-status--offline', 'doc-viewer-status--reconnect');
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
      showOverlay('DocumentViewer の URL が設定されていません。<br>環境変数 <code>DOCUMENT_VIEWER_URL</code> または <code>RASPI_SERVER_BASE</code> を確認してください。', { lock: true });
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
    showOverlay('DocumentViewer の URL が設定されていません。<br>環境変数 <code>DOCUMENT_VIEWER_URL</code> または <code>RASPI_SERVER_BASE</code> を確認してください。', { lock: true });
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
      if (typeof window.handleViewerBarcode === 'function') {
        window.handleViewerBarcode(data);
      }
    }
  });

  panel.dataset.docViewerUrl = docViewerUrl;

  const unsubscribeSocket = onSocketStateChange(applySocketState);
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

  const unsubscribeSocket = onSocketStateChange(applySocketState);
  applySocketState(getSocketState());

    },
  };
}
