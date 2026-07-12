// Browser evidence export for arcade labs ("proofpack"): a content-hashed
// JSON bundle of the exact model, live parameters and solver settings behind
// what is on screen. Schema mirrors gaugegap-foundry's browser proofpacks.
export const EVIDENCE_SCHEMA = 'gaugegap.browser_attractor_proofpack.v1';

export const ATTRACTOR_CLAIM_BOUNDARY =
  'Educational finite numerical simulation only; not proof of a physical claim, '
  + 'continuum theorem, or formal chaos result. Browser floating-point output is '
  + 'reproducible per browser build, not across engines.';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export async function sha256Hex(text) {
  try {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'unavailable-no-webcrypto';
  }
}

// Solver facts mirror the render loop in AttractorPlayground.jsx; update both
// together if the integrator changes.
export async function buildAttractorEvidence({ params, scores, shareUrl, controls = [], now = new Date() }) {
  const pack = {
    schema: EVIDENCE_SCHEMA,
    created_at_utc: now.toISOString(),
    lab: { id: 'attractor', title: 'Butterfly Effect Lab', site: 'brainsnn.com' },
    model: {
      id: 'lorenz',
      equations: ['dx/dt = sigma (y - x)', 'dy/dt = x (rho - z) - y', 'dz/dt = x y - beta z'],
    },
    solver: {
      method: 'explicit Euler (streaming)',
      dt: `0.0048 x speed (= ${Number((0.0048 * (params.speed ?? 1)).toFixed(6))}) per step`,
      steps_per_frame: `max(4, floor(12 x speed)) (= ${Math.max(4, Math.floor(12 * (params.speed ?? 1)))})`,
      initial_state: 'randomized near the origin (x ~ 0.1); reset on divergence',
    },
    parameters: {
      sigma: params.sigma,
      rho: params.rho,
      beta: params.beta,
      speed: params.speed,
    },
    parameter_ranges: Object.fromEntries(controls.map((control) => [control.key, { min: control.min, max: control.max, step: control.step }])),
    scores: scores || null,
    share_url: shareUrl || null,
    claim_boundary: ATTRACTOR_CLAIM_BOUNDARY,
  };
  pack.content_hash = await sha256Hex(canonicalJson(pack));
  return pack;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
