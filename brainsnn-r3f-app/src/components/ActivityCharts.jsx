import React from 'react';

function Bars({ values, color }) {
  return (
    <div className="bars">
      {values.map((v, i) => (
        <div key={i} className="bar" style={{ height: `${Math.max(8, v * 100)}%`, background: color }} />
      ))}
    </div>
  );
}

export default function ActivityCharts({ state }) {
  const activityValues = Object.values(state.regions);
  const plasticityValues = Object.values(state.weights);

  return (
    <section className="panel panel-pad charts-panel">
      <div className="chart-block">
        <div className="subhead-row"><h3>Region activity</h3><span className="muted">Live values</span></div>
        <Bars values={activityValues} color="linear-gradient(180deg,#4fa8b3,#74d8e2)" />
        <div className="chart-labels">{Object.keys(state.regions).map((k) => <span key={k}>{k}</span>)}</div>
      </div>

      <div className="chart-block">
        <div className="subhead-row"><h3>Pathway plasticity</h3><span className="muted">Current weights</span></div>
        <Bars values={plasticityValues} color="linear-gradient(180deg,#e8b934,#ffd97a)" />
        <div className="chart-labels small">{Object.keys(state.weights).map((k) => <span key={k}>{k}</span>)}</div>
      </div>
    </section>
  );
}
