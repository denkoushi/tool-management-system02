const STATE_EVENT = 'toolmgmt:socket-state';
const DEFAULT_DETAIL = { state: 'loading' };
let currentDetail = DEFAULT_DETAIL;
let reconnectHold = false;
let watchdogEnabled = true;
let connectionInitialized = false;

function dispatchState(detail) {
  if (!detail || typeof detail !== 'object') return;
  currentDetail = detail;
  window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: currentDetail }));
}

function normalizeState(state) {
  if (!state) return 'offline';
  return String(state);
}

function shouldSuppressTransition(nextState) {
  if (!watchdogEnabled || !reconnectHold) return false;
  if (nextState === 'reconnect') return false;
  if (nextState === 'live' || nextState === 'error' || nextState === 'disabled') return false;
  return nextState === 'offline' || nextState === 'loading';
}

function setState(state, meta = {}) {
  const nextState = normalizeState(state);
  if (shouldSuppressTransition(nextState)) return;
  if (nextState === currentDetail.state && !meta.force) return;

  if (nextState === 'reconnect') {
    reconnectHold = watchdogEnabled;
  } else if (nextState === 'live' || nextState === 'disabled' || nextState === 'error') {
    reconnectHold = false;
  }

  dispatchState({ state: nextState, ...meta });
}

function evaluateSocketState(socket, { autoConnect }) {
  if (!socket) return { state: 'offline' };
  if (autoConnect === false) return { state: 'disabled' };
  if (watchdogEnabled && reconnectHold) return { state: 'reconnect' };
  if (socket.connected) return { state: 'live' };
  return { state: connectionInitialized ? 'offline' : 'loading' };
}

export function initSocketStatusManager(socket, { autoConnect = true, watchdog = true } = {}) {
  if (!socket) return () => {};
  watchdogEnabled = watchdog !== false;
  reconnectHold = false;
  connectionInitialized = Boolean(socket.connected);
  const manager = socket.io;

  const handleConnect = () => {
    connectionInitialized = true;
    setState('live', { source: 'socket:connect' });
  };

  const handleDisconnect = () => {
    connectionInitialized = true;
    if (autoConnect === false) {
      setState('disabled', { source: 'socket:disconnect' });
    } else {
      setState('reconnect', { source: 'socket:disconnect' });
    }
  };

  const handleConnectError = () => {
    if (autoConnect === false) return;
    setState('reconnect', { source: 'socket:connect_error' });
  };

  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('connect_error', handleConnectError);

  const managerListeners = [];
  const addManagerListener = (event, handler) => {
    if (!manager || typeof manager.on !== 'function' || !handler) return;
    manager.on(event, handler);
    managerListeners.push(() => {
      if (typeof manager.off === 'function') {
        manager.off(event, handler);
      }
    });
  };

  addManagerListener('reconnect_attempt', () => setState('reconnect', { source: 'manager:reconnect_attempt' }));
  addManagerListener('reconnect', handleConnect);
  addManagerListener('reconnect_error', handleConnectError);
  addManagerListener('reconnect_failed', () => setState('error', { source: 'manager:reconnect_failed' }));
  addManagerListener('close', handleDisconnect);

  const intervalId = setInterval(() => {
    const snapshot = evaluateSocketState(socket, { autoConnect });
    setState(snapshot.state, { source: 'interval', force: true });
  }, 2000);

  const initial = evaluateSocketState(socket, { autoConnect });
  if (watchdogEnabled && initial.state === 'reconnect') {
    reconnectHold = true;
  }
  dispatchState(initial);

  return () => {
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    socket.off('connect_error', handleConnectError);
    managerListeners.forEach((unsubscribe) => unsubscribe());
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

export function __resetSocketStateForTests() {
  reconnectHold = false;
  currentDetail = DEFAULT_DETAIL;
  watchdogEnabled = true;
  connectionInitialized = false;
}

export const SOCKET_STATE_EVENT = STATE_EVENT;
