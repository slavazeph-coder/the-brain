import { useEffect, useMemo, useState } from "react";
import { BRAIN_REGIONS, PATHWAYS } from "../constants/site";
import { clamp, mean, randomRange } from "../lib/brainMath";

const INITIAL_ACTIVITIES = Object.fromEntries(
  BRAIN_REGIONS.map((region) => [region.code, region.baseActivity])
);

const INITIAL_WEIGHTS = Object.fromEntries(
  PATHWAYS.map((pathway) => [pathway.id, pathway.initialWeight])
);

const INITIAL_LAST_SPIKE = Object.fromEntries(
  BRAIN_REGIONS.map((region) => [region.code, -999])
);

function computeIncomingSignal(regionCode, activities, weights) {
  return PATHWAYS.filter((pathway) => pathway.to === regionCode).reduce(
    (total, pathway) => {
      const sign = pathway.inhibitory ? -1 : 1;
      return total + activities[pathway.from] * weights[pathway.id] * sign;
    },
    0
  );
}

function spikeProbability(activity) {
  return clamp((activity - 0.24) * 1.1, 0, 0.85);
}

function stepSimulation(previous) {
  const nextTick = previous.tick + 1;
  const burstFrames = Math.max(0, previous.burstFrames - 1);

  const nextActivities = {};
  const nextLastSpike = { ...previous.lastSpike };
  const spiked = {};

  for (const region of BRAIN_REGIONS) {
    const incoming = computeIncomingSignal(
      region.code,
      previous.activities,
      previous.weights
    );
    const thalamicBurst = region.code === "THL" ? burstFrames * 0.018 : 0;
    const homeostasis = (region.baseActivity - previous.activities[region.code]) * 0.08;
    const replayBoost =
      region.code === "HPC" || region.code === "CTX"
        ? (previous.activities.HPC + previous.activities.CTX) * 0.022
        : 0;

    const noise = randomRange(-0.018, 0.018);
    const nextActivity = clamp(
      previous.activities[region.code] * 0.78 +
        incoming * 0.18 +
        homeostasis +
        replayBoost +
        thalamicBurst +
        noise,
      0.03,
      1
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
      if (dt > 0) {
        delta += Math.exp(-Math.abs(dt) / 3.2) * 0.014;
      } else if (dt < 0) {
        delta -= Math.exp(-Math.abs(dt) / 3.2) * 0.013;
      }
    }

    if (burstFrames > 0 && pathway.from === "THL") {
      delta += 0.0035;
    }

    const homeostaticPull = (0.44 - previous.weights[pathway.id]) * 0.015;
    const activityCoupling =
      nextActivities[pathway.from] * nextActivities[pathway.to] * 0.0065;
    const inhibitionDrag = pathway.inhibitory ? -0.001 : 0;

    nextWeights[pathway.id] = clamp(
      previous.weights[pathway.id] + delta + homeostaticPull + activityCoupling + inhibitionDrag,
      0.08,
      0.95
    );
  }

  const meanFiring = mean(Object.values(nextActivities));
  const plasticity = mean(Object.values(nextWeights));
  const history = [...previous.history, meanFiring].slice(-48);

  return {
    ...previous,
    tick: nextTick,
    burstFrames,
    activities: nextActivities,
    weights: nextWeights,
    lastSpike: nextLastSpike,
    spikes: spiked,
    meanFiring,
    plasticity,
    history,
  };
}

export function useBrainSimulation() {
  const initialState = useMemo(
    () => ({
      tick: 0,
      burstFrames: 0,
      running: true,
      selectedRegion: null,
      activities: INITIAL_ACTIVITIES,
      weights: INITIAL_WEIGHTS,
      lastSpike: INITIAL_LAST_SPIKE,
      spikes: Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, false])),
      meanFiring: mean(Object.values(INITIAL_ACTIVITIES)),
      plasticity: mean(Object.values(INITIAL_WEIGHTS)),
      history: Array.from({ length: 32 }, () => mean(Object.values(INITIAL_ACTIVITIES))),
    }),
    []
  );

  const [state, setState] = useState(initialState);

  useEffect(() => {
    if (!state.running) return undefined;
    const timer = window.setInterval(() => {
      setState((previous) => stepSimulation(previous));
    }, 120);

    return () => window.clearInterval(timer);
  }, [state.running]);

  const controls = useMemo(
    () => ({
      toggleRunning() {
        setState((previous) => ({ ...previous, running: !previous.running }));
      },
      triggerBurst() {
        setState((previous) => ({ ...previous, burstFrames: 18 }));
      },
      reset() {
        setState(initialState);
      },
      selectRegion(regionCode) {
        setState((previous) => ({
          ...previous,
          selectedRegion:
            previous.selectedRegion === regionCode ? null : regionCode,
        }));
      },
      clearSelection() {
        setState((previous) => ({ ...previous, selectedRegion: null }));
      },
    }),
    [initialState]
  );

  return { state, controls };
}
