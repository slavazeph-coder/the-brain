/** Illustrative runtime assumptions, not measured policy throughput or a quote. */
export const PRICING_DEFAULTS = Object.freeze({
  episodes: 100000,
  episodesPerWorkerHour: 500,
  hourlyRateUSD: 0.60,
  grossMarginPercent: 30,
});

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Compute an illustrative runtime price from a complete numeric input object.
 * Invalid or out-of-range values return null; no values are coerced or clamped.
 */
export function estimateRuntimePrice(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const { episodes, episodesPerWorkerHour, hourlyRateUSD, grossMarginPercent } = input;
  if (!Number.isSafeInteger(episodes) || episodes < 1 || episodes > 100000) return null;
  if (!isFiniteNumber(episodesPerWorkerHour) || episodesPerWorkerHour < 0.001 || episodesPerWorkerHour > 10000000) return null;
  if (!isFiniteNumber(hourlyRateUSD) || hourlyRateUSD < 0.000001 || hourlyRateUSD > 10000) return null;
  if (!isFiniteNumber(grossMarginPercent) || grossMarginPercent < 0 || grossMarginPercent > 75) return null;

  const workerHours = episodes / episodesPerWorkerHour;
  const runtimeCostUSD = workerHours * hourlyRateUSD;
  const runtimePriceUSD = runtimeCostUSD / (1 - grossMarginPercent / 100);

  return {
    episodes,
    episodesPerWorkerHour,
    hourlyRateUSD,
    grossMarginPercent: grossMarginPercent === 0 ? 0 : grossMarginPercent,
    workerHours,
    runtimeCostUSD,
    serviceMarginAllowanceUSD: runtimePriceUSD - runtimeCostUSD,
    runtimePriceUSD,
    pricePerEpisodeUSD: runtimePriceUSD / episodes,
  };
}

/** Explicit USD display, with optional precision for per-episode prices. */
export function formatUSD(value, options = {}) {
  if (!isFiniteNumber(value)) return '—';
  const { minimumFractionDigits = 2, maximumFractionDigits = 2 } = options;
  return `US$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value === 0 ? 0 : value)}`;
}

export const DEFAULT_RUNTIME_ESTIMATE = Object.freeze(estimateRuntimePrice(PRICING_DEFAULTS));
