import React from 'react';
import { LINKS, REGION_INFO } from '../data/network';

function Sparkline({ history }) {
  const width = 220;
  const height = 60;
  if (!history.length) return <div className="spark-empty">Waiting for data…</div>;
  const values = history.map((d) => d.mean);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width;
    const y = height - ((v - min) / Math.max(max - min, 0.001)) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sparkline" role="img" aria-label="Mean firing trend">
      <polyline fill="none" stroke="#4fa8b3" strokeWidth="3" points={points} />
    </svg>
  );
}

export default function InspectorPanel({ state, onSelect }) {
  const selected = state.selected || 'THL';
  const info = REGION_INFO[selected];
  const incoming = LINKS.filter(([, to]) => to === selected).map(([from, to]) => ({ id: `${from}→${to}`, from, to, weight: state.weights[`${from}→${to}`] }));
  const outgoing = LINKS.filter(([from]) => from === selected).map(([from, to]) => ({ id: `${from}→${to}`, from, to, weight: state.weights[`${from}→${to}`] }));
  const activity = state.regions[selected] ?? 0;
  const strongestOutgoing = [...outgoing].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];

  return (
    <aside className="inspector panel">
      <div className="panel-pad">
        <div className="inspector-head">
          <div>
            <div className="eyebrow">Inspector</div>
            <h2>{selected}</h2>
            <p className="muted strong-name">{info.name}</p>
          </div>
          <span className="region-pill" style={{ '--pill': info.color }}>{Math.round(activity * 100)}%</span>
        </div>

        <p className="muted inspector-role">{info.role}</p>

        <div className="inspector-grid">
          <div className="mini-stat"><small>Activity</small><strong>{activity.toFixed(3)}</strong></div>
          <div className="mini-stat"><small>Incoming</small><strong>{incoming.length}</strong></div>
          <div className="mini-stat"><small>Outgoing</small><strong>{outgoing.length}</strong></div>
          <div className="mini-stat"><small>Scenario</small><strong>{state.scenario}</strong></div>
        </div>

        <div className="subsection">
          <div className="subhead-row"><h3>Trend</h3><span className="muted">Mean network firing</span></div>
          <Sparkline history={state.history} />
        </div>

        <div className="subsection">
          <div className="subhead-row"><h3>Strongest outgoing link</h3></div>
          {strongestOutgoing ? (
            <div className="link-highlight">
              <div>
                <strong>{strongestOutgoing.id}</strong>
                <p className="muted">Weight {strongestOutgoing.weight.toFixed(3)}</p>
              </div>
              <div className="weight-bar"><span style={{ width: `${strongestOutgoing.weight * 100}%` }} /></div>
            </div>
          ) : <p className="muted">No outgoing links.</p>}
        </div>

        <div className="subsection">
          <div className="subhead-row"><h3>Incoming pathways</h3></div>
          <div className="table-list">
            {incoming.map((item) => (
              <button key={item.id} className="table-row" onClick={() => onSelect(item.from)}>
                <span>{item.id}</span><span>{item.weight.toFixed(3)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="subsection">
          <div className="subhead-row"><h3>Outgoing pathways</h3></div>
          <div className="table-list">
            {outgoing.map((item) => (
              <button key={item.id} className="table-row" onClick={() => onSelect(item.to)}>
                <span>{item.id}</span><span>{item.weight.toFixed(3)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="subsection">
          <div className="subhead-row"><h3>All regions</h3></div>
          <div className="region-list">
            {Object.entries(state.regions).map(([key, value]) => (
              <button key={key} className={`region-row ${key === selected ? 'active' : ''}`} onClick={() => onSelect(key)}>
                <span>{key}</span>
                <div className="region-row-right">
                  <div className="inline-bar"><span style={{ width: `${value * 100}%`, background: REGION_INFO[key].color }} /></div>
                  <strong>{value.toFixed(2)}</strong>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
