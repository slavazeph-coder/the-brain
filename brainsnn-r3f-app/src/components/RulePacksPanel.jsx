import React, { useEffect, useState } from 'react';
import {
  RULE_PACKS, listInstalledPacks, installPack, uninstallPack, ruleCountForPack,
} from '../utils/rulePacks';

/**
 * Layer 83 — Rule Pack Library panel.
 */
export default function RulePacksPanel() {
  const [installed, setInstalled] = useState(() => listInstalledPacks());
  const [err, setErr] = useState('');

  useEffect(() => { setInstalled(listInstalledPacks()); }, []);

  function install(id) {
    setErr('');
    try {
      installPack(id);
      setInstalled(listInstalledPacks());
    } catch (e) { setErr(e.message || 'install failed'); }
  }
  function uninstall(id) {
    setErr('');
    uninstallPack(id);
    setInstalled(listInstalledPacks());
  }

  return (
    <section className="panel panel-pad rule-packs-panel">
      <div className="eyebrow">Layer 83 · rule pack library</div>
      <h2>Curated rule bundles</h2>
      <p className="muted">
        Enable entire categories of regex at once. Each pack is a tagged
        set of Layer 55 custom rules — install here, uninstall cleanly
        without deleting your own handwritten rules.
      </p>

      {err && <p className="muted" style={{ color: '#dd6974' }}>{err}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginTop: 12 }}>
        {RULE_PACKS.map((p) => {
          const on = installed.includes(p.id);
          return (
            <div
              key={p.id}
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                borderLeft: `3px solid ${on ? '#5ee69a' : 'rgba(255,255,255,0.1)'}`,
                background: on ? 'rgba(94,230,154,0.06)' : 'rgba(255,255,255,0.02)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>{p.label}</strong>
                <span className="muted small-note">{ruleCountForPack(p.id)} rules</span>
              </div>
              <p className="muted" style={{ margin: '4px 0 8px', fontSize: 12, lineHeight: 1.4 }}>{p.desc}</p>
              {on ? (
                <button className="btn-sm" onClick={() => uninstall(p.id)}>Uninstall</button>
              ) : (
                <button className="btn-sm" onClick={() => install(p.id)}>Install</button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
