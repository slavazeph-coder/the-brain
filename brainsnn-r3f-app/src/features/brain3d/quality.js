// Render quality tiers.
//
// `detectBrainQuality` in Brain3D.jsx answers one question — 3D or not — and
// answers it with `width < 768 => no`. For a decorative visual that is a fine
// trade. For the game it is not: it hides the headline feature from every phone,
// which is where most visitors are.
//
// So the game asks a different question: not *whether* to render in 3D, but *how
// much*. A phone gets fewer packets, a lower pixel ratio and no antialiasing
// rather than a flat picture. `2d` survives as the floor for genuinely incapable
// devices — no WebGL, or the explicit escape hatch.
//
// Pure and DOM-free so the bare-Node runner can test it.

export const TIERS = Object.freeze(['high', 'medium', 'low', '2d']);

export const TIER_SETTINGS = Object.freeze({
  high: { maxPackets: 90, dpr: [1, 1.75], antialias: true, labels: 6, adaptiveDpr: false },
  medium: { maxPackets: 48, dpr: [1, 1.5], antialias: true, labels: 4, adaptiveDpr: true },
  low: { maxPackets: 24, dpr: [1, 1.2], antialias: false, labels: 2, adaptiveDpr: true },
  '2d': { maxPackets: 0, dpr: [1, 1], antialias: false, labels: 0, adaptiveDpr: false },
});

/**
 * Pick a tier from device capabilities.
 *
 * `forced` is the existing localStorage hatch (`brainsnn:force-brain-2d`), kept
 * so CI and debugging can still pin the 2D path. It now also accepts a tier name
 * so a specific tier can be exercised directly.
 */
export function resolveQualityTier({
  width = 1024,
  deviceMemory,
  hardwareConcurrency,
  webgl = true,
  forced = null,
  reducedMotion = false,
} = {}) {
  if (forced === '1') return '2d';
  if (typeof forced === 'string' && TIERS.includes(forced)) return forced;
  if (!webgl) return '2d';

  // Reduced motion still renders — it just renders a still frame. Dropping to
  // 2D would remove the game rather than calm it.
  const memory = Number.isFinite(deviceMemory) ? deviceMemory : 8;
  const cores = Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : 8;

  if (memory <= 2 || cores <= 2) return 'low';
  if (width < 560) return 'low';
  if (width < 900 || memory < 4 || cores < 4) return 'medium';
  if (reducedMotion) return 'medium';
  return 'high';
}

export function settingsForTier(tier) {
  return TIER_SETTINGS[tier] || TIER_SETTINGS.medium;
}

/** Whether this tier renders WebGL at all. */
export function isThreeTier(tier) {
  return tier !== '2d';
}
