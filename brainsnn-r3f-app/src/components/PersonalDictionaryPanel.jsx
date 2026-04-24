import React, { useEffect, useState } from 'react';
import {
  listEntries, addEntry, removeEntry, clearAll, scanPersonal,
} from '../utils/personalDictionary';

export default function PersonalDictionaryPanel() {
  const [entries, setEntries] = useState(() => listEntries());
  const [phrase, setPhrase] = useState('');
  const [note, setNote] = useState('');
  const [weight, setWeight] = useState(0.6);
  const [tag, setTag] = useState('');
  const [testText, setTestText] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { setEntries(listEntries()); }, []);

  function add() {
    setErr('');
    try {
      addEntry({ phrase, note, weight, tag });
      setEntries(listEntries());
      setPhrase(''); setNote('');
    } catch (e) { setErr(e.message || 'add failed'); }
  }
  function remove(id) { removeEntry(id); setEntries(listEntries()); }
  function wipe() {
    if (!window.confirm('Clear the personal dictionary?')) return;
    clearAll(); setEntries([]);
  }

  const scan = testText.trim() ? scanPersonal(testText) : null;

  return (
    <section className="panel panel-pad personal-dict-panel">
      <div className="eyebrow">Layer 90 · personal dictionary</div>
      <h2>Your own manipulation phrases</h2>
      <p className="muted">
        Add the specific lines you've experienced as manipulative in your own
        life — a phrase an ex used, something a boss reaches for, a family
        member's guilt-trip opener. Each entry gets a personal weight and
        surfaces on every scan, alongside (not instead of) the stock rules.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 100px 80px', gap: 6, marginTop: 10 }}>
        <input
          className="share-input"
          placeholder="Phrase (literal or short fragment)"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <input
          className="share-input"
          placeholder="Note (optional — who / context)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <input
          className="share-input"
          placeholder="tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
        <input
          className="share-input"
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
        <button className="btn primary" onClick={add} disabled={!phrase.trim()}>Add</button>
      </div>

      {err && <p className="muted" style={{ color: '#dd6974' }}>{err}</p>}

      {entries.length === 0 ? (
        <p className="muted small-note" style={{ marginTop: 8 }}>Empty — add your first phrase above.</p>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow">{entries.length} entries</div>
          {entries.map((e) => (
            <div
              key={e.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 130px 80px 80px',
                gap: 8,
                alignItems: 'center',
                padding: '6px 10px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.03)',
                marginTop: 4,
              }}
            >
              <div>
                <strong>"{e.phrase}"</strong>
                {e.note && <span className="muted small-note" style={{ marginLeft: 6 }}>— {e.note}</span>}
              </div>
              <span className="muted small-note">{e.tag || '—'}</span>
              <span className="muted small-note" style={{ fontFamily: 'monospace' }}>w {e.weight.toFixed(2)} · {e.hits}×</span>
              <button className="ghost small" onClick={() => remove(e.id)} style={{ color: '#dd6974' }}>Remove</button>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <button className="ghost small" onClick={wipe} style={{ color: '#dd6974' }}>Wipe all</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="eyebrow">Test against a text</div>
        <textarea
          className="firewall-input"
          placeholder="Paste a message to see which personal entries match…"
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          rows={3}
          style={{ marginTop: 4 }}
        />
        {scan && (
          <div style={{ marginTop: 8 }}>
            <div className="muted small-note">
              Personal pressure contribution: <strong>{Math.round(scan.personalPressure * 100)}%</strong> ·{' '}
              <strong>{scan.matches.length}</strong> entries matched
            </div>
            {scan.matches.map((m) => (
              <div
                key={m.id}
                style={{
                  padding: '4px 10px',
                  borderLeft: '3px solid #dd6974',
                  background: 'rgba(221,105,116,0.06)',
                  borderRadius: 4,
                  marginTop: 4,
                  fontSize: 12,
                }}
              >
                "{m.phrase}" × {m.hits}{' '}
                <span className="muted small-note">
                  (w {m.weight.toFixed(2)} → contribution {m.contribution})
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
