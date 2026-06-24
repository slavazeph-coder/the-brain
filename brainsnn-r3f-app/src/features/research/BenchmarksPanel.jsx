import React from 'react';

export function BenchmarksPanel() {
  return (
    <section className="research-panel" aria-labelledby="benchmarks-panel-heading">
      <p className="bsn-eyebrow">Benchmarks</p>
      <h2 id="benchmarks-panel-heading">Claims status</h2>
      <p>
        Any benchmark, reel, cognitive firewall or video demonstration carried from the earlier lab is
        treated as experimental unless a reproducible test exists in the repository.
      </p>
      <div className="research-summary">
        <article>
          <h3>Production functionality</h3>
          <p>Scan, verdict, recommendations, local memory, local queue and export.</p>
        </article>
        <article>
          <h3>Experimental functionality</h3>
          <p>SNN visual simulations, research panels, legacy share modes and technical demos.</p>
        </article>
      </div>
    </section>
  );
}
