const STATE_EVENT = 'toolmgmt:socket-state';
let currentDetail = { state: 'loading' };
let teardownFns = [];

function emit(detail) {
  const next = detail && typeof detail === 'object' ? detail : { state: 'offline' };
  if (currentDetail.state === next.state) {
    return;
  }
  currentDetail = next;
  window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: currentDetail }));
}

function evaluate(socket) {
  if (!socket) return { state: 'offline' };
  const manager = socket.io;
  const reconnecting = Boolean(manager && (manager._reconnecting || manager._connecting || manager._reconnect));
  if (reconnecting) return { state: 'reconnect' };
  return { state: socket.connected ? 'live' : 'offline' };
}

export function initSocketStatusManager(socket, { autoConnect = true } = {}) {
  if (!socket) return () => {};
  const manager = socket.io;

  const handleConnect = () => emit({ state: 'live' });
  const handleDisconnect = () => {
    if (autoConnect === false) {
      emit({ state: 'disabled' });
    } else {
      emit(evaluate(socket));
    }
  };
  const handleError = () => {
    if (autoConnect === false) return;
    emit({ state: 'reconnect' });
  };

  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('connect_error', handleError);

  const removeManagerListeners = [];
  const addManagerListener = (event, handler) => {
    if (!manager || typeof manager.on !== 'function' || !handler) return;
    manager.on(event, handler);
    removeManagerListeners.push(() => manager.off(event, handler));
  };

  addManagerListener('reconnect_attempt', () => emit({ state: 'reconnect' }));
  addManagerListener('reconnect', handleConnect);
  addManagerListener('reconnect_error', handleError);
  addManagerListener('reconnect_failed', () => emit({ state: 'error' }));

  const intervalId = setInterval(() => {
    if (autoConnect === false) return;
    emit(evaluate(socket));
  }, 2000);

  emit(autoConnect === false ? { state: 'disabled' } : evaluate(socket));

  return () => {
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    socket.off('connect_error', handleError);
    removeManagerListeners.forEach((fn) => fn());
    clearInterval(intervalId);
  };
}

export function onSocketStateChange(handler) {
  if (typeof handler !== 'function') return () => {};
  const listener = (event) => handler(event.detail);
  window.addEventListener(STATE_EVENT, listener);
  if (currentDetail) handler(currentDetail);
  return () => window.removeEventListener(STATE_EVENT, listener);
}

export function getSocketState() {
  return currentDetail;
}

export const SOCKET_STATE_EVENT = STATE_EVENT;
