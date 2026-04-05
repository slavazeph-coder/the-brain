import { BASELINE_REGIONS, BASELINE_WEIGHTS, LINKS, SCENARIOS } from '../data/network';

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (n = 0.08) => (Math.random() - 0.5) * n;

export function createInitialState() {
  return {
    regions: { ...BASELINE_REGIONS },
    weights: { ...BASELINE_WEIGHTS },
    running: true,
    burst: 0,
    tick: 0,
    scenario: 'Baseline',
    history: [],
    selected: 'THL'
  };
}

export function applyScenario(state, key) {
  const s = SCENARIOS[key];
  if (!s) return state;
  const weights = { ...state.weights, ...s.patch };
  return {
    ...state,
    regions: { ...s.regions },
    weights,
    burst: key === 'burst' ? 20 : state.burst,
    scenario: s.label,
    tick: 0
  };
}

export function resetState() {
  return createInitialState();
}

export function simulateStep(state) {
  if (!state.running) return state;
  const regions = { ...state.regions };
  const weights = { ...state.weights };
  const burst = Math.max(0, state.burst - 1);
  const thlBoost = state.burst ? 0.35 : 0;

  Object.keys(regions).forEach((r) => {
    const coupling =
      (r === 'CTX' ? regions.THL * 0.24 + regions.PFC * 0.08 + regions.CBL * 0.06 : 0) +
      (r === 'HPC' ? regions.CTX * 0.12 : 0) +
      (r === 'PFC' ? regions.CTX * 0.10 : 0) +
      (r === 'BG'  ? regions.AMY * 0.08 : 0) +
      (r === 'THL' ? -regions.BG * 0.04 + thlBoost : 0);
    regions[r] = clamp(regions[r] + rand() + coupling * 0.08, 0.02, 0.95);
  });

  Object.keys(weights).forEach((k) => {
    const [pre, post] = k.split('→');
    const target = regions[pre] * regions[post] * 0.92 + (state.burst ? 0.04 : 0);
    weights[k] = clamp(weights[k] + (target - 0.08) * 0.02 + rand(0.01), 0.08, 0.92);
  });

  const mean = Object.values(regions).reduce((a, v) => a + v, 0) / Object.keys(regions).length;
  const plasticity = Object.values(weights).reduce((a, v) => a + v, 0) / Object.keys(weights).length;
  const connectionStats = LINKS.map(([from, to]) => ({
    id: `${from}→${to}`,
    from,
    to,
    weight: weights[`${from}→${to}`],
    influence: regions[from] * weights[`${from}→${to}`]
  }));

  return {
    ...state,
    regions,
    weights,
    burst,
    tick: state.tick + 1,
    history: [...state.history.slice(-39), { mean, plasticity }],
    connectionStats,
    mean,
    plasticity
  };
}
