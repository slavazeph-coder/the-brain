import React, { useMemo, useRef, useState } from 'react';
import {
  runEvolution,
  seedNode
} from '../utils/evolve/loop';
import {
  SAMPLER_KEYS,
  SAMPLER_LABELS,
  SAMPLER_DESCRIPTIONS
} from '../utils/evolve/samplers/factory';
import {
  saveEvolvePool,
  loadEvolvePool,
  clearEvolvePool
} from '../utils/evolve/database';

/**
 * Layer 31 — Brain Evolve
 *
 * Cannibalized from GAIR-NLP/ASI-Evolve: the Learn → Design → Experiment →
 * Analyze loop, UCB1 bandit sampling, and Island + MAP-Elites diversity.
 * Here we apply those primitives to cognitive-firewall rule evolution:
 * each "node" is a candidate ruleset, scored on F1 against the Layer 25
 * red team corpus. UI shows generations → sparkline → leaderboard →
 * promote-winner-to-active-firewall.
 */
export default function BrainEvolvePanel({ onPromote }) {
  const [samplerKey, setSamplerKey] = useState('ucb1');
  const [generations, setGenerations] = useState(4);
  const [populationPerGen, setPopulationPerGen] = useState(4);
  const [status, setStatus] = useState('idle'); // 'idle' | 'running' | 'done'
  const [progress, setProgress] = useState({ round: 0, total: 0 });
  const [pool, setPool] = useState([]);
  const [best, setBest] = useState(null);
  const [bestPerGen, setBestPerGen] = useState([]); // sparkline data
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  const stopRef = useRef(false);

  const total = generations * populationPerGen;

  async function handleStart() {
    stopRef.current = false;
    setStatus('running');
    setError(null);
    setProgress({ round: 0, total });
    setBestPerGen([]);

    const initialPool = [seedNode()];
    try {
      const { pool: finalPool, best: finalBest } = await runEvolution({
        generations,
        populationPerGen,
        samplerKey,
        initialPool,
        onRound: ({ round, child, pool: livePool, generation }) => {
          setPool([...livePool]);
          setProgress({ round, total });
          setBestPerGen((prev) => {
            const g = generation;
            const currentBest = livePool.reduce(
              (acc, n) => ((n.score || 0) > (acc?.score || -1) ? n : acc),
              null
            );
            const next = [...prev];
            next[g - 1] = currentBest?.score || 0;
            return next;
          });
          if ((child.score || 0) > (best?.score || -1)) {
            setBest(child);
          }
        },
        shouldStop: () => stopRef.current
      });
      setPool([...finalPool]);
      setBest(finalBest);
      setStatus('done');
      saveEvolvePool({ pool: finalPool, samplerKey, best: finalBest });
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('idle');
    }
  }

  function handleStop() {
    stopRef.current = true;
  }

  function handleReset() {
    stopRef.current = false;
    setStatus('idle');
    setProgress({ round: 0, total: 0 });
    setPool([]);
    setBest(null);
    setBestPerGen([]);
    setSelectedId(null);
    setError(null);
    clearEvolvePool();
  }

  function handleLoadSaved() {
    const saved = loadEvolvePool();
    if (!saved) {
      setError('No saved pool found.');
      return;
    }
    setPool(saved.pool || []);
    const found = saved.pool?.find((n) => n.id === saved.bestId) || null;
    setBest(found || saved.pool?.[0] || null);
    setStatus('done');
    setError(null);
  }

  function handlePromote() {
    if (!best) return;
    onPromote?.(best);
  }

  const leaderboard = useMemo(() => {
    return [...pool]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5);
  }, [pool]);

  const selected = useMemo(() => {
    if (!selectedId) return best;
    return pool.find((n) => n.id === selectedId) || best;
  }, [selectedId, pool, best]);

  const progressPct =
    status === 'running' && total > 0 ? (progress.round / total) * 100 : 0;

  return (
    <section className="panel panel-pad evolve-panel">
      <div className="eyebrow">Layer 31</div>
      <h2>Brain Evolve</h2>
      <p className="muted">
        Evolves the Cognitive Firewall (Layer 4) by mutating regex rulesets and
        scoring each candidate on F1 vs the red team corpus (Layer 25). Picks
        parents via UCB1 bandit or Island + MAP-Elites diversity — both
        cannibalized from{' '}
        <code style={{ fontSize: 11 }}>GAIR-NLP/ASI-Evolve</code>. Promote the
        winner to replace the live firewall.
      </p>

      <div className="evolve-controls">
        <label className="evolve-field">
          <span>Sampler</span>
          <select
            value={samplerKey}
            onChange={(e) => setSamplerKey(e.target.value)}
            disabled={status === 'running'}
          >
            {SAMPLER_KEYS.map((k) => (
              <option key={k} value={k}>
                {SAMPLER_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="evolve-field">
          <span>Generations</span>
          <input
            type="number"
            min={1}
            max={12}
            value={generations}
            onChange={(e) => setGenerations(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
            disabled={status === 'running'}
          />
        </label>
        <label className="evolve-field">
          <span>Population / gen</span>
          <input
            type="number"
            min={1}
            max={10}
            value={populationPerGen}
            onChange={(e) => setPopulationPerGen(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            disabled={status === 'running'}
          />
        </label>
      </div>

      <p className="muted small-note" style={{ marginTop: 6 }}>
        {SAMPLER_DESCRIPTIONS[samplerKey]}
      </p>

      <div className="evolve-actions">
        {status !== 'running' ? (
          <button className="primary" onClick={handleStart}>
            Run evolution ({total} rounds)
          </button>
        ) : (
          <button className="danger" onClick={handleStop}>
            Stop
          </button>
        )}
        <button onClick={handleReset} disabled={status === 'running'}>
          Reset
        </button>
        <button onClick={handleLoadSaved} disabled={status === 'running'}>
          Load saved pool
        </button>
      </div>

      {error ? (
        <div className="evolve-error" role="alert">
          Error: {error}
        </div>
      ) : null}

      {status === 'running' ? (
        <div className="evolve-progress">
          <div className="evolve-progress-bar" style={{ width: `${progressPct}%` }} />
          <span className="small-note">
            Round {progress.round} / {progress.total}
          </span>
        </div>
      ) : null}

      {bestPerGen.length > 0 ? (
        <BestF1Sparkline data={bestPerGen} />
      ) : null}

      {leaderboard.length > 0 ? (
        <div className="evolve-leaderboard">
          <strong className="muted small-note">
            Top {leaderboard.length} — click to inspect
          </strong>
          <div className="evolve-leaderboard-list">
            {leaderboard.map((node, i) => (
              <button
                key={node.id}
                className={`evolve-leader-row ${selected?.id === node.id ? 'active' : ''}`}
                onClick={() => setSelectedId(node.id)}
              >
                <span className="evolve-rank">#{i + 1}</span>
                <span className="evolve-leader-name">{node.name}</span>
                <span className="evolve-leader-score">
                  F1 {(node.score || 0).toFixed(3)}
                </span>
                <span className="evolve-leader-bin">
                  {node.metaInfo?.featureBin || '—'}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selected ? <NodeDetail node={selected} /> : null}

      {best && status !== 'running' ? (
        <div className="evolve-promote">
          <button className="primary" onClick={handlePromote}>
            Promote winner to active firewall
          </button>
          <span className="small-note muted">
            Replaces Layer 4's live ruleset for this session.
          </span>
        </div>
      ) : null}
    </section>
  );
}

// ---------- subcomponents ----------

function BestF1Sparkline({ data }) {
  const max = Math.max(0.01, ...data.filter((v) => Number.isFinite(v)));
  const width = 280;
  const height = 50;
  const pad = 4;
  const stepX = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const points = data
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (v || 0) / max) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="evolve-sparkline">
      <strong className="muted small-note" style={{ display: 'block', marginBottom: 4 }}>
        Best F1 per generation
      </strong>
      <svg width={width} height={height} role="img" aria-label="Best F1 per generation">
        <polyline
          points={points}
          fill="none"
          stroke="#7dd87f"
          strokeWidth="2"
        />
        {data.map((v, i) => {
          const x = pad + i * stepX;
          const y = pad + (1 - (v || 0) / max) * (height - pad * 2);
          return <circle key={i} cx={x} cy={y} r={3} fill="#7dd87f" />;
        })}
      </svg>
    </div>
  );
}

function NodeDetail({ node }) {
  const summary = node.results?.summary?.thresholds?.[0.3];
  const patternCount = Object.values(node.ruleSet || {}).reduce(
    (a, arr) => a + arr.length,
    0
  );

  return (
    <div className="evolve-detail">
      <div className="evolve-detail-head">
        <span className="evolve-detail-name">{node.name}</span>
        <span className="small-note muted">
          {node.metaInfo?.operator || 'seed'} · {node.metaInfo?.sampler || '—'}
        </span>
      </div>
      {summary ? (
        <div className="evolve-detail-metrics">
          <span>F1 {summary.f1.toFixed(3)}</span>
          <span>DR {(summary.detectionRate * 100).toFixed(0)}%</span>
          <span>FPR {(summary.falsePositiveRate * 100).toFixed(0)}%</span>
          <span>{patternCount} patterns</span>
        </div>
      ) : null}
      {node.analysis ? (
        <div className="evolve-detail-analysis">{node.analysis}</div>
      ) : null}
      {node.motivation ? (
        <div className="evolve-detail-motivation muted small-note">
          motivation: {node.motivation}
        </div>
      ) : null}
      <details className="evolve-detail-rules">
        <summary className="small-note muted">
          View ruleset ({patternCount} patterns)
        </summary>
        <div className="evolve-rules-grid">
          {Object.entries(node.ruleSet || {}).map(([cat, items]) => (
            <div key={cat} className="evolve-rules-cat">
              <strong className="small-note">{cat}</strong>
              <ul>
                {items.map((it, idx) => (
                  <li key={idx}>
                    <code>{it.source}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
