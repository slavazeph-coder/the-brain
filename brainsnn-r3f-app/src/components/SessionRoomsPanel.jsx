import React, { useEffect, useState } from 'react';
import { getImmunityState } from '../utils/immunityScore';
import { getStreak } from '../utils/dailyChallenge';

const HANDLE_KEY = 'brainsnn_handle_v1';
const ROOM_KEY = 'brainsnn_last_room_v1';

function readHandle() { try { return localStorage.getItem(HANDLE_KEY) || ''; } catch { return ''; } }
function writeHandle(h) { try { localStorage.setItem(HANDLE_KEY, h); } catch { /* noop */ } }
function readLastRoom() { try { return localStorage.getItem(ROOM_KEY) || ''; } catch { return ''; } }
function writeLastRoom(r) { try { localStorage.setItem(ROOM_KEY, r); } catch { /* noop */ } }

function newRoomId() {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `R${rnd}`;
}

/**
 * Layer 77 — Session Rooms panel.
 * Private head-to-head: share a room ID with a friend, both submit
 * your daily / immunity / quiz score, compare side-by-side.
 */
export default function SessionRoomsPanel() {
  const [room, setRoom] = useState(readLastRoom());
  const [handle, setHandle] = useState(readHandle());
  const [entries, setEntries] = useState([]);
  const [source, setSource] = useState('daily');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { writeHandle(handle); }, [handle]);
  useEffect(() => { if (room) writeLastRoom(room); }, [room]);

  async function fetchRoom(id) {
    if (!id) return;
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/rooms/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) { setErr(data.error || `HTTP ${r.status}`); return; }
      setEntries(data.entries || []);
    } catch (e) { setErr(e.message || 'fetch failed'); }
    finally { setLoading(false); }
  }

  function create() {
    const id = newRoomId();
    setRoom(id);
    setEntries([]);
  }
  function join(id) {
    setRoom(id);
    fetchRoom(id);
  }
  function shareLink() {
    if (!room) return '';
    return `${window.location.origin}/?room=${encodeURIComponent(room)}`;
  }

  async function submitScore() {
    if (!room) return;
    setErr('');
    const imm = getImmunityState();
    const streak = getStreak();
    let score = 0;
    let meta = null;
    if (source === 'daily') {
      score = streak.history?.[0]?.accuracy || 0;
      meta = { streak: streak.streak, lastDate: streak.lastDate };
    } else if (source === 'immunity') {
      score = imm.score || 0;
      meta = { baseline: imm.baseline };
    } else if (source === 'streak') {
      score = streak.streak * 10;
      meta = { rawStreak: streak.streak };
    }
    try {
      const r = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, handle: handle || 'anon', source, score, streak: streak.streak, meta }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || `HTTP ${r.status}`); return; }
      setEntries(data.entries || []);
    } catch (e) { setErr(e.message || 'submit failed'); }
  }

  return (
    <section className="panel panel-pad session-rooms-panel">
      <div className="eyebrow">Layer 77 · session rooms</div>
      <h2>Private head-to-head</h2>
      <p className="muted">
        Create a room, share the link with a friend, both submit your scores.
        Use it for "who got more correct on today's daily", "who has the
        higher immunity", or "whose streak is longer". Upstash-backed when
        the env is set, in-memory fallback otherwise.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input
          className="share-input"
          placeholder="Room ID (4+ alphanumerics)"
          value={room}
          onChange={(e) => setRoom(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32))}
          style={{ flex: 1, minWidth: 220, fontFamily: 'monospace' }}
        />
        <button className="btn" onClick={create}>New room</button>
        <button className="btn" onClick={() => fetchRoom(room)} disabled={!room || loading}>
          {loading ? 'Fetching…' : 'Refresh'}
        </button>
      </div>

      {room && (
        <p className="muted small-note" style={{ marginTop: 6 }}>
          Share link: <strong>{shareLink()}</strong>
          {' '}
          <button
            className="ghost small"
            onClick={() => navigator.clipboard?.writeText(shareLink()).catch(() => {})}
          >
            Copy
          </button>
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <input
          className="share-input"
          placeholder="Handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value.slice(0, 24))}
          style={{ flex: 1, maxWidth: 200 }}
        />
        <select className="share-input" value={source} onChange={(e) => setSource(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="daily">Daily accuracy</option>
          <option value="immunity">Immunity score</option>
          <option value="streak">Streak × 10</option>
        </select>
        <button className="btn primary" onClick={submitScore} disabled={!room}>
          Submit my score
        </button>
      </div>

      {err && <p className="muted" style={{ color: '#dd6974', marginTop: 8 }}>{err}</p>}

      {entries.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="eyebrow">Room leaderboard</div>
          {entries
            .slice()
            .sort((a, b) => b.score - a.score)
            .map((e, i) => {
              const tone = i === 0 ? '#5ee69a' : i === 1 ? '#77dbe4' : '#fdab43';
              return (
                <div
                  key={`${e.handle}-${e.ts}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderLeft: `3px solid ${tone}`,
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 6,
                    marginTop: 6,
                  }}
                >
                  <div>
                    <strong>#{i + 1} {e.handle}</strong>
                    <span className="muted small-note" style={{ marginLeft: 8 }}>{e.source}</span>
                  </div>
                  <div style={{ fontFamily: 'monospace', color: tone }}>
                    <strong>{e.score}</strong>
                    {e.streak ? <span className="muted small-note"> · streak {e.streak}</span> : null}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </section>
  );
}
