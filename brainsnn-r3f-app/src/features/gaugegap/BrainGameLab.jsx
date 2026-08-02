import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Brain, Boxes, FileJson, Pause, Play, RotateCcw, ShieldCheck, SkipForward, Volume2, VolumeX, Zap } from 'lucide-react';
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
import { breakdownByTechnique, resolvePackets, scorePackets } from './brainGame3d.js';
import { buildCuratedLevel, buildLevel, CURATED_LEVELS, levelDifficulty } from './brainGameLevels.js';
import { isThreeTier, resolveQualityTier } from '../brain3d/quality.js';
import { DETECTOR_LIMITS } from '../../lib/persuasionTechniques.js';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';
import { createGameAudio } from '../../lib/audio/gameAudio.js';

// three is ~250 KB gzipped. It loads when someone actually plays in 3D, never
// on first paint — enforced by scripts/check-three-imports.mjs.
const GameScene = React.lazy(() => import('../brain3d/GameScene.jsx'));

const EMPTY = { lesions: [], cuts: [], stimuli: {} };
const TRACE_WINDOW = 60;
const TICK_MS = 120;

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

  // --- level, packets and the 3D board ---
  const reducedMotion = useReducedMotion();
  const [levelId, setLevelId] = useState(CURATED_LEVELS[1].id);
  const [customText, setCustomText] = useState('');
  const [level, setLevel] = useState(() => buildCuratedLevel(CURATED_LEVELS[1].id));
  const [tier, setTier] = useState('2d');
  const [use3d, setUse3d] = useState(true);
  // Published every logical tick so the 3D board tracks the simulation. At the
  // 120 ms tick that is ~8 renders/sec of a seven-sphere scene, which is far
  // cheaper than driving it from React at frame rate.
  const [liveFrame, setLiveFrame] = useState({ activities: {}, spikes: {}, weights: {} });
  const lastStepAtRef = useRef(0);
  const shakeRef = useRef(0);

  // Muted until asked for. The context is built on the first unmute click, not
  // at import, which is what browsers require and what keeps the console clean.
  const audioRef = useRef(null);
  const [soundOn, setSoundOn] = useState(false);
  if (audioRef.current === null) audioRef.current = createGameAudio();
  useEffect(() => () => audioRef.current?.close(), []);

  useEffect(() => {
    function detect() {
      let forced = null;
      try {
        forced = typeof localStorage !== 'undefined' ? localStorage.getItem('brainsnn:force-brain-2d') : null;
      } catch {
        // storage can be blocked; fall through to capability detection
      }
      let webgl = true;
      try {
        const probe = document.createElement('canvas');
        webgl = Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
      } catch {
        webgl = false;
      }
      setTier(resolveQualityTier({
        width: window.innerWidth,
        deviceMemory: navigator.deviceMemory,
        hardwareConcurrency: navigator.hardwareConcurrency,
        webgl,
        forced,
        reducedMotion,
      }));
    }
    detect();
    window.addEventListener('resize', detect);
    return () => window.removeEventListener('resize', detect);
  }, [reducedMotion]);

  const canRender3d = isThreeTier(tier);
  const showing3d = canRender3d && use3d;
  const coarsePointer = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;

  // Packet outcomes are a pure function of the schedule and the log, so this is
  // just derived state — never simulated, never frame-dependent.
  const resolution = useMemo(() => resolvePackets({
    packets: level.packets,
    log,
    interventions: INTERVENTIONS,
    untilTick: evaluation.elapsed,
  }), [level.packets, log, evaluation.elapsed]);
  const containment = scorePackets(resolution);

  // Fractional tick for smooth packet motion. Cosmetic: nothing derived from it
  // reaches a score.
  const getTick = useCallback(() => {
    const since = performance.now() - lastStepAtRef.current;
    const partial = Math.max(0, Math.min(1, since / TICK_MS));
    return tickRef.current + partial;
  }, []);

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

  // Packets resolve in the tick domain, so the audible event is a change in the
  // running totals rather than anything the renderer noticed.
  const lastCountsRef = useRef({ blocked: 0, landed: 0 });
  useEffect(() => {
    const previous = lastCountsRef.current;
    if (resolution.blocked > previous.blocked) audioRef.current?.play('block');
    if (resolution.landed > previous.landed) audioRef.current?.play('leak');
    lastCountsRef.current = { blocked: resolution.blocked, landed: resolution.landed };
  }, [resolution.blocked, resolution.landed]);

  useEffect(() => {
    if (evaluation.status === 'won') audioRef.current?.play('win');
    else if (evaluation.status === 'lost') audioRef.current?.play('lose');
  }, [evaluation.status]);

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
    // Containment is its own axis: you can survive the run on the rate model
    // while still letting every technique through, so sealing the board is a
    // separate accomplishment from holding the line.
    if (resolution.resolved > 0 && resolution.landed === 0) {
      onAchievement?.('sealed', { score: containment.containment, labId: 'braingame' });
    }
    if (levelId === CURATED_LEVELS[CURATED_LEVELS.length - 1].id) {
      onAchievement?.('boss-defender', { score: evaluation.scores.defense, labId: 'braingame' });
    }
    if (levelId === 'custom') {
      onAchievement?.('own-text', { score: evaluation.scores.defense, labId: 'braingame' });
    }
    track('gaugegap_brain_mission_won', { mode, defense: evaluation.scores.defense, level: levelId });
  }, [
    evaluation.status, evaluation.scores.defense, evaluation.remaining,
    mode, onAchievement, rules.budget, levelId,
    resolution.resolved, resolution.landed, containment.containment,
  ]);

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
      lastStepAtRef.current = performance.now();
      // Breach drives the camera shake. Read by the scene, never by scoring.
      shakeRef.current = breachTicks > 0 ? Math.min(1, breachTicks / 12) : 0;
      if (breachTicks > 0) audioRef.current?.play('alarm', { intensity: shakeRef.current });
      else if (state.spikes?.PFC || state.spikes?.AMY) audioRef.current?.play('spike');
      // The 3D board follows the simulation, so state has to be published every
      // tick rather than on the 200 ms score cadence below.
      setLiveFrame({ activities: state.activities, spikes: state.spikes, weights: state.weights });
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
    audioRef.current?.play('intervene');
    track('gaugegap_brain_intervention', { id: choice.id, mode });
  }

  function reset(nextMode = mode) {
    setInterventions(EMPTY);
    setLog([]);
    tickRef.current = 0;
    lastStepAtRef.current = performance.now();
    shakeRef.current = 0;
    setPaused(false);
    setSelected(null);
    setNotice('');
    setMode(nextMode);
    setResetKey((key) => key + 1);
    awardedRef.current = '';
  }

  function loadLevel(nextLevel, nextId) {
    if (!nextLevel) return;
    setLevel(nextLevel);
    setLevelId(nextId);
    setSeed(nextLevel.seed);
    reset(mode);
    setNotice(nextLevel.empty
      ? 'Nothing detected in this text. That is the detector finding no cue it knows — not proof the text is clean.'
      : `${nextLevel.title}: ${nextLevel.packets.length} packets across ${nextLevel.routes.length} route(s).`);
    track('gaugegap_brain_level_loaded', { level: nextId, packets: nextLevel.packets.length });
  }

  function loadCustomText() {
    const text = customText.trim();
    if (!text) {
      setNotice('Paste some text first — an ad, an email, a post.');
      return;
    }
    loadLevel(buildLevel({ text, id: 'custom', title: 'Your text', mode }), 'custom');
  }

  // The five interventions have fixed targets, so a direct tap on the board maps
  // onto one only where the model gives the player a lever. Tapping elsewhere
  // inspects instead of failing silently.
  function interventionFor(kind, target) {
    return INTERVENTIONS.find((choice) => choice.kind === kind && choice.target === target) || null;
  }

  function handleRegionTap(code) {
    const choice = interventionFor('stimulus', code);
    if (choice) {
      chooseIntervention(choice);
      return;
    }
    setSelected(code);
    setNotice(`${REGION_MAP[code]?.name || code}: ${REGION_MAP[code]?.description || ''}`);
  }

  function handleRegionLesion(code) {
    const choice = interventionFor('lesion', code);
    if (choice) {
      chooseIntervention(choice);
      return;
    }
    setNotice(`${REGION_MAP[code]?.name || code} cannot be taken offline in this mission.`);
  }

  function handlePathwayTap(pathwayId) {
    const choice = interventionFor('cut', pathwayId);
    if (choice) {
      chooseIntervention(choice);
      return;
    }
    const pathway = PATHWAYS.find((entry) => entry.id === pathwayId);
    setNotice(`${pathway?.label || pathwayId} is not cuttable in this mission.`);
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
        <div className="gg-sim-canvas-wrap gg-g3d-wrap" data-tier={tier} data-render={showing3d ? '3d' : '2d'}>
          {/* The 2D canvas is not dead code: it is the fallback for devices
              without WebGL, and it stays mounted (hidden) in 3D so the
              simulation loop it owns keeps driving both renderers. */}
          <canvas
            ref={canvasRef}
            className={`gg-sim-canvas gg-brain-game-canvas ${showing3d ? 'gg-canvas-hidden' : ''}`}
            onClick={handleCanvasClick}
            aria-hidden={showing3d ? 'true' : undefined}
            aria-label="Seven-region brain circuit. Click a region to inspect it."
          />
          {showing3d ? (
            <div className="gg-g3d-stage" data-testid="brain-game-3d">
              <Suspense fallback={<div className="gg-g3d-loading">Loading the board…</div>}>
                <GameScene
                  activities={liveFrame.activities}
                  spikes={liveFrame.spikes}
                  weights={liveFrame.weights}
                  interventions={interventions}
                  packets={level.packets}
                  getTick={getTick}
                  shakeRef={shakeRef}
                  onRegionTap={handleRegionTap}
                  onRegionLesion={handleRegionLesion}
                  onPathwayTap={handlePathwayTap}
                  quality={tier}
                  reducedMotion={reducedMotion}
                  coarsePointer={coarsePointer}
                  active={!finished}
                />
              </Suspense>
            </div>
          ) : null}
          <div className="gg-sim-canvas-label">
            {selected ? `${REGION_MAP[selected]?.name}` : 'THL → CTX → AMY → BG ⊣ THL — the one closed loop'}
          </div>
          {canRender3d ? (
            <button
              type="button"
              className="gg-sim-float-action gg-g3d-toggle"
              onClick={() => setUse3d((value) => !value)}
              data-testid="brain-game-3d-toggle"
            >
              <Boxes size={14} /> {showing3d ? '2D view' : '3D view'}
            </button>
          ) : null}
          <div className="gg-brain-game-hud" data-testid="brain-game-hud">
            <span className={evaluation.hijack > rules.hijackLimit || evaluation.hijack > (rules.hijackTarget ?? 100) ? 'danger' : ''}>
              Hijack <strong>{evaluation.hijack}</strong>
            </span>
            <span>Control <strong>{evaluation.control}</strong></span>
            {level.packets.length ? (
              <span className={containment.containment < 50 ? 'danger' : ''} data-testid="brain-game-containment">
                Contained <strong>{resolution.blocked}/{resolution.resolved || 0}</strong>
              </span>
            ) : null}
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

          <div className="gg-g3d-levels">
            <span className="gg-g3d-levels-head">
              Level
              <em>{levelDifficulty(level).label}</em>
            </span>
            <select
              value={levelId}
              onChange={(event) => {
                const next = event.target.value;
                if (next === 'custom') {
                  setLevelId('custom');
                  return;
                }
                loadLevel(buildCuratedLevel(next, { mode }), next);
              }}
              aria-label="Choose a level"
              data-testid="brain-game-level"
            >
              {CURATED_LEVELS.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.title}</option>
              ))}
              <option value="custom">Your own text…</option>
            </select>
            <p>{levelId === 'custom' ? 'Paste anything. Whatever the detector finds becomes what attacks you.' : level.blurb}</p>
            {levelId === 'custom' ? (
              <div className="gg-g3d-custom">
                <textarea
                  value={customText}
                  onChange={(event) => setCustomText(event.target.value)}
                  placeholder="Paste an ad, an email, a post…"
                  rows={4}
                  aria-label="Text to build a level from"
                  data-testid="brain-game-custom-text"
                />
                <button type="button" onClick={loadCustomText}>Build the level</button>
              </div>
            ) : null}
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
            <button
              type="button"
              aria-pressed={soundOn}
              onClick={() => {
                const next = audioRef.current.setEnabled(!soundOn);
                setSoundOn(next);
                if (next) audioRef.current.play('intervene');
              }}
              data-testid="brain-game-sound"
            >
              {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}{soundOn ? 'Sound on' : 'Sound off'}
            </button>
          </div>

          {level.packets.length ? (
            <div className="gg-g3d-breakdown" data-testid="brain-game-breakdown">
              <span>What is attacking</span>
              <ul>
                {breakdownByTechnique({ packets: level.packets, resolution }).map((row) => (
                  <li key={row.techniqueId} className={row.landed > 0 ? 'leaked' : row.resolved > 0 ? 'held' : ''}>
                    <div>
                      <strong>{row.label}</strong>
                      <em>{row.route}</em>
                    </div>
                    <p>{row.published}</p>
                    {row.phrase ? <code>{row.phrase}</code> : null}
                    <span>
                      {row.landed > 0 ? `${row.landed} got through` : null}
                      {row.landed > 0 && row.blocked > 0 ? ' · ' : null}
                      {row.blocked > 0 ? `${row.blocked} stopped` : null}
                      {row.resolved === 0 ? `${row.pending} incoming` : row.pending > 0 ? ` · ${row.pending} incoming` : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="gg-model-card">
            <span>Model underneath</span>
            <strong>7-region leaky rate network with STDP</strong>
            <p>{BRAIN_CLAIM_BOUNDARY}</p>
          </div>

          {/* The game is only as good as the detector aiming it, and the
              detector is measurably weak. Saying so here is the difference
              between a toy and an instrument. */}
          <div className="gg-model-card gg-g3d-limits">
            <span>What this cannot see</span>
            <strong>Paraphrases get through undetected</strong>
            <p>{DETECTOR_LIMITS}</p>
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
            const proof = await buildRunProof({ mode, seed, log, level });
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
