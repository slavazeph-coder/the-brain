import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  isConfigured, isConnected, getStatus, connect, disconnect,
  broadcastState, sendChat, on
} from '../utils/liveSync';

export default function LiveSyncPanel({ state, onRemoteState }) {
  const [status, setStatus] = useState(getStatus());
  const [roomId, setRoomId] = useState('brainsnn-default');
  const [peers, setPeers] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [username, setUsername] = useState('User');
  const chatRef = useRef(null);
  const broadcastInterval = useRef(null);

  // Subscribe to sync events
  useEffect(() => {
    const unsubs = [
      on('connected', () => { setStatus('connected'); }),
      on('disconnected', () => { setStatus('disconnected'); }),
      on('error', () => { setStatus('error'); }),
      on('remoteState', (data) => { if (onRemoteState) onRemoteState(data); }),
      on('peers', (data) => { setPeers(data.count || 0); }),
      on('chat', (data) => {
        setChatMessages((prev) => [...prev.slice(-50), data]);
      })
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [onRemoteState]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages.length]);

  // Broadcast state periodically when connected
  useEffect(() => {
    if (status === 'connected') {
      broadcastInterval.current = setInterval(() => {
        broadcastState(state.regions, state.scenario, state.tick);
      }, 500);
    }
    return () => clearInterval(broadcastInterval.current);
  }, [status, state.regions, state.scenario, state.tick]);

  const handleConnect = () => {
    connect(roomId);
    setStatus('connecting');
  };

  const handleDisconnect = () => {
    disconnect();
    clearInterval(broadcastInterval.current);
  };

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    sendChat(chatInput, username);
    setChatMessages((prev) => [...prev.slice(-50), { message: chatInput, username, local: true }]);
    setChatInput('');
  };

  const statusColor = status === 'connected' ? 'var(--ok)' : status === 'connecting' ? '#fdab43' : 'var(--faint)';

  return (
    <section className="panel panel-pad live-sync-panel">
      <div className="eyebrow live-sync-eyebrow">
        <span>Live Sync</span>
        <span className="gemma-status-dot" style={{ background: statusColor }} title={status} />
      </div>
      <h2>Multi-User Brain Sync</h2>

      {!isConfigured() ? (
        <p className="muted">
          Set <code>VITE_SYNC_WS_URL</code> to enable real-time multi-user synchronization.
          Point it at a WebSocket relay server (e.g. ws://localhost:8080).
        </p>
      ) : (
        <>
          <div className="live-sync-connect">
            <input
              className="snap-name-input"
              type="text"
              placeholder="Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={status === 'connected'}
            />
            <input
              className="snap-name-input"
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ maxWidth: 120 }}
            />
            {status !== 'connected' ? (
              <button className="btn primary" onClick={handleConnect}>Connect</button>
            ) : (
              <button className="btn danger" onClick={handleDisconnect}>Disconnect</button>
            )}
          </div>

          {status === 'connected' && (
            <>
              <div className="live-sync-info">
                <span className="snap-chip">Room: {roomId}</span>
                <span className="snap-chip">Peers: {peers}</span>
                <span className="snap-chip">Broadcasting @ 2Hz</span>
              </div>

              {/* Chat */}
              <div className="live-sync-chat">
                <div className="live-sync-chat-feed" ref={chatRef}>
                  {chatMessages.map((m, i) => (
                    <div key={i} className={`live-chat-msg ${m.local ? 'local' : ''}`}>
                      <strong>{m.username}:</strong> {m.message}
                    </div>
                  ))}
                  {chatMessages.length === 0 && (
                    <p className="muted">No messages yet. Say hi!</p>
                  )}
                </div>
                <div className="live-sync-chat-input">
                  <input
                    className="snap-name-input"
                    type="text"
                    placeholder="Type a message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                  />
                  <button className="btn-sm" onClick={handleSendChat}>Send</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
