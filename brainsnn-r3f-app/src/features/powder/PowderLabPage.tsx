// The /lab page.
//
// Palette on the left, canvas in the middle, controls and readouts on the
// right. The engine and the brain layer are created once and held in refs; only
// the throttled stats and the small control values live in React state.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Eraser, Pause, Play, RotateCcw, Camera, Zap, Link2, Save, FolderOpen } from 'lucide-react';
import { PowderEngine } from './powderEngine.ts';
import { NeuroLayer, GAME_PARAMS, PARAM_SETS, type NeuroParams } from './neuroLayer.ts';
import { PowderCanvas, type PowderStats } from './PowderCanvas.tsx';
import { MaterialPalette } from './MaterialPalette.tsx';
import { Material, materialByHotkey, MATERIAL_BY_ID } from './materials.ts';
import { upscaleCanvas } from './renderGrid.ts';
import { OPENING_SCENE, applyStamp, STAMPS } from './stamps.ts';
import {
  buildShareUrl, hasLocalSave, loadLocal, loadShareString, readShareParam, saveLocal,
} from './share.ts';
import { RegimeRecorder, WINDOW_TICKS, type RegimeReadout } from './regime.ts';
import '../../styles/powder.css';

const EMPTY_REGIME: RegimeReadout = {
  ready: false, reason: 'Measuring…', cvIsi: 0, fano: 0, synchrony: 0,
  rateHz: null, regime: null, neurons: 0, spikes: 0, windowTicks: WINDOW_TICKS,
};

const EMPTY_STATS: PowderStats = {
  fps: 0, particles: 0, neurons: 0, synapses: 0,
  spikesPerSecond: 0, meanWeight: 0, dopamineCells: 0, regime: EMPTY_REGIME,
};

export function PowderLabPage() {
  const engine = useMemo(() => new PowderEngine({ seed: 'neuro-powder' }), []);
  const layer = useMemo(() => new NeuroLayer(engine.size), [engine.size]);
  const recorder = useMemo(() => new RegimeRecorder(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [material, setMaterial] = useState<Material>(Material.SAND);
  const [brush, setBrush] = useState(3);
  const [paused, setPaused] = useState(false);
  const [params, setParams] = useState<NeuroParams>(GAME_PARAMS);
  const [stats, setStats] = useState<PowderStats>(EMPTY_STATS);
  const [notice, setNotice] = useState('Draw with the left button. Right button erases.');
  const [hasSave, setHasSave] = useState(false);
  useEffect(() => { setHasSave(hasLocalSave()); }, []);

  // Seeded so the page is never a blank grid, and kept firing until the visitor
  // touches it — a sandbox that does nothing until you understand it is a
  // sandbox nobody stays in. A shared link takes precedence: someone who
  // followed one came to see that grid, not the demo.
  const touchedRef = useRef(false);
  useEffect(() => {
    const shared = typeof window === 'undefined' ? null : readShareParam(window.location.search);
    if (shared && loadShareString(engine, shared)) {
      touchedRef.current = true;
      setNotice('Loaded a shared grid.');
      return;
    }
    if (shared) setNotice('That shared link could not be read, so here is the demo instead.');
    applyStamp(engine, OPENING_SCENE, 20, 34);
  }, [engine]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (touchedRef.current) return;
      for (let at = 0; at < engine.size; at += 1) {
        const kind = engine.cells[at] & 0x1f;
        if (kind !== Material.NEURO && kind !== Material.INHIB) continue;
        if (engine.timer[at] === 0) engine.voltage[at] = GAME_PARAMS.threshold * 2;
      }
    }, 1400);
    return () => window.clearInterval(timer);
  }, [engine]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const picked = materialByHotkey(event.key);
      if (picked !== null) {
        setMaterial(picked);
        setNotice(`${MATERIAL_BY_ID[picked].name} selected.`);
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        setPaused((value) => !value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleStats = useCallback((next: PowderStats) => setStats(next), []);

  function clearAll() {
    engine.clear();
    layer.reset();
    recorder.reset();
    setNotice('Grid cleared.');
  }

  function stimulate() {
    // Kick every neuron on the board, so a circuit can be tested without
    // hand-charging one cell.
    let count = 0;
    for (let at = 0; at < engine.size; at += 1) {
      const kind = engine.cells[at] & 0x1f;
      if (kind !== Material.NEURO && kind !== Material.INHIB) continue;
      if (engine.timer[at] > 0) continue;
      engine.voltage[at] = params.threshold * 2;
      count += 1;
    }
    setNotice(count ? `Stimulated ${count} neuron${count === 1 ? '' : 's'}.` : 'No neurons on the grid yet.');
  }

  async function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The live canvas is 240x160; upscale so the export is not a thumbnail.
    const scaled = upscaleCanvas(canvas, 4);
    const blob = await new Promise<Blob | null>((resolve) => scaled.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `neuro-powder-${Date.now().toString(36)}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice('Saved a PNG at 4x.');
  }

  async function shareLink() {
    const url = buildShareUrl(engine, window.location.href);
    // Address bar first: that always works, so there is a link to copy by hand
    // even where the clipboard API is unavailable or denied.
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied. It carries the whole grid, no server involved.');
    } catch {
      setNotice('Link is in the address bar — copy it from there.');
    }
  }

  function saveSlot() {
    setHasSave(true);
    setNotice(saveLocal(engine) ? 'Saved to this browser.' : 'This browser refused to store the grid.');
  }

  function loadSlot() {
    if (loadLocal(engine)) {
      layer.reset();
      recorder.reset();
      touchedRef.current = true;
      setNotice('Restored your saved grid.');
      return;
    }
    setNotice('Nothing saved in this browser yet.');
  }

  return (
    <div className="powder-page" data-testid="powder-lab">
      <header className="powder-header">
        <div>
          <p className="powder-kicker"><Brain size={15} /> brainsnn.com · Neuro Powder Lab</p>
          <h1>Drop sand. Then build a brain out of it.</h1>
          <p className="powder-lede">
            A falling-sand sandbox where the neurons are real. Draw a neuron, run a synapse
            to another, and the spike obeys the same leaky integrate-and-fire model this
            site publishes — not numbers invented for a game.
          </p>
        </div>
      </header>

      <div className="powder-layout">
        <aside className="powder-rail powder-rail-left">
          <MaterialPalette value={material} onChange={setMaterial} />
          <div className="powder-stamps">
            <span className="powder-palette-heading">Stamps</span>
            {STAMPS.map((stamp) => (
              <button
                key={stamp.id}
                type="button"
                onClick={() => {
                  applyStamp(engine, stamp, 100, 70);
                  setNotice(`${stamp.name} placed. ${stamp.blurb}`);
                }}
              >
                {stamp.name}
              </button>
            ))}
          </div>
        </aside>

        <div className="powder-stage">
          <PowderCanvas
            engine={engine}
            layer={layer}
            material={material}
            brush={brush}
            paused={paused}
            params={params}
            onStats={handleStats}
            canvasRef={canvasRef}
            recorder={recorder}
            onFirstDraw={() => { touchedRef.current = true; }}
          />
          <div className="powder-hud" data-testid="powder-hud">
            <span>FPS <strong>{stats.fps}</strong></span>
            <span>Particles <strong>{stats.particles}</strong></span>
            <span>Neurons <strong>{stats.neurons}</strong></span>
            <span>Synapses <strong>{stats.synapses}</strong></span>
            <span>Spikes/s <strong>{stats.spikesPerSecond}</strong></span>
            <span>Mean weight <strong>{stats.meanWeight.toFixed(2)}</strong></span>
          </div>
        </div>

        <aside className="powder-rail powder-rail-right">
          <label className="powder-control">
            <span>Brush <output>{brush}</output></span>
            <input
              type="range" min={0} max={20} step={1} value={brush}
              onChange={(event) => setBrush(Number(event.target.value))}
              data-testid="powder-brush"
            />
          </label>

          <div className="powder-buttons">
            <button type="button" onClick={() => setPaused((value) => !value)} data-testid="powder-pause">
              {paused ? <Play size={15} /> : <Pause size={15} />}{paused ? 'Run' : 'Pause'}
            </button>
            <button type="button" onClick={stimulate} data-testid="powder-stimulate">
              <Zap size={15} /> Stimulate
            </button>
            <button type="button" onClick={clearAll} data-testid="powder-clear">
              <RotateCcw size={15} /> Clear
            </button>
            <button type="button" onClick={savePng}>
              <Camera size={15} /> Save PNG
            </button>
            <button type="button" onClick={shareLink} data-testid="powder-share">
              <Link2 size={15} /> Copy link
            </button>
            <button type="button" onClick={saveSlot} data-testid="powder-save">
              <Save size={15} /> Save
            </button>
            <button type="button" onClick={loadSlot} disabled={!hasSave} data-testid="powder-load">
              <FolderOpen size={15} /> Load
            </button>
            <button type="button" onClick={() => setMaterial(Material.AIR)}>
              <Eraser size={15} /> Eraser
            </button>
          </div>

          <div className="powder-model">
            <span className="powder-palette-heading">Neuron model</span>
            <div className="powder-toggle" role="tablist" aria-label="Neuron model">
              {PARAM_SETS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.id === params.id}
                  className={entry.id === params.id ? 'is-active' : ''}
                  onClick={() => {
                    setParams(entry);
                    // A window that straddled the switch would mix two models'
                    // statistics into one number.
                    recorder.reset();
                    setNotice(entry.note);
                  }}
                  data-testid={`powder-model-${entry.id}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="powder-model-note">{params.note}</p>
          </div>

          {/* The readout that makes this a lab rather than a toy: the same
              metrics module the research page runs on the validated Brunel
              network, pointed at whatever you drew. */}
          <div className="powder-regime" data-testid="powder-regime">
            <span className="powder-palette-heading">Firing regime</span>
            <p className="powder-regime-label" data-testid="powder-regime-label">
              {stats.regime.regime
                ? <><strong>{stats.regime.regime}</strong> — {stats.regime.reason}</>
                : stats.regime.reason}
            </p>
            <dl className="powder-regime-stats">
              <div><dt>CV of ISI</dt><dd>{stats.regime.cvIsi.toFixed(3)}</dd></div>
              <div><dt>Fano</dt><dd>{stats.regime.fano.toFixed(3)}</dd></div>
              <div><dt>Synchrony</dt><dd>{stats.regime.synchrony.toFixed(4)}</dd></div>
              <div>
                <dt>Rate</dt>
                <dd>{stats.regime.rateHz === null ? '—' : `${stats.regime.rateHz} Hz`}</dd>
              </div>
            </dl>
            <p className="powder-regime-note">
              Measured over {stats.regime.windowTicks} ticks by{' '}
              <code>snnMetrics.js</code> — the same module the research page uses on
              the Brunel network, not a second implementation.
            </p>
          </div>

          {/* Consistent with the rest of this codebase: say what the thing is
              and, more importantly, what it is not. */}
          <div className="powder-boundary">
            <span className="powder-palette-heading">What this is</span>
            <p>
              A 2D cellular automaton whose neuron cells follow a published
              integrate-and-fire model. It is not a simulation of cortical tissue and
              carries no claim about biological brains.
            </p>
          </div>
        </aside>
      </div>

      <p className="powder-notice" role="status">{notice}</p>
    </div>
  );
}
