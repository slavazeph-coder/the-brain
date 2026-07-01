import React from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { LAYER_GROUPS, LAYER_CATALOG } from '../../lib/layerCatalog.js';

export function LayerTracePanel({ result }) {
  const layers = Array.isArray(result?.layersUsed) ? result.layersUsed : [];
  const trace = Array.isArray(result?.engineTrace) ? result.engineTrace : [];
  const firewall = result?.firewallSignals;
  const affect = result?.affectProfile;
  const tribe = result?.tribeProjection;
  if (!layers.length && !trace.length) return null;

  return (
    <section className="layer-trace-panel" aria-labelledby="layer-trace-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">{LAYER_CATALOG.length}-layer engine</p>
          <h2 id="layer-trace-heading">Layers used in this scan</h2>
        </div>
        <Badge tone="cyan">{layers.length || trace.length} active layers</Badge>
      </div>

      <div className="layer-chip-grid">
        {layers.map((layer) => {
          const group = LAYER_GROUPS[layer.group] || {};
          return (
            <div key={layer.id} className="layer-chip" style={{ '--layer-color': group.color || '#00f5ff' }}>
              <span>L{layer.id}</span>
              <strong>{layer.name}</strong>
              <small>{group.label || layer.group}</small>
            </div>
          );
        })}
      </div>

      <div className="engine-trace-grid">
        <article>
          <h3>Firewall signals</h3>
          {firewall ? (
            <dl>
              <div><dt>Manipulation pressure</dt><dd>{Math.round((firewall.manipulationPressure || 0) * 100)}</dd></div>
              <div><dt>Trust erosion</dt><dd>{Math.round((firewall.trustErosion || 0) * 100)}</dd></div>
              <div><dt>Templates</dt><dd>{(firewall.templates || []).map((item) => item.label).join(', ') || 'None'}</dd></div>
            </dl>
          ) : <p className="bsn-note">No firewall signal payload returned.</p>}
        </article>
        <article>
          <h3>Affect + context</h3>
          <dl>
            <div><dt>Dominant affect</dt><dd>{affect?.dominantAffect || 'n/a'}</dd></div>
            <div><dt>Genre</dt><dd>{result?.contextTriggers?.genre || 'n/a'}</dd></div>
            <div><dt>Context prompt</dt><dd>{result?.contextTriggers?.memoryPrompt || 'Save to History to build context.'}</dd></div>
          </dl>
        </article>
        <article>
          <h3>TRIBE projection</h3>
          <dl>
            <div><dt>Status</dt><dd>{tribe?.status || tribe?.source || 'not_configured'}</dd></div>
            <div><dt>Scenario</dt><dd>{tribe?.scenario || 'Organic Baseline'}</dd></div>
            <div><dt>Receipt</dt><dd>{result?.receipt?.id || 'n/a'}</dd></div>
          </dl>
        </article>
      </div>

      <ol className="engine-trace-list">
        {trace.map((item, index) => (
          <li key={`${item.stage}-${index}`}>
            <strong>{item.stage}</strong>
            <span>{item.status}</span>
            <p>{item.note}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
