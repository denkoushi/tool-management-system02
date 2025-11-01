export function createSocket({ base, path = '/socket.io', autoConnect = true, ioLib }) {
  const ioRef = ioLib || window.io;
  const options = {
    path,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    autoConnect,
  };
  const socket = base ? ioRef(base, options) : ioRef(options);
  return { socket, options };
}

export function bindSocketLifecycle(socket, callbacks = {}) {
  const {
    onConnect,
    onDisconnect,
    onError,
    onReconnectAttempt,
    onReconnect,
    onReconnectFailed,
    onReconnectError,
  } = callbacks;
  if (!socket || typeof socket.on !== 'function') return;
  if (onConnect) socket.on('connect', onConnect);
  if (onDisconnect) socket.on('disconnect', onDisconnect);
  if (onError) socket.on('connect_error', onError);

  const manager = socket.io;
  const addManagerListener = (event, handler) => {
    if (manager && typeof manager.on === 'function' && handler) {
      manager.on(event, handler);
    }
  };

  addManagerListener('reconnect_attempt', onReconnectAttempt);
  addManagerListener('reconnect', onReconnect);
  addManagerListener('reconnect_failed', onReconnectFailed);
  addManagerListener('reconnect_error', onReconnectError);
}
