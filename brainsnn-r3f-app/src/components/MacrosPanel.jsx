import React, { useEffect, useState } from 'react';
import {
  listMacros, saveMacro, removeMacro, runMacro, seedDefaultMacros,
} from '../utils/macros';

/**
 * Layer 60 — Firewall Macros panel.
 */
export default function MacrosPanel() {
  const [macros, setMacros] = useState(() => {
    seedDefaultMacros();
    return listMacros();
  });
  const [newName, setNewName] = useState('');
  const [newSamples, setNewSamples] = useState('');
  const [newExpected, setNewExpected] = useState('high');
  const [err, setErr] = useState('');
  const [results, setResults] = useState({});

  function add() {
    setErr('');
    try {
      const samples = newSamples.split('\n---\n').map((s) => s.trim()).filter(Boolean);
      saveMacro({ name: newName, samples, expected: newExpected });
      setMacros(listMacros());
      setNewName(''); setNewSamples('');
    } catch (e) { setErr(e.message || 'save failed'); }
  }

  function remove(id) {
    removeMacro(id);
    setMacros(listMacros());
    setResults((r) => { const out = { ...r }; delete out[id]; return out; });
  }

  function run(macro) {
    const result = runMacro(macro);
    setResults((r) => ({ ...r, [macro.id]: result }));
  }

  return (
    <section className="panel panel-pad macros-panel">
      <div className="eyebrow">Layer 60 · firewall macros</div>
      <h2>Preset scan suites</h2>
      <p className="muted">
        Save a batch of sample texts as a named macro, then run it
        any time to see how the current Firewall ruleset performs
        against that set. Pair with custom rules (Layer 55) for a
        full iterate-and-test loop.
      </p>

      <div style={{ marginTop: 12 }}>
        <div className="eyebrow">Create macro</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 120px', gap: 8, marginTop: 6 }}>
          <input
            className="share-input"
            placeholder="Macro name"
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 60))}
          />
          <select
            className="share-input"
            value={newExpected}
            onChange={(e) => setNewExpected(e.target.value)}
          >
            <option value="auto">Expected: auto</option>
            <option value="high">Expected: high pressure</option>
            <option value="mid">Expected: mid pressure</option>
            <option value="low">Expected: low pressure</option>
          </select>
          <button className="btn primary" onClick={add} disabled={!newName.trim() || !newSamples.trim()}>
            Save
          </button>
        </div>
        <textarea
          className="firewall-input"
          placeholder={"Sample 1\n---\nSample 2\n---\nSample 3"}
          value={newSamples}
          onChange={(e) => setNewSamples(e.target.value)}
          rows={4}
          style={{ marginTop: 6 }}
        />
        {err && <p className="muted" style={{ color: '#dd6974' }}>{err}</p>}
      </div>

      {macros.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="eyebrow">Your macros</div>
          {macros.map((m) => {
            const result = results[m.id];
            const mean = result ? result.meanPressure : 0;
            const tone = mean >= 0.55 ? '#dd6974' : mean >= 0.25 ? '#fdab43' : '#6daa45';
            return (
              <div
                key={m.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                  marginTop: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{m.name}</strong>
                    <span className="muted small-note" style={{ marginLeft: 8 }}>
                      {m.samples.length} sample{m.samples.length === 1 ? '' : 's'} · expected {m.expected}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-sm" onClick={() => run(m)}>Run</button>
                    <button className="ghost small" onClick={() => remove(m.id)}>Delete</button>
                  </div>
                </div>
                {result && (
                  <div style={{ marginTop: 6 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: `${tone}14`,
                        borderLeft: `3px solid ${tone}`,
                      }}
                    >
                      <span>
                        Mean pressure <strong style={{ color: tone }}>{Math.round(result.meanPressure * 100)}%</strong> · peak{' '}
                        <strong>{Math.round(result.peak.pressure * 100)}%</strong>
                      </span>
                      <strong style={{ color: result.expectedOk === null ? '#94a3b8' : result.expectedOk ? '#5ee69a' : '#dd6974' }}>
                        {result.expectedOk === null ? 'no expectation' : result.expectedOk ? '✓ matches expectation' : '✗ off expectation'}
                      </strong>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      {result.results.map((r) => {
                        const rowTone = r.pressure >= 0.55 ? '#dd6974' : r.pressure >= 0.25 ? '#fdab43' : '#6daa45';
                        return (
                          <div
                            key={r.idx}
                            style={{
                              padding: '4px 10px',
                              borderLeft: `2px solid ${rowTone}`,
                              background: 'rgba(255,255,255,0.02)',
                              marginTop: 4,
                              fontSize: 13,
                              lineHeight: 1.35,
                            }}
                          >
                            <span className="muted small-note">{Math.round(r.pressure * 100)}%</span>{' '}
                            {r.text.slice(0, 160)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
