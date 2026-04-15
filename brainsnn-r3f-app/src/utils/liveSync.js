/**
 * WebSocket Live Sync Manager
 *
 * Enables multi-user real-time brain state synchronization.
 * Connects to a WebSocket relay server. Broadcasts local state
 * changes and receives remote updates.
 *
 * Server endpoint configured via VITE_SYNC_WS_URL env var.
 */

const WS_URL = import.meta.env.VITE_SYNC_WS_URL || '';

let socket = null;
let listeners = [];
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;
const RECONNECT_BASE = 2000;

// ---------- event bus ----------

function emit(event, data) {
  listeners.forEach(([evt, fn]) => {
    if (evt === event || evt === '*') fn(data, event);
  });
}

export function on(event, fn) {
  listeners.push([event, fn]);
  return () => { listeners = listeners.filter((l) => l[1] !== fn); };
}

export function off(fn) {
  listeners = listeners.filter((l) => l[1] !== fn);
}

// ---------- connection ----------

export function isConfigured() {
  return WS_URL.length > 0;
}

export function isConnected() {
  return socket?.readyState === WebSocket.OPEN;
}

export function getStatus() {
  if (!isConfigured()) return 'unconfigured';
  if (!socket) return 'disconnected';
  switch (socket.readyState) {
    case WebSocket.CONNECTING: return 'connecting';
    case WebSocket.OPEN: return 'connected';
    case WebSocket.CLOSING: return 'closing';
    default: return 'disconnected';
  }
}

export function connect(roomId = 'default') {
  if (!isConfigured()) return;
  if (socket?.readyState === WebSocket.OPEN) return;

  const url = `${WS_URL}${WS_URL.includes('?') ? '&' : '?'}room=${roomId}`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    reconnectAttempts = 0;
    emit('connected', { roomId });
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      emit('message', msg);
      if (msg.type === 'state') emit('remoteState', msg.payload);
      if (msg.type === 'cursor') emit('remoteCursor', msg.payload);
      if (msg.type === 'chat') emit('chat', msg.payload);
      if (msg.type === 'peers') emit('peers', msg.payload);
    } catch {
      // ignore malformed messages
    }
  };

  socket.onclose = () => {
    emit('disconnected', {});
    scheduleReconnect(roomId);
  };

  socket.onerror = () => {
    emit('error', { message: 'WebSocket error' });
  };
}

function scheduleReconnect(roomId) {
  if (reconnectAttempts >= MAX_RECONNECT) {
    emit('reconnectFailed', {});
    return;
  }
  const delay = RECONNECT_BASE * Math.pow(2, reconnectAttempts);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => connect(roomId), delay);
}

export function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts = MAX_RECONNECT; // prevent auto-reconnect
  if (socket) {
    socket.close();
    socket = null;
  }
  emit('disconnected', {});
}

// ---------- send ----------

function send(type, payload) {
  if (!isConnected()) return false;
  socket.send(JSON.stringify({ type, payload, ts: Date.now() }));
  return true;
}

export function broadcastState(regions, scenario, tick) {
  return send('state', { regions, scenario, tick });
}

export function broadcastCursor(regionId) {
  return send('cursor', { regionId });
}

export function sendChat(message, username = 'Anonymous') {
  return send('chat', { message, username });
}

export function requestPeers() {
  return send('peers', {});
}
