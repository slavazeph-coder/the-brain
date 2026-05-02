import React, { useMemo, useState } from 'react';
import { computeBrandRisk, brandBriefMarkdown, splitItems } from '../utils/brandRisk.js';

/**
 * Layer 106 — Brand Risk Scorecard
 *
 * Per-brand aggregator over the Cognitive Firewall + Templates +
 * Archetypes. Paste a brand name + a list of items (mentions, ad copy,
 * reviews, replies), get a single 0–100 score with a tier, the dominant
 * archetypes, the most-fired templates, and the worst items.
 *
 * Surfaces the affective-intelligence positioning to teams who don't
 * scan one tweet at a time — they read inboxes, mention streams, ad
 * libraries, and need the headline number first.
 */

const SAMPLE = `Act now or you'll miss the launch — only 12 spots left and our CEO personally vouches for every founder we let in. The window closes at midnight.
---
Honestly, every one of you who's still defending this brand needs to look in the mirror. You're either with us or you're part of the problem. Wake up.
---
We've quietly rolled out a small UX update this week. Let us know if anything feels off — we're tracking feedback in the linked thread and will iterate next sprint.
---
URGENT: Your account has been flagged for unusual activity. Verify your identity within 24 hours or access will be permanently suspended. Click below to confirm.
---
The mainstream press will never tell you the real story behind this acquisition. The truth is hidden in plain sight. Connect the dots.`;

export default function BrandRiskPanel() {
  const [brand, setBrand] = useState('');
  const [blob, setBlob] = useState('');
  const [report, setReport] = useState(null);
  const [copied, setCopied] = useState(false);

  const itemCountPreview = useMemo(() => splitItems(blob).length, [blob]);

  function handleScan() {
    const items = splitItems(blob);
    const next = computeBrandRisk(items);
    setReport(next);
  }

  function handleSample() {
    setBlob(SAMPLE);
    if (!brand) setBrand('Sample Brand');
  }

  function handleClear() {
    setBlob('');
    setReport(null);
  }

  async function handleCopyBrief() {
    if (!report) return;
    const md = brandBriefMarkdown(brand, report);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (_err) {
      setCopied(false);
    }
  }

  return (
    <section className="panel panel-pad brand-risk-panel">
      <div className="eyebrow">Layer 106 · brand risk scorecard</div>
      <h2 style={{ marginTop: 4 }}>Score a brand's emotional payload</h2>
      <p className="muted" style={{ maxWidth: 720 }}>
        Paste a name and a stream of mentions, ad variants, reviews, or replies. The engine scores
        every item, names the manipulation archetypes that fire, and rolls them into a single 0–100
        risk number with a clear tier.
      </p>

      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        <input
          type="text"
          placeholder="Brand or entity (e.g. Acme, @handle, Channel 7…)"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="brand-risk-input"
          style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', color: '#f1ece5' }}
        />
        <textarea
          placeholder={'Paste items separated by blank lines or --- delimiters.\n\nE.g. mentions, ad creative variants, reviews, inbound replies…'}
          value={blob}
          onChange={(e) => setBlob(e.target.value)}
          rows={10}
          style={{ padding: '12px', borderRadius: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', color: '#f1ece5', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={handleScan} disabled={!blob.trim()}>Score brand</button>
          <button className="btn-sm" onClick={handleSample}>Load sample</button>
          <button className="btn-sm" onClick={handleClear} disabled={!blob && !report}>Clear</button>
          <span className="muted small-note" style={{ marginLeft: 'auto' }}>
            {itemCountPreview} item{itemCountPreview === 1 ? '' : 's'} detected
          </span>
        </div>
      </div>

      {report && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '14px 16px',
              borderRadius: 10,
              borderLeft: `4px solid ${report.tier.color}`,
              background: 'rgba(0,0,0,0.22)',
            }}
          >
            <div>
              <div className="muted small-note">Brand Risk</div>
              <strong style={{ fontSize: 44, color: report.tier.color, lineHeight: 1 }}>{report.score}</strong>
              <span className="muted" style={{ marginLeft: 8 }}>/ 100</span>
            </div>
            <div>
              <div className="muted small-note">Tier</div>
              <strong style={{ fontSize: 20, color: report.tier.color }}>{report.tier.label}</strong>
            </div>
            <div>
              <div className="muted small-note">Items scored</div>
              <strong style={{ fontSize: 20 }}>{report.itemCount}</strong>
            </div>
            <div>
              <div className="muted small-note">Mean pressure</div>
              <strong style={{ fontSize: 20 }}>{Math.round(report.meanPressure * 100)}%</strong>
            </div>
            <div>
              <div className="muted small-note">Peak pressure</div>
              <strong style={{ fontSize: 20 }}>{Math.round(report.peakPressure * 100)}%</strong>
            </div>
            <div>
              <div className="muted small-note">High-risk items</div>
              <strong style={{ fontSize: 20 }}>{report.highRiskCount}</strong>
            </div>
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={handleCopyBrief}>
              {copied ? 'Copied' : 'Copy brief (Markdown)'}
            </button>
          </div>

          {report.topArchetypes.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Dominant archetypes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {report.topArchetypes.map((a) => (
                  <span
                    key={a.id}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      background: a.highRisk ? 'rgba(216,110,120,0.18)' : 'rgba(168,111,223,0.16)',
                      border: `1px solid ${a.highRisk ? 'rgba(216,110,120,0.55)' : 'rgba(168,111,223,0.45)'}`,
                      color: '#f1ece5',
                    }}
                    title={a.highRisk ? 'High-risk archetype' : 'Archetype'}
                  >
                    {a.label} · {a.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {report.topTemplates.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Most-fired templates</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {report.topTemplates.map((t) => (
                  <span
                    key={t.id}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      background: 'rgba(95,183,193,0.14)',
                      border: '1px solid rgba(95,183,193,0.4)',
                      color: '#f1ece5',
                    }}
                  >
                    {t.label} · {t.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {report.worstItems.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Worst items</div>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 10 }}>
                {report.worstItems.map((it, idx) => {
                  const pct = Math.round(it.pressure * 100);
                  return (
                    <li key={idx} style={{ background: 'rgba(0,0,0,0.18)', padding: '10px 12px', borderRadius: 8 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong style={{ color: pct >= 60 ? '#d86e78' : pct >= 35 ? '#fdab43' : '#5ee69a' }}>
                          {pct}%
                        </strong>
                        {it.archetypes.slice(0, 3).map((a) => (
                          <span
                            key={a.id}
                            className="muted small-note"
                            style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.05)' }}
                          >
                            {a.label}
                          </span>
                        ))}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>{it.excerpt}</div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {report.itemCount === 0 && (
            <p className="muted" style={{ marginTop: 12 }}>
              No items long enough to score. Each item should be at least 5 words.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
