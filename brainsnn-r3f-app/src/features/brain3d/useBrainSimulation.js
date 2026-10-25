// React wrapper around the pure brain model in brainModel.js.
//
// The dynamics, parameters and interventions all live in the model so they can
// be seeded, unit-tested and replayed headlessly. This file owns only the React
// concerns: the tick timer, state plumbing and the control verbs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRng } from '../../lib/rng.js';
import {
  createBrainParams,
  createBrainState,
  DEFAULT_PARAMS,
  EMPTY_INTERVENTIONS,
  stepBrain,
} from './brainModel.js';

export function useBrainSimulation({
  running = true,
  targetActivities = null,
  seed = 'brainsnn',
  params: paramOverrides = null,
  speed = 1,
} = {}) {
  const params = useMemo(() => createBrainParams(paramOverrides), [paramOverrides]);
  const [state, setState] = useState(() => createBrainState(params));
  const [paused, setPaused] = useState(false);
  const [interventions, setInterventions] = useState(EMPTY_INTERVENTIONS);

  // The render loop reads these through refs so changing a target or an
  // intervention never restarts the timer.
  const targetsRef = useRef(targetActivities);
  targetsRef.current = targetActivities;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const interventionsRef = useRef(interventions);
  interventionsRef.current = interventions;

  // Seeded so the same content always produces the same run; re-seeded whenever
  // the seed changes so a new scan starts a fresh, reproducible trajectory.
  const rngRef = useRef(null);
  if (rngRef.current === null) rngRef.current = createRng(seed);
  useEffect(() => {
    rngRef.current = createRng(seed);
  }, [seed]);

  const advance = useCallback(() => {
    setState((previous) => stepBrain(previous, {
      targets: targetsRef.current,
      params: paramsRef.current,
      interventions: interventionsRef.current,
      rng: rngRef.current,
    }));
  }, []);

  const intervalMs = Math.max(16, params.tickMs / Math.max(0.1, speed));
  useEffect(() => {
    if (!running || paused) return undefined;
    const timer = window.setInterval(advance, intervalMs);
    return () => window.clearInterval(timer);
  }, [running, paused, intervalMs, advance]);

  // A burst makes the switch to a new target/preset visibly ripple through.
  useEffect(() => {
    if (targetActivities) {
      setState((previous) => ({ ...previous, burstFrames: paramsRef.current.burstTicks }));
    }
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
    togglePaused() {
      setPaused((previous) => !previous);
    },
    step() {
      advance();
    },
    triggerBurst() {
      setState((previous) => ({ ...previous, burstFrames: paramsRef.current.burstTicks }));
    },
    reset() {
      rngRef.current = createRng(seed);
      setInterventions(EMPTY_INTERVENTIONS);
      setState(createBrainState(paramsRef.current));
    },
    // Inject a sustained current into one region (0 clears it).
    stimulate(regionCode, amount = 0.2) {
      setInterventions((previous) => ({
        ...previous,
        stimuli: { ...previous.stimuli, [regionCode]: amount },
      }));
    },
    clearStimulus(regionCode) {
      setInterventions((previous) => {
        const stimuli = { ...previous.stimuli };
        delete stimuli[regionCode];
        return { ...previous, stimuli };
      });
    },
    toggleLesion(regionCode) {
      setInterventions((previous) => {
        const lesions = previous.lesions.includes(regionCode)
          ? previous.lesions.filter((code) => code !== regionCode)
          : [...previous.lesions, regionCode];
        return { ...previous, lesions };
      });
    },
    toggleCut(pathwayId) {
      setInterventions((previous) => {
        const cuts = previous.cuts.includes(pathwayId)
          ? previous.cuts.filter((id) => id !== pathwayId)
          : [...previous.cuts, pathwayId];
        return { ...previous, cuts };
      });
    },
    clearInterventions() {
      setInterventions(EMPTY_INTERVENTIONS);
    },
  }), [advance, seed]);

  return { state: { ...state, paused, interventions, params }, controls };
}

export { DEFAULT_PARAMS };
