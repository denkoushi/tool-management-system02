const STATUS_LABELS = {
  live: 'LIVE',
  reconnect: '再接続中…',
  offline: 'OFFLINE',
  error: 'ERROR',
  disabled: 'DISABLED',
};

function queryStatusChips() {
  return document.querySelectorAll('[data-socket-chip], .status-chip');
}

function renderStatus(mode) {
  const chips = queryStatusChips();
  chips.forEach((chip) => {
    if (chip.dataset) {
      chip.dataset.state = mode;
    }
    if (typeof chip.textContent === 'string') {
      chip.textContent = STATUS_LABELS[mode] || STATUS_LABELS.live;
    }
  });
}

function isManagerReconnecting(manager) {
  if (!manager) return false;
  return Boolean(
    manager._reconnecting ||
      manager._connecting ||
      manager._reconnect ||
      (typeof manager.reconnecting === 'boolean' && manager.reconnecting) ||
      (manager.backoff && typeof manager.backoff.duration === 'function')
  );
}

export function installSocketWatchdog(socket, { enabled = true, intervalMs = 750 } = {}) {
  if (!enabled || !socket || !socket.io) {
    return () => {};
  }

  const manager = socket.io;
  let holdReconnect = false;

  const managerListeners = [];
  const addManagerListener = (event, handler) => {
    if (!manager || typeof manager.on !== 'function') return;
    manager.on(event, handler);
    managerListeners.push(() => {
      if (typeof manager.off === 'function') manager.off(event, handler);
    });
  };

  const beginReconnect = () => {
    holdReconnect = true;
    renderStatus('reconnect');
  };

  const endReconnect = () => {
    holdReconnect = false;
    renderStatus(socket.connected ? 'live' : 'offline');
  };

  const failReconnect = () => {
    holdReconnect = false;
    renderStatus('error');
  };

  const handleDisconnect = () => beginReconnect();
  const handleConnect = () => endReconnect();
  const handleConnectError = () => beginReconnect();

  addManagerListener('reconnect_attempt', beginReconnect);
  addManagerListener('reconnect_error', beginReconnect);
  addManagerListener('reconnect', endReconnect);
  addManagerListener('reconnect_failed', failReconnect);
  addManagerListener('close', beginReconnect);

  socket.on('disconnect', handleDisconnect);
  socket.on('connect', handleConnect);
  socket.on('connect_error', handleConnectError);

  // 監視ループ：他要素が OFFLINE を描画しても再接続中は再設定する
  const timerId = window.setInterval(() => {
    if (!holdReconnect) return;
    if (isManagerReconnecting(manager)) {
      renderStatus('reconnect');
    }
  }, intervalMs);

  return () => {
    managerListeners.forEach((unsubscribe) => unsubscribe());
    socket.off('disconnect', handleDisconnect);
    socket.off('connect', handleConnect);
    socket.off('connect_error', handleConnectError);
    window.clearInterval(timerId);
  };
}
