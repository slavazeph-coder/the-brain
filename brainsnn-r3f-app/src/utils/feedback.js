/**
 * Layer 93 — Feedback Calibration
 *
 * User tags each Firewall scan as "accurate / too hot / too cold".
 * We track a running count and expose a calibration report + a
 * suggested multiplier the Firewall panel can apply to the raw
 * pressure as an "adjusted (calibrated)" readout.
 */

const STORAGE_KEY = 'brainsnn_feedback_v1';
const MAX_ENTRIES = 200;

function read() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_ENTRIES))); } catch { /* quota */ }
}

export const VERDICTS = ['too_cold', 'accurate', 'too_hot'];

export function recordFeedback({ pressure, verdict, receiptId = null, excerpt = '' }) {
  if (!VERDICTS.includes(verdict)) throw new Error(`unknown verdict: ${verdict}`);
  const entry = {
    ts: Date.now(),
    pressure: Math.max(0, Math.min(1, Number(pressure) || 0)),
    verdict,
    receiptId,
    excerpt: String(excerpt || '').slice(0, 120),
  };
  write([...read(), entry]);
  return entry;
}

export function listFeedback() { return read(); }

export function clearFeedback() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

/**
 * Returns { total, accurate, tooHot, tooCold, accuracy, suggestedMul }.
 * suggestedMul is a pressure multiplier (clamped 0.6–1.4) that pulls
 * the aggregate Firewall output toward the user's calibration —
 * e.g. if the user keeps flagging "too hot", the multiplier drops
 * below 1 so adjusted pressure reads lower.
 */
export function calibrationReport() {
  const rows = read();
  const total = rows.length;
  if (total === 0) {
    return { total: 0, accurate: 0, tooHot: 0, tooCold: 0, accuracy: null, suggestedMul: 1 };
  }
  const tooHot = rows.filter((r) => r.verdict === 'too_hot').length;
  const tooCold = rows.filter((r) => r.verdict === 'too_cold').length;
  const accurate = rows.filter((r) => r.verdict === 'accurate').length;
  const accuracy = accurate / total;

  // Bias = tooHot - tooCold normalized by total. Positive → system
  // runs hot → scale down. Negative → runs cold → scale up.
  const bias = (tooHot - tooCold) / total;
  const suggestedMul = Math.max(0.6, Math.min(1.4, 1 - bias * 0.4));

  return {
    total,
    accurate,
    tooHot,
    tooCold,
    accuracy,
    bias,
    suggestedMul: +suggestedMul.toFixed(3),
  };
}
