/**
 * Neural Analytics Engine
 *
 * Computes trend analysis, region correlations, anomaly detection,
 * and threshold alerts from brain state history.
 */

// ---------- trend analysis ----------

/**
 * Build per-region activity timeseries from state history snapshots.
 * Returns { [regionKey]: number[] } with the last `window` ticks.
 */
export function buildRegionTimeseries(historyBuffer, window = 40) {
  const sliced = historyBuffer.slice(-window);
  if (!sliced.length || !sliced[0].regions) return {};

  const keys = Object.keys(sliced[0].regions);
  const series = {};
  for (const k of keys) {
    series[k] = sliced.map((frame) => frame.regions?.[k] ?? 0);
  }
  return series;
}

/**
 * Compute simple moving average for a numeric array.
 */
export function movingAverage(arr, period = 5) {
  if (arr.length < period) return arr.slice();
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += arr[j];
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Compute trend direction for a region: "rising", "falling", "stable".
 */
export function trendDirection(values, lookback = 8) {
  if (values.length < lookback) return 'stable';
  const recent = values.slice(-lookback);
  const first = recent.slice(0, Math.floor(lookback / 2));
  const second = recent.slice(Math.floor(lookback / 2));
  const avgFirst = first.reduce((a, v) => a + v, 0) / first.length;
  const avgSecond = second.reduce((a, v) => a + v, 0) / second.length;
  const delta = avgSecond - avgFirst;
  if (delta > 0.04) return 'rising';
  if (delta < -0.04) return 'falling';
  return 'stable';
}

// ---------- correlation ----------

/**
 * Pearson correlation between two equal-length arrays.
 */
function pearson(a, b) {
  const n = a.length;
  if (n < 3) return 0;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]; sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  return den === 0 ? 0 : num / den;
}

/**
 * Compute pairwise correlation matrix for all regions.
 * Returns { [regionA-regionB]: correlation }
 */
export function correlationMatrix(timeseries) {
  const keys = Object.keys(timeseries);
  const matrix = {};
  for (let i = 0; i < keys.length; i++) {
    for (let j = i; j < keys.length; j++) {
      const key = `${keys[i]}-${keys[j]}`;
      matrix[key] = i === j ? 1 : parseFloat(pearson(timeseries[keys[i]], timeseries[keys[j]]).toFixed(3));
    }
  }
  return matrix;
}

// ---------- anomaly detection ----------

/**
 * Detect anomalous spikes using z-score against running stats.
 * Returns array of { region, tick, value, zScore } for anomalies.
 */
export function detectAnomalies(timeseries, threshold = 2.0) {
  const anomalies = [];
  for (const [region, values] of Object.entries(timeseries)) {
    if (values.length < 5) continue;
    const mean = values.reduce((a, v) => a + v, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    if (std < 0.01) continue; // near-constant, skip

    for (let i = 0; i < values.length; i++) {
      const z = Math.abs((values[i] - mean) / std);
      if (z > threshold) {
        anomalies.push({
          region,
          tick: i,
          value: parseFloat(values[i].toFixed(4)),
          zScore: parseFloat(z.toFixed(2))
        });
      }
    }
  }
  return anomalies.sort((a, b) => b.zScore - a.zScore).slice(0, 10);
}

// ---------- threshold alerts ----------

const DEFAULT_THRESHOLDS = {
  high: 0.75,
  low: 0.08,
  volatility: 0.15
};

/**
 * Check current region values against thresholds.
 * Returns array of alert objects.
 */
export function checkThresholds(regions, timeseries, thresholds = DEFAULT_THRESHOLDS) {
  const alerts = [];

  for (const [region, value] of Object.entries(regions)) {
    if (value > thresholds.high) {
      alerts.push({ region, type: 'high', message: `${region} elevated at ${(value * 100).toFixed(0)}%`, severity: 'warning' });
    }
    if (value < thresholds.low) {
      alerts.push({ region, type: 'low', message: `${region} suppressed at ${(value * 100).toFixed(0)}%`, severity: 'info' });
    }

    // Volatility: std dev of last 10 values
    const series = timeseries[region];
    if (series && series.length >= 10) {
      const recent = series.slice(-10);
      const mean = recent.reduce((a, v) => a + v, 0) / recent.length;
      const std = Math.sqrt(recent.reduce((a, v) => a + (v - mean) ** 2, 0) / recent.length);
      if (std > thresholds.volatility) {
        alerts.push({ region, type: 'volatile', message: `${region} volatile (σ=${std.toFixed(3)})`, severity: 'warning' });
      }
    }
  }

  return alerts;
}

// ---------- session summary ----------

export function sessionSummary(regions, timeseries, tick) {
  const keys = Object.keys(regions);
  const values = Object.values(regions);
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const sorted = [...Object.entries(regions)].sort((a, b) => b[1] - a[1]);
  const trends = {};
  for (const k of keys) {
    trends[k] = trendDirection(timeseries[k] || []);
  }

  const risingCount = Object.values(trends).filter((t) => t === 'rising').length;
  const fallingCount = Object.values(trends).filter((t) => t === 'falling').length;

  return {
    tick,
    meanActivity: parseFloat(mean.toFixed(4)),
    leadRegion: sorted[0]?.[0] || '—',
    trailingRegion: sorted[sorted.length - 1]?.[0] || '—',
    trends,
    risingCount,
    fallingCount,
    stableCount: keys.length - risingCount - fallingCount
  };
}
