import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initSocketStatusManager,
  getSocketState,
  __resetSocketStateForTests,
} from './socketStatusManager.js';

function createHandlerMap() {
  return new Map();
}

function addHandler(map, event, handler) {
  if (!handler) return;
  if (!map.has(event)) {
    map.set(event, new Set());
  }
  map.get(event).add(handler);
}

function removeHandler(map, event, handler) {
  if (!map.has(event)) return;
  const set = map.get(event);
  if (!handler) {
    set.clear();
    return;
  }
  set.delete(handler);
  if (set.size === 0) {
    map.delete(event);
  }
}

function emitHandlers(map, event, ...args) {
  if (!map.has(event)) return;
  Array.from(map.get(event)).forEach((handler) => handler(...args));
}

function createMockSocket({ connected = false } = {}) {
  const socketHandlers = createHandlerMap();
  const managerHandlers = createHandlerMap();

  return {
    get connected() {
      return connected;
    },
    set connected(value) {
      connected = value;
    },
    on: vi.fn((event, handler) => addHandler(socketHandlers, event, handler)),
    off: vi.fn((event, handler) => removeHandler(socketHandlers, event, handler)),
    io: {
      on: vi.fn((event, handler) => addHandler(managerHandlers, event, handler)),
      off: vi.fn((event, handler) => removeHandler(managerHandlers, event, handler)),
    },
    emit(event, ...args) {
      emitHandlers(socketHandlers, event, ...args);
    },
    emitManager(event, ...args) {
      emitHandlers(managerHandlers, event, ...args);
    },
  };
}

describe('socketStatusManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSocketStateForTests();
  });

  afterEach(() => {
    __resetSocketStateForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('holds reconnect state until connection resumes when watchdog enabled', () => {
    const socket = createMockSocket({ connected: false });
    const teardown = initSocketStatusManager(socket, { autoConnect: true, watchdog: true });

    expect(getSocketState().state).toBe('loading');

    socket.emit('disconnect');
    expect(getSocketState().state).toBe('reconnect');

    vi.advanceTimersByTime(6000);
    expect(getSocketState().state).toBe('reconnect');

    socket.connected = true;
    socket.emit('connect');
    expect(getSocketState().state).toBe('live');

    socket.connected = false;
    socket.emit('disconnect');
    socket.emitManager('reconnect_failed');
    expect(getSocketState().state).toBe('error');

    teardown();
  });

  it('falls back to offline when watchdog is disabled', () => {
    const socket = createMockSocket({ connected: false });
    const teardown = initSocketStatusManager(socket, { autoConnect: true, watchdog: false });

    expect(getSocketState().state).toBe('loading');

    socket.emit('disconnect');
    expect(getSocketState().state).toBe('reconnect');

    vi.advanceTimersByTime(2500);
    expect(getSocketState().state).toBe('offline');

    teardown();
  });

  it('starts in disabled state when autoConnect is false', () => {
    const socket = createMockSocket({ connected: false });
    const teardown = initSocketStatusManager(socket, { autoConnect: false });

    expect(getSocketState().state).toBe('disabled');

    teardown();
  });
});
