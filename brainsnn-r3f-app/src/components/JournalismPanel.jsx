import React, { useMemo, useState } from 'react';
import {
  parseInput, analyzeBatch, exportEnriched, detectInputFormat,
} from '../utils/journalism';

const EXAMPLE = `id,author,text
1,alice,"URGENT: you won't believe the shocking scandal they covered up"
2,bob,"Just finished the book — recommend it if you liked his earlier work"
3,carol,"Last chance! Only 3 spots remaining. Act now before it's too late."
4,dan,"Reminder: team sync moved to 2pm, agenda in the shared doc"
5,eve,"Everyone knows they lied. Obviously. 100% proven at this point."`;

export default function JournalismPanel() {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);

  const parsed = useMemo(() => {
    if (!raw.trim()) return null;
    try { return parseInput(raw); } catch (e) { return { error: e.message || 'parse failed' }; }
  }, [raw]);

  async function run() {
    setErr(''); setReport(null);
    if (!parsed) return;
    if (parsed.error) { setErr(parsed.error); return; }
    if (!parsed.rows?.length) { setErr('no rows'); return; }
    setRunning(true);
    await new Promise((r) => setTimeout(r, 20));
    try {
      const analysis = analyzeBatch({ headers: parsed.headers, rows: parsed.rows });
      setReport({ format: parsed.format, headers: parsed.headers, analysis });
    } catch (e) { setErr(e.message || 'analyze failed'); }
    finally { setRunning(false); }
  }

  function download(format) {
    if (!report) return;
    const text = exportEnriched({ format, headers: report.headers, analysis: report.analysis });
    const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-enriched-${Date.now()}.${format === 'json' ? 'json' : 'csv'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="panel panel-pad journalism-panel">
      <div className="eyebrow">Layer 85 · journalism bulk mode</div>
      <h2>CSV / JSON → enriched scores</h2>
      <p className="muted">
        Paste a CSV (with a header row) or a JSON array. The text column
        is auto-detected from common names (<code>text, content, body,
        message, tweet, post, status</code>). Every row runs through the
        Firewall; download the result with pressure + templates +
        archetypes appended.
      </p>

      <div className="control-actions" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => setRaw(EXAMPLE)}>Load example CSV</button>
        <button className="btn" onClick={() => setRaw('')} disabled={!raw}>Clear</button>
      </div>

      <textarea
        className="firewall-input"
        placeholder="Paste CSV with header row or a JSON array of objects…"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
        style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}
      />

      {parsed && !parsed.error && (
        <p className="muted small-note" style={{ marginTop: 6 }}>
          Detected <strong>{parsed.format}</strong> · <strong>{parsed.rows.length}</strong> rows ·{' '}
          <strong>{parsed.headers.length}</strong> columns
        </p>
      )}
      {err && <p className="muted" style={{ color: '#dd6974' }}>{err}</p>}

      <div className="control-actions" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={run} disabled={running || !parsed || parsed.error || !parsed.rows?.length}>
          {running ? 'Scoring…' : 'Analyze batch'}
        </button>
        {report && (
          <>
            <button className="btn" onClick={() => download('csv')}>Download CSV</button>
            <button className="btn" onClick={() => download('json')}>Download JSON</button>
          </>
        )}
      </div>

      {report && (
        <div style={{ marginTop: 14 }}>
          <Summary analysis={report.analysis} />
          <Preview analysis={report.analysis} />
        </div>
      )}
    </section>
  );
}

function Summary({ analysis }) {
  const p = analysis.meanPressure;
  const tone = p >= 0.55 ? '#dd6974' : p >= 0.25 ? '#fdab43' : '#6daa45';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderRadius: 8,
        background: `${tone}14`,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <span>
        <strong>{analysis.rowCount}</strong> rows · mean pressure{' '}
        <strong style={{ color: tone }}>{Math.round(p * 100)}%</strong> ·{' '}
        <strong>{analysis.highPressureCount}</strong> high-pressure
      </span>
      <span className="muted small-note">
        column <strong>{analysis.textColumn}</strong>
        {analysis.topTemplate && <> · top template {analysis.topTemplate.id} × {analysis.topTemplate.n}</>}
      </span>
    </div>
  );
}

function Preview({ analysis }) {
  const top = [...analysis.results].sort((a, b) => b.pressure - a.pressure).slice(0, 8);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="eyebrow">Top 8 by pressure</div>
      {top.map((r) => {
        const tone = r.pressure >= 0.55 ? '#dd6974' : r.pressure >= 0.25 ? '#fdab43' : '#6daa45';
        return (
          <div
            key={r.idx}
            style={{
              padding: '6px 10px',
              borderLeft: `3px solid ${tone}`,
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 4,
              marginTop: 4,
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted small-note">row {r.idx + 1}</span>
              <span style={{ color: tone, fontFamily: 'monospace' }}>{Math.round(r.pressure * 100)}%</span>
            </div>
            <p className="muted" style={{ margin: '2px 0 0', fontStyle: 'italic' }}>
              "{r.text.slice(0, 180)}"
            </p>
          </div>
        );
      })}
    </div>
  );
}
