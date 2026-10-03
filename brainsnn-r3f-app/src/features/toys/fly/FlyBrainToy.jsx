// Feed the Fly Brain — toy 05.
//
// Real wiring, simulated signals: a 2,621-neuron slice of the published FlyWire
// fruit-fly connectome, run by the Shiu et al. (2024) model in the browser. A
// visitor gives the fly a taste and watches whether the feeding motor neuron
// MN9 fires. The page is the place every claim gets made, so the copy says
// exactly what is real (the wiring) and what is not (the activity).
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../../../lib/analytics.js';
import { useReducedMotion } from '../../../hooks/useReducedMotion.js';
import { Brain3DErrorBoundary } from '../../brain3d/Brain3DErrorBoundary.jsx';
import { getToy } from '../toyConfig.js';
import { ToyPage } from '../ToyChrome.jsx';
import { feedingVerdict, parseFlyCircuit } from './flyCircuit.js';

const FlyBrainScene = React.lazy(() => import('./FlyBrainScene.jsx'));

const TOY = getToy('fly');
const CIRCUIT_URL = '/fly/feeding-circuit.bin.gz';
const STRENGTHS = [
  { id: 'taste', label: 'A taste', rateHz: 50 },
  { id: 'sip', label: 'A sip', rateHz: 100 },
  { id: 'gulp', label: 'A gulp', rateHz: 200 },
];

/** Fetch and unpack the circuit. The file is gzip; a server may already have unwrapped it. */
async function loadFlyCircuit() {
  const response = await fetch(CIRCUIT_URL);
  if (!response.ok) throw new Error(`circuit ${response.status}`);
  const buffer = await response.arrayBuffer();
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return parseFlyCircuit(await new Response(stream).arrayBuffer());
  }
  return parseFlyCircuit(buffer);
}

function verdictCopy(taste, mn9Hz) {
  if (!taste && mn9Hz < 1) return 'Waiting for a taste.';
  const verdict = feedingVerdict(mn9Hz);
  if (verdict === 'eating') return 'It’s eating — MN9 is firing to extend the proboscis.';
  if (verdict === 'tempted') return 'Tempted… MN9 is flickering.';
  return taste === 'bitter' ? 'Not eating. The bitter signal never reaches MN9.' : 'Not eating yet.';
}

export function FlyBrainToy() {
  const reducedMotion = useReducedMotion();
  const [circuit, setCircuit] = useState(null);
  const [status, setStatus] = useState('loading');
  const [taste, setTaste] = useState(null);
  const [strength, setStrength] = useState(STRENGTHS[2]);
  const [stats, setStats] = useState({ mn9Hz: 0, active: 0 });
  const apiRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadFlyCircuit()
      .then((parsed) => { if (!cancelled) setCircuit(parsed); })
      .catch(() => { if (!cancelled) setStatus('failed'); });
    return () => { cancelled = true; };
  }, []);

  const onStats = useCallback((next) => setStats(next), []);

  function feed(nextTaste, nextStrength = strength) {
    setTaste(nextTaste);
    if (nextTaste) {
      apiRef.current?.feed(nextTaste, nextStrength.rateHz);
      track('toy_fly_fed', { toy: TOY.id, taste: nextTaste, rate: nextStrength.rateHz });
    } else {
      apiRef.current?.stop();
    }
  }

  function chooseStrength(option) {
    setStrength(option);
    if (taste) apiRef.current?.feed(taste, option.rateHz);
  }

  const verdict = feedingVerdict(stats.mn9Hz);
  const ready = status === 'ready';

  return (
    <ToyPage toy={TOY} title="Feed the Fly Brain | BrainSNN">
      <section className="toy-hero" aria-labelledby="fly-title">
        <p className="bh-kicker">TOY 05 · REAL WIRING, SIMULATED SIGNALS</p>
        <h1 id="fly-title">Will the fly <span>eat it?</span></h1>
        <p className="toy-lead">
          These 2,621 dots are neurons from a real fruit fly&apos;s brain, wired as the published FlyWire connectome maps
          them. Give it a taste and watch a simulated signal decide whether the feeding neuron fires.
        </p>
      </section>

      <section className="toy-panel fly-panel" data-testid="fly-panel" data-state={status} aria-label="The fly brain">
        <div className="fly-stage">
          {circuit && status !== 'failed' ? (
            <Brain3DErrorBoundary fallback={null} onError={() => setStatus('failed')}>
              <Suspense fallback={null}>
                <FlyBrainScene circuit={circuit} apiRef={apiRef} onStats={onStats} reducedMotion={reducedMotion} onReady={() => setStatus('ready')} />
              </Suspense>
            </Brain3DErrorBoundary>
          ) : null}
          {status === 'loading' ? <p className="fly-stage-note" role="status">Loading 195,759 connections…</p> : null}
          {status === 'failed' ? <p className="fly-stage-note" role="alert">This toy needs WebGL and a modern browser.</p> : null}
          <ul className="fly-legend" aria-label="Legend">
            <li><i className="is-sugar" />Sugar taste neurons</li>
            <li><i className="is-bitter" />Bitter taste neurons</li>
            <li><i className="is-mn9" />MN9 — feeding motor neuron</li>
          </ul>
        </div>

        <div className="fly-controls">
          <div className="fly-feed" role="group" aria-label="Feed the fly">
            <button type="button" className={`fly-feed-button is-sugar${taste === 'sugar' ? ' is-on' : ''}`} onClick={() => feed('sugar')} disabled={!ready} aria-pressed={taste === 'sugar'} data-testid="fly-sugar">
              <i className="fly-dot is-sugar" aria-hidden="true" /> Sugar
            </button>
            <button type="button" className={`fly-feed-button is-bitter${taste === 'bitter' ? ' is-on' : ''}`} onClick={() => feed('bitter')} disabled={!ready} aria-pressed={taste === 'bitter'} data-testid="fly-bitter">
              <i className="fly-dot is-bitter" aria-hidden="true" /> Bitter
            </button>
            <button type="button" className="fly-feed-button is-stop" onClick={() => feed(null)} disabled={!ready || !taste} data-testid="fly-stop">
              Stop
            </button>
          </div>
          <div className="fly-strength" role="radiogroup" aria-label="How much">
            {STRENGTHS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={strength.id === option.id}
                className={strength.id === option.id ? 'is-on' : undefined}
                onClick={() => chooseStrength(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={`fly-readout is-${taste ? verdict : 'idle'}`} role="status" aria-live="polite">
            <span>MN9 · feeding motor neuron</span>
            <strong data-testid="fly-mn9">{Math.round(stats.mn9Hz)} <small>Hz</small></strong>
            <p data-testid="fly-verdict">{verdictCopy(taste, stats.mn9Hz)}</p>
            <small>{stats.active.toLocaleString()} of 2,621 neurons active · shown 4× slower than the model</small>
          </div>
        </div>
      </section>

      <section className="toy-limits fly-limits" aria-labelledby="fly-limits-title">
        <h2 id="fly-limits-title">What&apos;s real, what&apos;s simulated</h2>
        <div className="fly-limits-grid">
          <div>
            <h3>Real: the wiring</h3>
            <p>
              Every neuron, position and connection comes from FlyWire v783, the first complete wiring diagram of an adult
              fruit-fly brain (Dorkenwald et al. and Schlegel et al., <i>Nature</i> 2024). This is a 2,621-neuron slice:
              everything within two strong connections of the sugar and bitter taste neurons and MN9.
            </p>
          </div>
          <div>
            <h3>Simulated: the activity</h3>
            <p>
              The spikes come from the Shiu et al. (<i>Nature</i> 2024) leaky integrate-and-fire model, running in your
              browser. No fly was recorded. On this slice the model reproduces the paper&apos;s result — sugar drives MN9,
              bitter does not — but it leaves out the rest of the brain, so it is a model of a model.
            </p>
          </div>
          <div>
            <h3>Credits</h3>
            <p>
              Connectome: the <a href="https://flywire.ai" target="_blank" rel="noopener">FlyWire Consortium</a>.
              Model: <a href="https://github.com/philshiu/Drosophila_brain_model" target="_blank" rel="noopener">Shiu et al.</a> (MIT licence).
              Positions and brain outline: FlyWire Codex. Slice built by BrainSNN.
            </p>
          </div>
        </div>
      </section>
    </ToyPage>
  );
}
