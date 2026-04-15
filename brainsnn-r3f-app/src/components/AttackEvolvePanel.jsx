import React, { useMemo, useRef, useState } from 'react';
import { runAttackEvolution, seedAttackPool } from '../utils/evolve/attackLoop';
import {
  SAMPLER_KEYS,
  SAMPLER_LABELS,
  SAMPLER_DESCRIPTIONS
} from '../utils/evolve/samplers/factory';
import {
  getAttackCorpus,
  addCustomAttack,
  resetAttackCorpus,
  ATTACK_CATEGORIES
} from '../utils/redTeam';

/**
 * Layer 32 — Attack Evolve (co-evolution counterpart to Layer 31)
 *
 * Evolves the attack corpus to dodge the current active firewall. Each
 * candidate is scored on evasion = 1 − detected manipulation pressure,
 * penalized when the child no longer resembles an attack (continuity).
 * Evolved attacks that slip past can be promoted into the live red team
 * corpus (Layer 25), making Layer 31 face a harder benchmark next round.
 */
export default function AttackEvolvePanel({ onAttackPromoted }) {
  const [samplerKey, setSamplerKey] = useState('ucb1');
  const [generations, setGenerations] = useState(4);
  const [populationPerGen, setPopulationPerGen] = useState(4);
  const [seedCategories, setSeedCategories] = useState(['combo', 'urgency', 'fear']);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ round: 0, total: 0 });
  const [pool, setPool] = useState([]);
  const [best, setBest] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const stopRef = useRef(false);

  const total = generations * populationPerGen;

  function toggleCategory(cat) {
    setSeedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  async function handleStart() {
    stopRef.current = false;
    setStatus('running');
    setError(null);
    setProgress({ round: 0, total });

    const corpus = getAttackCorpus();
    const initialPool = seedAttackPool(corpus, {
      categories: seedCategories.length ? seedCategories : ['combo'],
      perCategory: 2
    });
    if (initialPool.length === 0) {
      setError('No seed attacks selected.');
      setStatus('idle');
      return;
    }

    try {
      const { pool: finalPool, best: finalBest } = await runAttackEvolution({
        generations,
        populationPerGen,
        samplerKey,
        initialPool,
        onRound: ({ round, pool: livePool, child }) => {
          setPool([...livePool]);
          setProgress({ round, total });
          if ((child.score || 0) > (best?.score || -1)) {
            setBest(child);
          }
        },
        shouldStop: () => stopRef.current
      });
      setPool([...finalPool]);
      setBest(finalBest);
      setStatus('done');
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
    setSelectedId(null);
    setError(null);
  }

  function handlePromote(node) {
    if (!node) return;
    const category = node.origin || 'combo';
    const ok = addCustomAttack(node.text, category);
    if (ok) onAttackPromoted?.(node, category);
  }

  function handleResetCorpus() {
    resetAttackCorpus();
    onAttackPromoted?.(null, null); // signal corpus-reset upward
  }

  const leaderboard = useMemo(() => {
    return [...pool].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
  }, [pool]);

  const selected = useMemo(
    () => pool.find((n) => n.id === selectedId) || best,
    [selectedId, pool, best]
  );

  const progressPct = status === 'running' && total > 0 ? (progress.round / total) * 100 : 0;

  return (
    <section className="panel panel-pad attack-panel">
      <div className="eyebrow">Layer 32</div>
      <h2>Attack Evolve</h2>
      <p className="muted">
        Co-evolution counterpart to Layer 31. Mutates attack strings to dodge
        the <em>currently active</em> firewall — injects benign framing, softens
        trigger synonyms, splits letters across word boundaries. Higher evasion
        = sneakier. Promote winners into the red team corpus so the next Layer
        31 evolution round faces a harder benchmark.
      </p>

      <div className="attack-controls">
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
            max={10}
            value={generations}
            onChange={(e) => setGenerations(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            disabled={status === 'running'}
          />
        </label>
        <label className="evolve-field">
          <span>Population / gen</span>
          <input
            type="number"
            min={1}
            max={8}
            value={populationPerGen}
            onChange={(e) => setPopulationPerGen(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
            disabled={status === 'running'}
          />
        </label>
      </div>

      <p className="muted small-note">{SAMPLER_DESCRIPTIONS[samplerKey]}</p>

      <div className="attack-seed-picker">
        <strong className="muted small-note" style={{ display: 'block', marginBottom: 4 }}>
          Seed from categories
        </strong>
        <div className="attack-seed-chips">
          {ATTACK_CATEGORIES.filter((c) => c !== 'benign').map((cat) => (
            <button
              key={cat}
              className={`attack-seed-chip ${seedCategories.includes(cat) ? 'active' : ''}`}
              onClick={() => toggleCategory(cat)}
              disabled={status === 'running'}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="evolve-actions">
        {status !== 'running' ? (
          <button className="primary" onClick={handleStart}>
            Run attack evolution ({total} rounds)
          </button>
        ) : (
          <button className="danger" onClick={handleStop}>
            Stop
          </button>
        )}
        <button onClick={handleReset} disabled={status === 'running'}>
          Reset
        </button>
        <button onClick={handleResetCorpus} disabled={status === 'running'}>
          Reset red team corpus
        </button>
      </div>

      {error ? (
        <div className="evolve-error" role="alert">
          Error: {error}
        </div>
      ) : null}

      {status === 'running' ? (
        <div className="evolve-progress">
          <div
            className="evolve-progress-bar attack-progress-bar"
            style={{ width: `${progressPct}%` }}
          />
          <span className="small-note">
            Round {progress.round} / {progress.total}
          </span>
        </div>
      ) : null}

      {leaderboard.length > 0 ? (
        <div className="attack-leaderboard">
          <strong className="muted small-note">
            Top evaders (score = evasion × continuity)
          </strong>
          <div className="attack-leader-list">
            {leaderboard.map((node, i) => (
              <button
                key={node.id}
                className={`attack-leader-row ${selected?.id === node.id ? 'active' : ''}`}
                onClick={() => setSelectedId(node.id)}
              >
                <span className="evolve-rank">#{i + 1}</span>
                <span className="attack-leader-text" title={node.text}>
                  {node.text.length > 70 ? `${node.text.slice(0, 67)}...` : node.text}
                </span>
                <span className="attack-leader-score">
                  {((node.score || 0) * 100).toFixed(0)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selected ? <AttackDetail node={selected} onPromote={handlePromote} /> : null}
    </section>
  );
}

function AttackDetail({ node, onPromote }) {
  const evasionPct = ((1 - (node.detection || 0)) * 100).toFixed(0);
  const continuityPct = ((node.continuity || 0) * 100).toFixed(0);
  const scorePct = ((node.score || 0) * 100).toFixed(0);

  return (
    <div className="attack-detail">
      <div className="attack-detail-metrics">
        <span>
          evasion <strong>{evasionPct}%</strong>
        </span>
        <span>
          continuity <strong>{continuityPct}%</strong>
        </span>
        <span>
          fitness <strong>{scorePct}%</strong>
        </span>
        <span className="muted small-note">
          {node.operator} · origin: {node.origin} · gen {node.generation}
        </span>
      </div>
      <blockquote className="attack-detail-text">{node.text}</blockquote>
      {node.note ? (
        <div className="attack-detail-note muted small-note">
          mutation: {node.note}
        </div>
      ) : null}
      <div className="attack-detail-actions">
        <button className="primary" onClick={() => onPromote(node)}>
          Promote to red team corpus ({node.origin})
        </button>
        <span className="small-note muted">
          Adds this evolved attack to Layer 25's corpus — Layer 31's next
          evolution will need to catch it.
        </span>
      </div>
    </div>
  );
}
