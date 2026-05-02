import React, { useMemo, useState } from 'react';
import { scoreContent } from '../utils/cognitiveFirewall';
import { getImmunityState } from '../utils/immunityScore';

/**
 * Layer 102.5 — Home (the simple view).
 *
 * Inline firewall scan. Immunity glance. Two doors out: focus on
 * scanning, or open the full panel surface. No navigation required
 * to do the most common thing.
 */
export default function HomeDeck({ onScan, onDiagnose, onAll }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const immunity = useMemo(() => {
    try { return getImmunityState(); } catch { return null; }
  }, [result]);

  function runScan() {
    if (!text.trim()) return;
    setResult(scoreContent(text));
  }

  const tone = (
    !result ? '#7a8fe7'
      : result.manipulationPressure >= 0.6 ? '#dd6974'
        : result.manipulationPressure >= 0.3 ? '#fdab43'
          : '#5ee69a'
  );
  const tier = (
    !result ? null
      : result.manipulationPressure >= 0.6 ? 'High pressure'
        : result.manipulationPressure >= 0.3 ? 'Tilted'
          : 'Calm'
  );

  return (
    <section className="panel panel-pad home-deck">
      <div className="eyebrow">Home · the simple view</div>
      <h2>Watch the brain. Scan when curious.</h2>
      <p className="muted">
        The 3D viewer above is the whole point. Try a quick scan below,
        or jump into a focused workflow.
      </p>

      <div className="home-scan-box">
        <textarea
          className="firewall-input"
          rows={3}
          placeholder="Paste a tweet, headline, or paragraph to scan…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ minHeight: 80 }}
        />
        <div className="control-actions" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={runScan} disabled={!text.trim()}>
            Quick scan
          </button>
          <button className="ghost small" onClick={() => { setText(''); setResult(null); }}>
            Clear
          </button>
        </div>
        {result && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 14px',
              borderRadius: 8,
              background: `${tone}14`,
              borderLeft: `3px solid ${tone}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong style={{ color: tone }}>
                {tier} · {Math.round(result.manipulationPressure * 100)}/100 pressure
              </strong>
              <span className="muted small-note">
                {result.languageLabel || 'en'} · {(result.evidence || []).length} evidence
              </span>
            </div>
            {result.recommendedAction && (
              <p className="muted small-note" style={{ margin: '6px 0 0' }}>
                {result.recommendedAction}
              </p>
            )}
            {result.templates?.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.templates.slice(0, 5).map((t) => (
                  <span
                    key={t.id}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'rgba(168,111,223,0.18)',
                      color: '#a86fdf',
                    }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="home-side-cards">
        {immunity && (
          <div className="home-side-card">
            <div className="eyebrow">Cognitive immunity</div>
            <strong style={{ fontSize: 22 }}>{Math.round(immunity.score || 0)}</strong>
            <span className="muted small-note"> / 100 · streak {immunity.streak || 0}</span>
          </div>
        )}
        <div className="home-side-card">
          <div className="eyebrow">Quick jumps</div>
          <div className="home-action-row" style={{ marginTop: 6 }}>
            <button className="btn-sm" onClick={onScan}>Focus: Scan</button>
            <button className="btn-sm" onClick={onDiagnose}>Focus: Diagnose</button>
            <button className="ghost small" onClick={onAll}>All panels</button>
          </div>
        </div>
      </div>

      <p className="muted small-note" style={{ marginTop: 14 }}>
        Hit <kbd>⌘K</kbd> for fuzzy-search jump · <kbd>?</kbd> for keyboard shortcuts.
      </p>
    </section>
  );
}
