import { createSocket, bindSocketLifecycle } from './socketClient.js';
import { initPartLocations } from './partLocationsPanel.js';
import { initDocViewer } from './docViewerPanel.js';

function loadInitialPartLocations() {
  try {
    const el = document.getElementById('initialPartLocations');
    if (!el) return [];
    return JSON.parse(el.textContent || '[]') || [];
  } catch (err) {
    console.warn('Failed to parse initial part locations', err);
    return [];
  }
}

function resolveSocketConfig(rawConfig) {
  const config = typeof rawConfig === 'object' && rawConfig !== null ? rawConfig : {};
  const base = typeof config.base === 'string' ? config.base.trim().replace(/\/+$/, '') : '';
  const path = typeof config.path === 'string' ? config.path.trim() : '/socket.io';
  const auto = config.auto !== false;
  return { base, path, autoConnect: auto };
}

export function initRightPanel() {
  const config = window.TOOLMGMT_CONFIG || {};
  const socketConfig = resolveSocketConfig(config.socket || {});
  const ioLib = window.io;
  if (!ioLib) {
    console.error('Socket.IO client library not found (window.io missing)');
    return null;
  }

  const { socket, options } = createSocket({
    base: socketConfig.base,
    path: socketConfig.path,
    autoConnect: socketConfig.autoConnect,
    ioLib,
  });

  window.TOOLMGMT_SOCKET = socket;

  const partLocations = initPartLocations({
    socket,
    socketOptions: options,
    fetchImpl: window.fetch.bind(window),
    initialData: loadInitialPartLocations(),
  });

  const panelEl = document.getElementById('docViewerPanel');
  const docViewer = initDocViewer({
    initialUrl: panelEl?.dataset.docViewerUrl || '',
    initialOnline: panelEl?.dataset.docViewerOnline === 'true',
  });

  bindSocketLifecycle(socket, {
    onConnect: () => partLocations?.setSocketStatus?.('live', 'LIVE'),
    onDisconnect: () => partLocations?.setSocketStatus?.('offline', 'OFFLINE'),
    onError: () => partLocations?.setSocketStatus?.('error', 'ERROR'),
  });

  if (socketConfig.autoConnect !== false) {
    setInterval(() => {
      const now = Date.now();
      const lastRender = partLocations?.getLastRender?.() || 0;
      const stale = now - lastRender > 20000;
      if (stale || (socket && !socket.connected)) {
        partLocations?.refresh?.();
      }
    }, 20000);
  }

  if (docViewer) {
    window.notifyDocViewerStationChange = docViewer.notifyStationChange;
  }

  return { socket, partLocations, docViewer };
}
