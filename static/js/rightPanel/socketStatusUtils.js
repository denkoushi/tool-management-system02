export function computeSocketState(socket) {
  const io = socket?.io;
  if (!io) return { reconnecting: false, state: socket?.connected ? 'live' : 'offline' };
  const reconnecting = Boolean(io._reconnecting || io._connecting || io._reconnect);
  if (reconnecting) {
    return { reconnecting: true, state: 'reconnect' };
  }
  return { reconnecting: false, state: socket?.connected ? 'live' : 'offline' };
}
