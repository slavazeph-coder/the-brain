import React from 'react';
import { FlaskConical } from 'lucide-react';
import { BenchmarksPanel } from './BenchmarksPanel.jsx';
import { CrumbPhysicsPanel } from './CrumbPhysicsPanel.jsx';
import { LAYER_CATALOG, LAYER_GROUPS, searchLayers } from '../../lib/layerCatalog.js';

function LayerExplorer() {
  const [query, setQuery] = React.useState('');
  const [group, setGroup] = React.useState('all');
  const layers = React.useMemo(() => searchLayers(query, group), [query, group]);
  return (
    <section className="research-panel layer-explorer-panel">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Layer Explorer</p>
          <h2>{LAYER_CATALOG.length} BrainSNN layers indexed</h2>
        </div>
        <span className="bsn-mono">{layers.length} shown</span>
      </div>
      <div className="layer-explorer-controls">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search layer, group or number..." />
        <select value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="all">All groups</option>
          {Object.entries(LAYER_GROUPS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
        </select>
      </div>
      <div className="layer-explorer-list">
        {layers.map((layer) => {
          const meta = LAYER_GROUPS[layer.group] || {};
          return (
            <article key={layer.id} style={{ '--layer-color': meta.color || '#00f5ff' }}>
              <span>L{layer.id}</span>
              <div>
                <strong>{layer.name}</strong>
                <p>{layer.blurb}</p>
              </div>
              <small>{meta.label || layer.group}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ResearchDrawer() {
  return (
    <div className="research-workspace" data-testid="research-workspace">
      <header className="workspace-heading">
        <p className="bsn-kicker">Research</p>
        <h1>Advanced SNN and Crumb lab.</h1>
        <p>Technical material is preserved here so the default product remains focused on business decisions and rewrite workflow.</p>
      </header>
      <div className="research-summary">
        <article>
          <h3>Production</h3>
          <p>Analyze, Improve, Autopsy, History, Pricing, layer traces, deterministic firewall signals, TRIBE projection, Context Memory and export.</p>
        </article>
        <article>
          <h3>Experimental</h3>
          <p>TRIBE live prediction, Gemma multimodal analysis, Crumb LLM physics, rule evolution, RAG, MCP bridge, EEG and benchmarks remain clearly labeled.</p>
        </article>
      </div>
      <LayerExplorer />
      <CrumbPhysicsPanel />
      <BenchmarksPanel />
      <section className="legacy-lab-shell">
        <div>
          <p className="bsn-eyebrow">Legacy lab</p>
          <h2>Earlier BrainSNN research surface preserved</h2>
          <p className="bsn-note">
            The previous 35+ layer lab remains in source under components and features/research/LegacyResearchApp.jsx.
            It is intentionally not mounted in the buyer workflow because it bundles many experimental demos and slowed
            production builds.
          </p>
        </div>
        <FlaskConical size={28} aria-hidden="true" />
      </section>
      <section className="research-panel">
        <p className="bsn-eyebrow">Moved out of primary workflow</p>
        <h2>Technical demos now live behind Research</h2>
        <ul className="research-list">
          <li>Crumb LLM physics tuner and wave parameters</li>
          <li>Cognitive firewall and red-team demonstrations</li>
          <li>Legacy share-card experiments and browser extension demos</li>
          <li>Experimental video/reel, benchmark, EEG and simulation surfaces</li>
        </ul>
      </section>
    </div>
  );
}
