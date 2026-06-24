import React from 'react';

export function CrumbPhysicsPanel() {
  return (
    <section className="research-panel" aria-labelledby="crumb-panel-heading">
      <p className="bsn-eyebrow">Experimental</p>
      <h2 id="crumb-panel-heading">Crumb LLM and physics layer</h2>
      <p>
        These controls explain the research metaphor behind BrainSNN: signal propagation, damping,
        cognitive firewall ideas and local demonstration models. They are not presented as literal
        brain measurement or validated biometric inference.
      </p>
      <div className="research-grid">
        <div><span>Signal model</span><strong>Content response estimate</strong></div>
        <div><span>Physics state</span><strong>Simulated demonstration</strong></div>
        <div><span>Crumb model</span><strong>Experimental local fallback</strong></div>
        <div><span>Production role</span><strong>Advanced explanation only</strong></div>
      </div>
    </section>
  );
}
