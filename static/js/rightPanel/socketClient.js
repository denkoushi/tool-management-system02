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
  if (onReconnectAttempt) socket.on('reconnect_attempt', onReconnectAttempt);
  if (onReconnect) socket.on('reconnect', onReconnect);
  if (onReconnectFailed) socket.on('reconnect_failed', onReconnectFailed);
  if (onReconnectError) socket.on('reconnect_error', onReconnectError);
}
