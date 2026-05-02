import React, { useEffect, useMemo, useRef, useState } from 'react';
import { recentSpans, subscribe } from '../utils/telemetry';
import { buildFrames, rollForward } from '../utils/traceReplay';

/**
 * Layer 106 — Trace Replay panel.
 *
 * Scrub the live span buffer like a recording. Pick a frame size,
 * play / pause / step. Surface per-name accumulated totals as the
 * replay walks forward.
 */
export default function TraceReplayPanel() {
  const [tick, setTick] = useState(0);
  const [frameMs, setFrameMs] = useState(2000);
  const [speed, setSpeed] = useState(1);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);

  const spans = useMemo(() => recentSpans(500), [tick]);
  const { frames, from, to } = useMemo(
    () => buildFrames({ spans, frameMs }),
    [spans, frameMs],
  );

  // Clamp index when frames change
  useEffect(() => {
    if (idx >= frames.length) setIdx(Math.max(0, frames.length - 1));
  }, [frames.length, idx]);

  // Drive playback
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(() => {
      setIdx((i) => {
        if (i >= frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, Math.max(50, 600 / speed));
    return () => clearInterval(timerRef.current);
  }, [playing, frames.length, speed]);

  const cursor = frames[idx];
  const acc = useMemo(() => rollForward(frames, idx), [frames, idx]);

  const totalSpan = (to && from) ? to - from : 0;
  const progress = (idx + 1) / Math.max(1, frames.length);

  return (
    <section className="panel panel-pad trace-replay-panel">
      <div className="eyebrow">Layer 106 · trace replay</div>
      <h2>Scrub the buffer</h2>
      <p className="muted">
        Walk the unified telemetry buffer like a recording. Useful for
        "show me what the harness was doing during the outage at 14:32"
        without re-running the brain. Frame size sets the bucket.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 10 }}>
        <NumberInput label="frame ms" value={frameMs} onChange={(e) => setFrameMs(Number(e.target.value))} min={100} step={500} />
        <SpeedPicker speed={speed} onChange={setSpeed} />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          {playing ? (
            <button className="btn-sm" onClick={() => setPlaying(false)}>Pause</button>
          ) : (
            <button className="btn" onClick={() => setPlaying(true)} disabled={frames.length === 0}>Play</button>
          )}
          <button className="ghost small" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>‹</button>
          <button className="ghost small" onClick={() => setIdx((i) => Math.min(frames.length - 1, i + 1))} disabled={idx >= frames.length - 1}>›</button>
          <button className="ghost small" onClick={() => setIdx(0)}>↺</button>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, frames.length - 1)}
        value={idx}
        onChange={(e) => setIdx(Number(e.target.value))}
        style={{ width: '100%', marginTop: 12 }}
        disabled={frames.length === 0}
      />

      <div className="muted small-note" style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>frame {idx + 1} / {frames.length} · {Math.round(progress * 100)}%</span>
        <span>
          window {totalSpan ? Math.round(totalSpan / 1000) + 's' : '0s'} · {spans.length} spans
        </span>
      </div>

      {cursor && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(122,143,231,0.06)',
            borderLeft: '3px solid #7a8fe7',
          }}
        >
          <strong>{new Date(cursor.tStart).toLocaleTimeString()}</strong>
          <span className="muted small-note" style={{ marginLeft: 8 }}>
            {cursor.stats.count} spans · {cursor.stats.errors} err · {cursor.stats.names.join(', ') || '(idle)'}
          </span>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontFamily: 'monospace', fontSize: 12 }}>
            {cursor.spans.slice(0, 8).map((s) => (
              <li key={s.span_id} style={{ color: s.status?.code === 'error' ? '#dd6974' : '' }}>
                {s.name} · {s.duration_ms ?? '?'}ms
                {s.attributes?.tool && ` · tool=${s.attributes.tool}`}
              </li>
            ))}
            {cursor.spans.length > 8 && <li className="muted small-note">… +{cursor.spans.length - 8} more</li>}
          </ul>
        </div>
      )}

      {acc.byName.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Cumulative through cursor</div>
          {acc.byName.slice(0, 10).map((b) => (
            <div
              key={b.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 60px',
                gap: 8,
                padding: '4px 8px',
                marginTop: 2,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              <span>{b.name}</span>
              <span className="muted small-note">×{b.count}</span>
              <span style={{ color: b.errors ? '#dd6974' : '' }}>err {b.errors}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NumberInput({ label, value, onChange, ...rest }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted small-note">{label}</span>
      <input className="share-input" type="number" value={value} onChange={onChange} {...rest} />
    </label>
  );
}

function SpeedPicker({ speed, onChange }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted small-note">speed</span>
      <select className="share-input" value={speed} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
        <option value={8}>8×</option>
      </select>
    </label>
  );
}
