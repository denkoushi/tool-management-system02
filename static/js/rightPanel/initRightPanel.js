import { createSocket, bindSocketLifecycle } from './socketClient.js';
import { initPartLocations } from './partLocationsPanel.js';
import { initDocViewer } from './docViewerPanel.js';
import { initLogisticsPanel } from './logisticsPanel.js';
import { initSocketStatusManager } from './socketStatusManager.js';
import { installSocketWatchdog } from './socketWatchdog.js';

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

function loadInitialLogistics() {
  try {
    const el = document.getElementById('initialLogisticsJobs');
    if (!el) return [];
    return JSON.parse(el.textContent || '[]') || [];
  } catch (err) {
    console.warn('Failed to parse initial logistics jobs', err);
    return [];
  }
}

function setupPanelSwitching() {
  const buttons = Array.from(document.querySelectorAll('.view-switch button[data-target]'));
  if (!buttons.length) return;
  const panels = Array.from(document.querySelectorAll('.future-panel-body'));

  const showPanel = (targetId) => {
    panels.forEach((panel) => {
      if (panel.id === targetId) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });
    buttons.forEach((button) => {
      button.classList.toggle('active', button.dataset.target === targetId);
    });
  };

  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const target = button.dataset.target;
      if (!target) return;
      showPanel(target);
    });
  });

  const activePanel = document.querySelector('.future-panel-body.active');
  if (activePanel) {
    showPanel(activePanel.id);
  } else if (buttons[0]) {
    showPanel(buttons[0].dataset.target);
  }
}

function resolveSocketConfig(rawConfig) {
  const config = typeof rawConfig === 'object' && rawConfig !== null ? rawConfig : {};
  const base = typeof config.base === 'string' ? config.base.trim().replace(/\/+$/, '') : '';
  const path = typeof config.path === 'string' ? config.path.trim() : '/socket.io';
  const auto = config.auto !== false;
  const watchdog = config.watchdog !== false;
  return { base, path, autoConnect: auto, watchdog };
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
  const teardownStatusManager = initSocketStatusManager(socket, { autoConnect: socketConfig.autoConnect });
  const teardownWatchdog = installSocketWatchdog(socket, {
    enabled: socketConfig.watchdog !== false && socketConfig.autoConnect !== false,
  });

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

  const logistics = initLogisticsPanel({
    socket,
    socketOptions: options,
    fetchImpl: window.fetch.bind(window),
    initialData: loadInitialLogistics(),
  });

  bindSocketLifecycle(socket, {
    onConnect: () => {
      partLocations?.setSocketStatus?.('live', 'LIVE');
      logistics?.setSocketStatus?.('live');
    },
    onDisconnect: () => {
      partLocations?.setSocketStatus?.('offline', 'OFFLINE');
      logistics?.setSocketStatus?.('offline');
    },
    onError: () => {
      partLocations?.setSocketStatus?.('error', 'ERROR');
      logistics?.setSocketStatus?.('error');
    },
  });

  if (socketConfig.autoConnect !== false) {
    setInterval(() => {
      const now = Date.now();
      const lastRender = partLocations?.getLastRender?.() || 0;
      const stale = now - lastRender > 20000;
      if (stale || (socket && !socket.connected)) {
        partLocations?.refresh?.();
      }
      const logisticsLast = logistics?.getLastRender?.() || 0;
      const logisticsStale = now - logisticsLast > 20000;
      if (logisticsStale || (socket && !socket.connected)) {
        logistics?.refresh?.();
      }
    }, 20000);
  }

  if (docViewer) {
    window.notifyDocViewerStationChange = docViewer.notifyStationChange;
  }

  setupPanelSwitching();

  return { socket, partLocations, docViewer, logistics, teardownStatusManager, teardownWatchdog };
}
