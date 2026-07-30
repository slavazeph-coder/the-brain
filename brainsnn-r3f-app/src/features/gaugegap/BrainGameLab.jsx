import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Brain, FileJson, Pause, Play, RotateCcw, ShieldCheck, SkipForward, Zap } from 'lucide-react';
import { BRAIN_REGIONS, PATHWAYS, REGION_MAP } from '../brain3d/brainRegions.js';
import { createBrainParams, createBrainState, stepBrain } from '../brain3d/brainModel.js';
import { createRng } from '../../lib/rng.js';
import { BRAIN_CLAIM_BOUNDARY } from '../brain3d/brainMetrics.js';
import { copyChallenge, DeepLabHeading, shareChallenge } from './DeepLabChrome.jsx';
import {
  applyIntervention,
  CALM_DRIVE,
  CHALLENGE,
  countInterventions,
  driveAtTick,
  evaluateRun,
  GAME_MODES,
  INTERVENTIONS,
  MISSION,
  missionNotice,
} from './brainGame.js';
import { buildRunProof, verifyRunProof } from './runProof.js';
import { downloadJson } from './evidence.js';
import { track } from '../../lib/analytics.js';

const EMPTY = { lesions: [], cuts: [], stimuli: {} };
const TRACE_WINDOW = 60;

// Project the 3D region layout onto the canvas. x and z read best from above.
function layoutRegions(width, height) {
  const xs = BRAIN_REGIONS.map((region) => region.position[0]);
  const zs = BRAIN_REGIONS.map((region) => region.position[2]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const padX = width * 0.16;
  const padY = height * 0.18;
  return Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, {
    x: padX + ((region.position[0] - minX) / Math.max(1e-6, maxX - minX)) * (width - padX * 2),
    y: padY + ((region.position[2] - minZ) / Math.max(1e-6, maxZ - minZ)) * (height - padY * 2),
  }]));
}

export function BrainGameLab({ onAchievement }) {
  const [mode, setMode] = useState('mission');
  const [paused, setPaused] = useState(false);
  const [interventions, setInterventions] = useState(EMPTY);
  const [evaluation, setEvaluation] = useState(() => evaluateRun({
    frames: [], finalState: null, params: createBrainParams(), targets: null, mode: 'mission', used: 0,
  }));
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [seed, setSeed] = useState('defend-01');
  const [resetKey, setResetKey] = useState(0);
  const [log, setLog] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const tickRef = useRef(0);

  const canvasRef = useRef(null);
  const modeRef = useRef(mode);
  const pausedRef = useRef(paused);
  const interventionsRef = useRef(interventions);
  const stepOnceRef = useRef(false);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { interventionsRef.current = interventions; }, [interventions]);

  const rules = mode === 'challenge' ? CHALLENGE : MISSION;
  const used = countInterventions(interventions);
  const finished = evaluation.status === 'won' || evaluation.status === 'lost';

  // XP for an actual accomplishment rather than for opening the lab. Fires once
  // per outcome; recordAchievement is itself idempotent.
  const awardedRef = useRef('');
  useEffect(() => {
    if (evaluation.status !== 'won' || mode === 'sandbox') return;
    const key = `${mode}-${evaluation.scores.defense}`;
    if (awardedRef.current === key) return;
    awardedRef.current = key;
    onAchievement?.('defender', { score: evaluation.scores.defense, labId: 'braingame' });
    if (evaluation.remaining >= rules.budget - 1) {
      onAchievement?.('efficient-defender', { score: evaluation.scores.defense, labId: 'braingame' });
    }
    track('gaugegap_brain_mission_won', { mode, defense: evaluation.scores.defense });
  }, [evaluation.status, evaluation.scores.defense, evaluation.remaining, mode, onAchievement, rules.budget]);

  // The simulation owns its own loop so the canvas never waits on React.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    const params = createBrainParams();
    const rng = createRng(seed);
    let state = createBrainState(params);
    let frames = [];
    let breachTicks = 0;
    let worstBreach = 0;
    let width = 0;
    let height = 0;
    let animation = 0;
    let lastStep = 0;
    let lastPublish = 0;
    let positions = {};

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(320, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      positions = layoutRegions(width, height);
      canvas._positions = positions;
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    function advance() {
      const activeMode = modeRef.current;
      const total = activeMode === 'challenge' ? CHALLENGE.durationTicks : MISSION.durationTicks;
      const targets = activeMode === 'sandbox' ? CALM_DRIVE : driveAtTick(frames.length, total);
      state = stepBrain(state, { targets, params, interventions: interventionsRef.current, rng });
      frames.push({
        tick: state.tick,
        activities: state.activities,
        spikes: state.spikes,
        weights: state.weights,
        drive: state.drive,
        stdpDelta: state.stdpDelta,
        meanFiring: state.meanFiring,
      });
      if (frames.length > total + 5) frames = frames.slice(-total);

      const window_ = frames.slice(-40);
      const raw = window_.reduce((sum, frame) => (
        sum + ((frame.activities.AMY + frame.activities.BG) / 2 - frame.activities.PFC)
      ), 0) / window_.length;
      const hijackIndex = Math.round(Math.max(0, Math.min(1, raw + 0.5)) * 100);
      const limit = activeMode === 'challenge' ? CHALLENGE.hijackTarget : MISSION.hijackLimit;
      breachTicks = hijackIndex > limit ? breachTicks + 1 : 0;
      worstBreach = Math.max(worstBreach, breachTicks);
      tickRef.current = frames.length;
      return { targets, params };
    }

    function draw(now) {
      const activeMode = modeRef.current;
      const total = activeMode === 'challenge' ? CHALLENGE.durationTicks : MISSION.durationTicks;
      const done = activeMode !== 'sandbox' && frames.length >= total;
      const failed = activeMode === 'mission' && worstBreach >= MISSION.breachGrace;

      if ((!pausedRef.current && !done && !failed) || stepOnceRef.current) {
        if (now - lastStep > 120 || stepOnceRef.current) {
          lastStep = now;
          stepOnceRef.current = false;
          advance();
        }
      }

      context.fillStyle = '#04040c';
      context.fillRect(0, 0, width, height);

      const latest = frames[frames.length - 1];
      const activities = latest ? latest.activities : {};
      const weights = latest ? latest.weights : {};
      const cuts = interventionsRef.current.cuts || [];
      const lesions = interventionsRef.current.lesions || [];
      const stimuli = interventionsRef.current.stimuli || {};

      // Pathways
      for (const pathway of PATHWAYS) {
        const from = positions[pathway.from];
        const to = positions[pathway.to];
        if (!from || !to) continue;
        const isCut = cuts.includes(pathway.id);
        const weight = weights[pathway.id] ?? pathway.initialWeight;
        context.save();
        context.strokeStyle = isCut ? 'rgba(120,120,140,0.35)' : pathway.inhibitory ? '#fb7185' : 'rgba(125,249,255,0.55)';
        context.lineWidth = isCut ? 1 : 1 + weight * 4;
        if (isCut) context.setLineDash([4, 6]);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
        context.restore();
      }

      // Regions
      for (const region of BRAIN_REGIONS) {
        const point = positions[region.code];
        if (!point) continue;
        const activity = activities[region.code] ?? region.baseActivity;
        const lesioned = lesions.includes(region.code);
        const stimulated = stimuli[region.code] > 0;
        const spiking = latest?.spikes?.[region.code];
        const radius = 12 + activity * 26;

        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = lesioned ? 'rgba(90,90,110,0.45)' : region.color;
        context.globalAlpha = lesioned ? 0.5 : 0.35 + activity * 0.5;
        context.fill();
        context.globalAlpha = 1;

        if (spiking && !lesioned) {
          context.beginPath();
          context.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2;
          context.stroke();
        }
        if (stimulated) {
          context.beginPath();
          context.arc(point.x, point.y, radius + 10, 0, Math.PI * 2);
          context.strokeStyle = '#d9ff65';
          context.lineWidth = 1.5;
          context.stroke();
        }
        if (lesioned) {
          context.strokeStyle = '#ff5873';
          context.lineWidth = 2.5;
          context.beginPath();
          context.moveTo(point.x - 9, point.y - 9);
          context.lineTo(point.x + 9, point.y + 9);
          context.moveTo(point.x + 9, point.y - 9);
          context.lineTo(point.x - 9, point.y + 9);
          context.stroke();
        }

        context.fillStyle = '#e7fbff';
        context.font = '600 11px ui-monospace, monospace';
        context.textAlign = 'center';
        context.fillText(region.code, point.x, point.y + radius + 15);
      }
      context.textAlign = 'left';

      if (now - lastPublish > 200) {
        lastPublish = now;
        const activeTotal = activeMode === 'challenge' ? CHALLENGE.durationTicks : MISSION.durationTicks;
        const targets = activeMode === 'sandbox' ? CALM_DRIVE : driveAtTick(frames.length, activeTotal);
        setEvaluation(evaluateRun({
          frames: frames.slice(-TRACE_WINDOW),
          finalState: state,
          params,
          targets,
          mode: activeMode,
          used: countInterventions(interventionsRef.current),
          breachTicks,
          worstBreach,
          elapsed: frames.length,
        }));
      }

      animation = window.requestAnimationFrame(draw);
    }

    animation = window.requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animation);
    };
  }, [seed, resetKey]);

  function chooseIntervention(choice) {
    if (finished) return;
    if (mode !== 'sandbox' && used >= rules.budget) {
      setNotice('Budget spent. Reset to try a different approach.');
      return;
    }
    setInterventions((previous) => applyIntervention(previous, choice));
    setLog((previous) => [...previous, { tick: tickRef.current, id: choice.id }]);
    setNotice(choice.hint);
    track('gaugegap_brain_intervention', { id: choice.id, mode });
  }

  function reset(nextMode = mode) {
    setInterventions(EMPTY);
    setLog([]);
    tickRef.current = 0;
    setPaused(false);
    setSelected(null);
    setNotice('');
    setMode(nextMode);
    setResetKey((key) => key + 1);
    awardedRef.current = '';
  }

  function handleCanvasClick(event) {
    const canvas = canvasRef.current;
    const positions = canvas?._positions;
    if (!positions) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let closest = null;
    let bestDistance = Infinity;
    for (const [code, point] of Object.entries(positions)) {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = code;
      }
    }
    if (closest && bestDistance < 44) {
      setSelected(closest);
      setNotice(`${REGION_MAP[closest]?.name || closest}: ${REGION_MAP[closest]?.description || ''}`);
    }
  }

  const gameUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('lab', 'braingame');
    url.searchParams.set('state', seed);
    url.hash = 'playground';
    return url.toString();
  }, [seed]);

  const modeMeta = GAME_MODES.find((entry) => entry.id === mode) || GAME_MODES[0];

  return (
    <div className="gg-sim-lab gg-deep-lab gg-brain-game" data-testid="brain-game-lab">
      <DeepLabHeading
        kicker="Live experiment 014"
        title="Defend the brain from its own threat loop."
        description={modeMeta.blurb}
        scoreLabel="Defense"
        score={evaluation.scores.defense}
        scoreNote={`Hijack ${evaluation.hijack} · control ${evaluation.control}`}
      />

      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="gg-sim-canvas gg-brain-game-canvas"
            onClick={handleCanvasClick}
            aria-label="Seven-region brain circuit. Click a region to inspect it."
          />
          <div className="gg-sim-canvas-label">
            {selected ? `${REGION_MAP[selected]?.name}` : 'THL → CTX → AMY → BG ⊣ THL — the one closed loop'}
          </div>
          <div className="gg-brain-game-hud" data-testid="brain-game-hud">
            <span className={evaluation.hijack > rules.hijackLimit || evaluation.hijack > (rules.hijackTarget ?? 100) ? 'danger' : ''}>
              Hijack <strong>{evaluation.hijack}</strong>
            </span>
            <span>Control <strong>{evaluation.control}</strong></span>
            {mode !== 'sandbox' ? <span>Budget <strong>{evaluation.remaining}/{rules.budget}</strong></span> : null}
            {mode !== 'sandbox' ? <span>Tick <strong>{evaluation.elapsed}/{rules.durationTicks}</strong></span> : null}
          </div>
          {finished ? (
            <div className={`gg-brain-game-banner ${evaluation.status}`} role="status" data-testid="brain-game-banner">
              <strong>{evaluation.status === 'won' ? 'Held the line' : 'Judgment offline'}</strong>
              <span>Defense {evaluation.scores.defense} · control {evaluation.scores.control} · stability {evaluation.scores.stability} · efficiency {evaluation.scores.efficiency}</span>
              <button type="button" onClick={() => reset()}>Play again</button>
            </div>
          ) : null}
        </div>

        <aside className="gg-sim-controls">
          <div className="gg-deep-mission">
            <Activity size={16} />
            <span>Mission</span>
            <strong>
              {mode === 'sandbox'
                ? 'No objective — experiment freely.'
                : mode === 'challenge'
                  ? `Finish under hijack ${CHALLENGE.hijackTarget} using at most ${CHALLENGE.budget} interventions.`
                  : `Keep hijack under ${MISSION.hijackLimit} for ${MISSION.durationTicks} ticks with ${MISSION.budget} interventions.`}
            </strong>
          </div>

          <div className="gg-deep-toggle" role="tablist" aria-label="Game mode">
            {GAME_MODES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === mode}
                className={entry.id === mode ? 'active' : ''}
                onClick={() => reset(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="gg-brain-game-actions">
            {INTERVENTIONS.map((choice) => {
              const spent = (choice.kind === 'lesion' && interventions.lesions.includes(choice.target))
                || (choice.kind === 'cut' && interventions.cuts.includes(choice.target))
                || (choice.kind === 'stimulus' && interventions.stimuli[choice.target] > 0);
              return (
                <button
                  key={choice.id}
                  type="button"
                  className={spent ? 'active' : ''}
                  disabled={finished || (mode !== 'sandbox' && used >= rules.budget && !spent)}
                  onClick={() => chooseIntervention(choice)}
                >
                  <Zap size={14} /> {choice.label}
                </button>
              );
            })}
          </div>

          <div className="gg-brain-game-transport">
            <button type="button" onClick={() => setPaused((value) => !value)}>
              {paused ? <Play size={15} /> : <Pause size={15} />}{paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={() => { stepOnceRef.current = true; }}><SkipForward size={15} /> Step</button>
            <button type="button" onClick={() => reset()}><RotateCcw size={15} /> Reset</button>
          </div>

          <div className="gg-model-card">
            <span>Model underneath</span>
            <strong>7-region leaky rate network with STDP</strong>
            <p>{BRAIN_CLAIM_BOUNDARY}</p>
          </div>
        </aside>
      </div>

      <div className="gg-deep-actions">
        <button type="button" onClick={() => shareChallenge({ title: 'Defend the Brain', text: `I scored ${evaluation.scores.defense} defending the brain. Beat it.`, url: gameUrl, setNotice })}>
          <Brain size={16} /> Share run
        </button>
        <button type="button" onClick={() => copyChallenge(gameUrl, setNotice)}>Copy link</button>
        <button
          type="button"
          onClick={async () => {
            const proof = await buildRunProof({ mode, seed, log });
            downloadJson(`brainsnn-run-${String(proof.content_hash).slice(0, 8)}.json`, proof);
            setNotice('Run proof saved. Anyone can replay the log and check the score recomputes.');
            track('gaugegap_brain_proof_exported', { mode });
          }}
        >
          <FileJson size={16} /> Export run proof
        </button>
        <label className="gg-verify-proof">
          <ShieldCheck size={16} /> Verify a proof
          <input
            type="file"
            accept="application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              try {
                const result = await verifyRunProof(JSON.parse(await file.text()));
                setVerdict(result);
                setNotice(result.verified
                  ? 'Verified: the log replays to exactly the score it claims.'
                  : `Rejected — ${result.problems[0]}`);
              } catch (error) {
                setVerdict({ verified: false, problems: [`unreadable proof: ${error.message}`] });
                setNotice('That file could not be read as a run proof.');
              }
            }}
          />
        </label>
        {verdict ? (
          <span className={verdict.verified ? 'gg-verdict-ok' : 'gg-verdict-bad'} data-testid="proof-verdict">
            {verdict.verified ? '✓ replay matches' : `✗ ${verdict.problems.length} problem(s)`}
          </span>
        ) : null}
        <span>{notice || missionNotice(evaluation, mode)}</span>
      </div>
    </div>
  );
}
