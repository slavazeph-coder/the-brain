// Spiking-neuron simulation for the 3D brain. Ported from
// ui/brainsnn-site/src/hooks/useBrainSimulation.js with two changes:
// - `targetActivities` biases each region's homeostatic set point so scan
//   results / demo presets shape the ambient firing pattern.
// - `running` pauses the tick from the host (visibility/intersection gating).
import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAIN_REGIONS, PATHWAYS } from './brainRegions.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

const INITIAL_ACTIVITIES = Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, region.baseActivity]));
const INITIAL_WEIGHTS = Object.fromEntries(PATHWAYS.map((pathway) => [pathway.id, pathway.initialWeight]));
const INITIAL_LAST_SPIKE = Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, -999]));

function computeIncomingSignal(regionCode, activities, weights) {
  return PATHWAYS.filter((pathway) => pathway.to === regionCode).reduce((total, pathway) => {
    const sign = pathway.inhibitory ? -1 : 1;
    return total + activities[pathway.from] * weights[pathway.id] * sign;
  }, 0);
}

function spikeProbability(activity) {
  return clamp((activity - 0.24) * 1.1, 0, 0.85);
}

function stepSimulation(previous, targets) {
  const nextTick = previous.tick + 1;
  const burstFrames = Math.max(0, previous.burstFrames - 1);

  const nextActivities = {};
  const nextLastSpike = { ...previous.lastSpike };
  const spiked = {};

  for (const region of BRAIN_REGIONS) {
    const incoming = computeIncomingSignal(region.code, previous.activities, previous.weights);
    const thalamicBurst = region.code === 'THL' ? burstFrames * 0.018 : 0;
    // Blend the anatomical base with the externally-driven target so scan data
    // steers the equilibrium without freezing the dynamics.
    const target = targets?.[region.code] != null
      ? region.baseActivity * 0.3 + targets[region.code] * 0.7
      : region.baseActivity;
    const homeostasis = (target - previous.activities[region.code]) * 0.12;
    const replayBoost = region.code === 'HPC' || region.code === 'CTX'
      ? (previous.activities.HPC + previous.activities.CTX) * 0.022
      : 0;

    const noise = randomRange(-0.018, 0.018);
    const nextActivity = clamp(
      previous.activities[region.code] * 0.78 + incoming * 0.18 + homeostasis + replayBoost + thalamicBurst + noise,
      0.03,
      1,
    );

    nextActivities[region.code] = nextActivity;

    if (Math.random() < spikeProbability(nextActivity)) {
      nextLastSpike[region.code] = nextTick;
      spiked[region.code] = true;
    } else {
      spiked[region.code] = false;
    }
  }

  const nextWeights = {};
  for (const pathway of PATHWAYS) {
    const preTime = nextLastSpike[pathway.from];
    const postTime = nextLastSpike[pathway.to];
    const dt = postTime - preTime;
    let delta = 0;

    if (Math.abs(dt) <= 5) {
      if (dt > 0) delta += Math.exp(-Math.abs(dt) / 3.2) * 0.014;
      else if (dt < 0) delta -= Math.exp(-Math.abs(dt) / 3.2) * 0.013;
    }

    if (burstFrames > 0 && pathway.from === 'THL') delta += 0.0035;

    const homeostaticPull = (0.44 - previous.weights[pathway.id]) * 0.015;
    const activityCoupling = nextActivities[pathway.from] * nextActivities[pathway.to] * 0.0065;
    const inhibitionDrag = pathway.inhibitory ? -0.001 : 0;

    nextWeights[pathway.id] = clamp(
      previous.weights[pathway.id] + delta + homeostaticPull + activityCoupling + inhibitionDrag,
      0.08,
      0.95,
    );
  }

  return {
    ...previous,
    tick: nextTick,
    burstFrames,
    activities: nextActivities,
    weights: nextWeights,
    lastSpike: nextLastSpike,
    spikes: spiked,
    meanFiring: mean(Object.values(nextActivities)),
  };
}

export function useBrainSimulation({ running = true, targetActivities = null } = {}) {
  const initialState = useMemo(() => ({
    tick: 0,
    burstFrames: 0,
    selectedRegion: null,
    activities: INITIAL_ACTIVITIES,
    weights: INITIAL_WEIGHTS,
    lastSpike: INITIAL_LAST_SPIKE,
    spikes: Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, false])),
    meanFiring: mean(Object.values(INITIAL_ACTIVITIES)),
  }), []);

  const [state, setState] = useState(initialState);
  const targetsRef = useRef(targetActivities);
  targetsRef.current = targetActivities;

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setState((previous) => stepSimulation(previous, targetsRef.current));
    }, 120);
    return () => window.clearInterval(timer);
  }, [running]);

  // A burst makes the switch to a new target/preset visibly ripple through.
  useEffect(() => {
    if (targetActivities) setState((previous) => ({ ...previous, burstFrames: 18 }));
  }, [targetActivities]);

  const controls = useMemo(() => ({
    selectRegion(regionCode) {
      setState((previous) => ({
        ...previous,
        selectedRegion: previous.selectedRegion === regionCode ? null : regionCode,
      }));
    },
    clearSelection() {
      setState((previous) => ({ ...previous, selectedRegion: null }));
    },
  }), []);

  return { state, controls };
}
