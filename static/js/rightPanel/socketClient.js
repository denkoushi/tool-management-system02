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
  const { onConnect, onDisconnect, onError } = callbacks;
  if (!socket || typeof socket.on !== 'function') return;
  if (onConnect) socket.on('connect', onConnect);
  if (onDisconnect) socket.on('disconnect', onDisconnect);
  if (onError) socket.on('connect_error', onError);
}
