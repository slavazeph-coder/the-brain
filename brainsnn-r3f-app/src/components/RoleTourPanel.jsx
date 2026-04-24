import React, { useState } from 'react';

/**
 * Layer 94 — Role-based Guided Tour
 *
 * Picks 6–8 panels tailored to a stated role (writer / parent /
 * developer / security pro / researcher). Each step is a short
 * "go here, try this" prompt. Uses the same flash-panel trick as
 * the command palette to scroll + highlight in sequence.
 */

const ROLES = [
  {
    id: 'writer',
    label: 'Writer / editor',
    blurb: 'Spot manipulation in your own drafts and in copy you\'re reviewing.',
    steps: [
      { layer: 4, tip: 'Paste a paragraph of your draft. The Firewall scores it on 4 dimensions.' },
      { layer: 40, tip: 'Expand the Sentence Heatmap to see which exact sentence spikes.' },
      { layer: 42, tip: 'Hit Neutralize to get a de-manipulated rewrite you can start from.' },
      { layer: 68, tip: 'Inverse check — pick a style and see what "drift" looks like.' },
      { layer: 51, tip: 'Compare an edited paragraph to your earlier draft for style-match.' },
      { layer: 84, tip: 'Star scans you want to revisit; export as CSV for a piece.' },
    ],
  },
  {
    id: 'parent',
    label: 'Parent / caregiver',
    blurb: 'Track patterns in texts / DMs / group chats that matter to you.',
    steps: [
      { layer: 63, tip: 'Tag scans with a name (e.g. "school", "coach") so patterns cluster.' },
      { layer: 36, tip: 'Paste a group chat into Autopsy Mode — see per-speaker pressure.' },
      { layer: 43, tip: 'Time-Series Autopsy for a string of messages over weeks.' },
      { layer: 62, tip: 'Hypothesis Mode: state what you suspect, paste evidence.' },
      { layer: 41, tip: 'Every detected template has a copy-ready counter-response.' },
      { layer: 50, tip: 'Weekly Recap gives you a take-stock moment every Sunday.' },
    ],
  },
  {
    id: 'developer',
    label: 'Developer / builder',
    blurb: 'Integrate, extend, and expose BrainSNN from your own apps.',
    steps: [
      { layer: 54, tip: 'Public API panel — Try-it-live button exercises POST /api/score.' },
      { layer: 76, tip: 'Stream API emits per-dimension events; wire a live UI to it.' },
      { layer: 19, tip: 'MCP bridge — 25 JSON-RPC tools an agent can drive end-to-end.' },
      { layer: 81, tip: 'Browser extension source — drop it in a folder + Load Unpacked.' },
      { layer: 55, tip: 'Custom rules editor with import/export. Feeds the active ruleset.' },
      { layer: 61, tip: 'Diagnostic: audit the active rules against the red-team corpus.' },
    ],
  },
  {
    id: 'security',
    label: 'Security pro',
    blurb: 'Reverse-engineer manipulation patterns; contribute back.',
    steps: [
      { layer: 25, tip: '65-sample red-team corpus; scored against the active rules with F1 + A-F grade.' },
      { layer: 27, tip: 'Adversarial training: learn n-gram patterns from misses, promote.' },
      { layer: 31, tip: 'Evolve firewall rulesets with UCB1 + MAP-Elites sampler.' },
      { layer: 32, tip: 'Co-evolve attacks to dodge the current ruleset — closes the arms race.' },
      { layer: 53, tip: 'Echo detector for coordinated-campaign signatures in a message batch.' },
      { layer: 46, tip: 'Every scan ships a deterministic receipt you can reference in reports.' },
    ],
  },
  {
    id: 'researcher',
    label: 'Researcher / reporter',
    blurb: 'Run large batches, track patterns over time, publish findings.',
    steps: [
      { layer: 85, tip: 'Paste a CSV / JSON array. Every row scored; export gets bsnn_* columns.' },
      { layer: 44, tip: 'Inbox Mode for pressure-ranked triage of a message archive.' },
      { layer: 67, tip: 'Calendar heatmap of your scan activity, GitHub-style.' },
      { layer: 57, tip: 'Export / import / wipe your whole BrainSNN state.' },
      { layer: 70, tip: 'Explanation Mode gives you a paragraph you can quote for every scan.' },
      { layer: 74, tip: 'Comparator: run the same corpus through defaults vs. custom rules.' },
    ],
  },
];

function flashLayer(layerId) {
  try {
    const re = new RegExp(`\\blayer\\s*${layerId}\\b`, 'i');
    const labels = document.querySelectorAll('.eyebrow');
    for (const el of labels) {
      if (re.test(el.textContent || '')) {
        const panel = el.closest('.panel');
        if (!panel) continue;
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = panel.style.boxShadow;
        panel.style.transition = 'box-shadow 400ms ease';
        panel.style.boxShadow = '0 0 0 3px rgba(90,212,255,0.6)';
        setTimeout(() => { panel.style.boxShadow = prev; }, 1500);
        return true;
      }
    }
  } catch { /* noop */ }
  return false;
}

export default function RoleTourPanel() {
  const [roleId, setRoleId] = useState(null);
  const [step, setStep] = useState(0);

  const role = ROLES.find((r) => r.id === roleId);

  function start(id) { setRoleId(id); setStep(0); }
  function goTo(i) {
    setStep(i);
    const layer = role?.steps[i]?.layer;
    if (layer != null) flashLayer(layer);
  }

  return (
    <section className="panel panel-pad role-tour-panel">
      <div className="eyebrow">Layer 94 · role tour</div>
      <h2>Find the path that fits you</h2>
      <p className="muted">
        BrainSNN has 90+ layers. Pick your role and step through the
        6 most relevant panels for your use case. Each step scrolls
        that panel into view and highlights it.
      </p>

      {!role && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
          {ROLES.map((r) => (
            <button
              key={r.id}
              onClick={() => start(r.id)}
              className="btn"
              style={{ textAlign: 'left', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <strong>{r.label}</strong>
              <span className="muted small-note" style={{ fontSize: 12 }}>{r.blurb}</span>
              <span className="muted small-note" style={{ fontSize: 11 }}>{r.steps.length} steps</span>
            </button>
          ))}
        </div>
      )}

      {role && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{role.label}</strong>
            <button className="ghost small" onClick={() => setRoleId(null)}>change role</button>
          </div>
          <p className="muted small-note">{role.blurb}</p>
          <div style={{ marginTop: 10 }}>
            {role.steps.map((s, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 1fr 90px',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 6,
                  borderLeft: `3px solid ${i === step ? '#5ad4ff' : 'rgba(255,255,255,0.08)'}`,
                  background: i === step ? 'rgba(90,212,255,0.08)' : 'rgba(255,255,255,0.02)',
                  marginTop: 4,
                }}
              >
                <span className="muted" style={{ fontFamily: 'monospace', alignSelf: 'center' }}>L{s.layer}</span>
                <span style={{ lineHeight: 1.4 }}>{s.tip}</span>
                <button className="btn-sm" onClick={() => goTo(i)}>Jump</button>
              </div>
            ))}
          </div>
          <p className="muted small-note" style={{ marginTop: 10 }}>
            ⌘K opens the Command Palette any time to jump to a different layer.
          </p>
        </div>
      )}
    </section>
  );
}
