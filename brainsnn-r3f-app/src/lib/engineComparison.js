import { createHash } from 'node:crypto';
import { analyzeContentLocally } from './analysisEngine.js';
import { computeFirewall } from './firewallLayer.js';

export const ENGINE_COMPARISON_VERSION = 'brainsnn.engine-comparison.v1';
export const ENGINE_COMPARE_MAX_CHARS = 8000;

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inputText(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > ENGINE_COMPARE_MAX_CHARS) {
    throw new TypeError(`${name} must contain 1–${ENGINE_COMPARE_MAX_CHARS} characters of non-empty text.`);
  }
  // UTF-8 replaces lone UTF-16 surrogates with U+FFFD. Reject them so distinct
  // accepted source strings cannot collapse to the same bytes before hashing.
  if (!value.isWellFormed()) throw new TypeError(`${name} must contain well-formed Unicode without lone surrogates.`);
  return value;
}

function allowance(value, fallback, max, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new TypeError(`${name} must be a number between 0 and ${max}.`);
  }
  return value;
}

// The analyzer collapses whitespace before segmenting. Retain a character map
// so a quotation still points to the user's exact, unnormalized source.
function normalizedSource(content) {
  let text = '';
  const starts = [], ends = [];
  for (const match of content.matchAll(/\S+|\s+/g)) {
    if (/^\s/.test(match[0])) {
      if (text && match.index + match[0].length < content.length) {
        text += ' '; starts.push(match.index); ends.push(match.index + match[0].length);
      }
    } else {
      text += match[0];
      for (let offset = 0; offset < match[0].length; offset += 1) {
        starts.push(match.index + offset); ends.push(match.index + offset + 1);
      }
    }
  }
  return { text, starts, ends };
}

function inspect(content) {
  const analysis = analyzeContentLocally({ content, contentType: 'text', forceFallback: true });
  const firewall = computeFirewall({ content, metrics: analysis.metrics, isFallback: true });
  const normalized = normalizedSource(content);
  let cursor = 0;
  let shortened = false;
  const findings = analysis.heatmap.flatMap((segment) => {
    const offset = normalized.text.indexOf(segment.text, cursor);
    if (offset < 0) { shortened = true; return []; }
    cursor = offset + segment.text.length;
    const start = normalized.starts[offset];
    const end = normalized.ends[cursor - 1];
    const rawQuotation = content.slice(start, end);
    const quotation = Array.from(rawQuotation).slice(0, 320).join('');
    if (quotation.length < rawQuotation.length) shortened = true;
    return [{ quotation, start, end: start + quotation.length, signal: segment.category, explanation: segment.reason }];
  });
  return {
    content,
    sha256: hash(content),
    model: analysis.crumbModelStats.model,
    signals: { trust: analysis.metrics.trust, manipulationPressure: firewall.manipulationPressure },
    findings,
    findingsTruncated: shortened || cursor < normalized.text.length,
    recommendations: analysis.recommendations,
  };
}

/** A stateless, local comparison for agent callers. Scores are observations of
 * this heuristic engine, never proof of facts, buyer response or work acceptance.
 * Both texts use the same scorer and limits; neither can supply its own score. */
export function compareEngineInputs(input = {}, { now = () => new Date(), monotonic = () => performance.now(), revision = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('A comparison object is required.');
  const originalText = inputText(input.original, 'original');
  const candidateText = inputText(input.candidate, 'candidate');
  const requestedLimits = input.limits === undefined ? {} : input.limits;
  if (!requestedLimits || typeof requestedLimits !== 'object' || Array.isArray(requestedLimits)) throw new TypeError('limits must be an object.');
  const limits = {
    maxTrustDrop: allowance(requestedLimits.maxTrustDrop, 0, 100, 'maxTrustDrop'),
    maxPressureIncrease: allowance(requestedLimits.maxPressureIncrease, 0, 1, 'maxPressureIncrease'),
  };
  const started = monotonic();
  const original = inspect(originalText);
  const candidate = inspect(candidateText);
  const delta = {
    trust: candidate.signals.trust - original.signals.trust,
    manipulationPressure: Number((candidate.signals.manipulationPressure - original.signals.manipulationPressure).toFixed(3)),
  };
  const checks = [
    { id: 'trust-regression', metric: 'trust', delta: delta.trust, allowedDrop: limits.maxTrustDrop, passed: delta.trust >= -limits.maxTrustDrop },
    { id: 'pressure-regression', metric: 'manipulationPressure', delta: delta.manipulationPressure, allowedIncrease: limits.maxPressureIncrease, passed: delta.manipulationPressure <= limits.maxPressureIncrease },
  ];
  const engineRevision = typeof revision === 'string' && /^[a-f0-9]{7,64}$/i.test(revision) ? revision : null;
  const identity = {
    schemaVersion: ENGINE_COMPARISON_VERSION, engineRevision,
    originalSha256: original.sha256, candidateSha256: candidate.sha256, limits,
    // Include measured outputs so changed heuristics cannot reuse the identity
    // even on a local build without a git revision.
    originalSignals: original.signals, candidateSignals: candidate.signals,
  };
  return {
    ...identity,
    id: `comparison-${hash(JSON.stringify({ ...identity, original, candidate, checks }))}`,
    generatedAt: now().toISOString(),
    execution: { mode: 'deterministic-local', providerCalls: 0, providerTokens: 0, durationMs: Math.max(0, Math.round(monotonic() - started)), persisted: false },
    original, candidate, delta, checks,
    signalsWithinLimits: checks.every((check) => check.passed),
    inputChanged: original.sha256 !== candidate.sha256,
    decision: 'REVIEW_REQUIRED',
    evidence: { factsVerified: false, marketOutcomeMeasured: false, workAccepted: false, contextPromoted: false },
    boundary: 'This compares deterministic text signals using the same scorer. Source spans explain a signal; they do not verify a claim. Passing signal checks does not establish factual accuracy, customer demand, neural response, or an accepted improvement. Review the exact texts and test the intended outcome independently.',
  };
}
