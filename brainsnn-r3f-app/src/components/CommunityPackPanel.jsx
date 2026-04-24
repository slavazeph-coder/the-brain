import React, { useEffect, useState } from 'react';
import { CATEGORIES, applyMergedRules } from '../utils/customRules';

const INSTALL_KEY = 'brainsnn_custom_rules_v1';
const INSTALLED_PACKS_KEY = 'brainsnn_installed_packs_v1';

function readRules() {
  try { return JSON.parse(localStorage.getItem(INSTALL_KEY) || '[]'); } catch { return []; }
}
function writeRules(list) {
  try { localStorage.setItem(INSTALL_KEY, JSON.stringify(list)); } catch { /* quota */ }
}
function readInstalled() {
  try { return JSON.parse(localStorage.getItem(INSTALLED_PACKS_KEY) || '[]'); } catch { return []; }
}
function writeInstalled(ids) {
  try { localStorage.setItem(INSTALLED_PACKS_KEY, JSON.stringify(ids)); } catch { /* quota */ }
}

export default function CommunityPackPanel() {
  const [pack, setPack] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [installed, setInstalled] = useState(() => readInstalled());
  const [info, setInfo] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/community-pack');
      const data = await r.json();
      if (!r.ok) { setErr(data.error || `HTTP ${r.status}`); return; }
      setPack(data.pack);
    } catch (e) { setErr(e.message || 'load failed'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const isOn = pack ? installed.includes(pack.id) : false;

  function install() {
    if (!pack) return;
    const existing = readRules();
    if (existing.some((r) => r.tag === `pack:${pack.id}`)) return;
    const added = [];
    for (const r of pack.rules) {
      if (!CATEGORIES.includes(r.category)) continue;
      added.push({
        id: `pack_${pack.id}_${added.length}_${Date.now()}`,
        category: r.category,
        pattern: r.pattern,
        flags: r.flags || 'gi',
        label: r.label || pack.name,
        tag: `pack:${pack.id}`,
        ts: Date.now(),
      });
    }
    writeRules([...existing, ...added]);
    const ids = readInstalled();
    if (!ids.includes(pack.id)) writeInstalled([...ids, pack.id]);
    setInstalled(readInstalled());
    applyMergedRules();
    setInfo(`Installed ${added.length} rules.`);
  }

  function uninstall() {
    if (!pack) return;
    const filtered = readRules().filter((r) => r.tag !== `pack:${pack.id}`);
    writeRules(filtered);
    writeInstalled(readInstalled().filter((x) => x !== pack.id));
    setInstalled(readInstalled());
    applyMergedRules();
    setInfo('Uninstalled.');
  }

  return (
    <section className="panel panel-pad community-pack-panel">
      <div className="eyebrow">Layer 99 · community firewall · pack of the week</div>
      <h2>Rotating community rules</h2>
      <p className="muted">
        A rule pack curated from the community feed, rotated once a UTC
        week. Installs via the same Layer 83 plumbing as the built-in
        packs — tagged so your handwritten rules are never touched.
      </p>

      <div className="control-actions" style={{ marginTop: 8 }}>
        <button className="btn" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {err && <p className="muted" style={{ color: '#dd6974' }}>{err}</p>}

      {pack && (
        <div
          style={{
            marginTop: 12,
            padding: '14px 16px',
            borderRadius: 10,
            borderLeft: `3px solid ${isOn ? '#5ee69a' : '#5ad4ff'}`,
            background: isOn ? 'rgba(94,230,154,0.06)' : 'rgba(90,212,255,0.04)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{pack.name}</strong>
            <span className="muted small-note">{pack.rules.length} rules</span>
          </div>
          <p className="muted" style={{ margin: '6px 0', fontSize: 13, lineHeight: 1.45 }}>{pack.desc}</p>

          <div style={{ marginTop: 8 }}>
            {pack.rules.slice(0, 5).map((r, i) => (
              <div
                key={i}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.03)',
                  marginTop: 4,
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
              >
                <strong style={{ color: '#a86fdf' }}>{r.category}</strong>{' '}
                /{r.pattern}/
                {r.label && <span className="muted small-note" style={{ marginLeft: 6 }}>— {r.label}</span>}
              </div>
            ))}
          </div>

          <div className="control-actions" style={{ marginTop: 10 }}>
            {isOn ? (
              <button className="btn" onClick={uninstall}>Uninstall</button>
            ) : (
              <button className="btn primary" onClick={install}>Install pack</button>
            )}
          </div>
        </div>
      )}

      {info && <p className="muted small-note" style={{ color: '#5ee69a', marginTop: 6 }}>{info}</p>}
    </section>
  );
}
