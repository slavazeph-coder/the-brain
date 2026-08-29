export function createSeededRandom(seed, fallbackSeed = 1) {
  let value = (Number(seed) || Number(fallbackSeed) || 1) >>> 0;
  return function random() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clampInteger(value, { min, max, fallback }) {
  const parsed = Number.parseInt(String(value), 10);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, resolved));
}

export function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildMissionProofPack(result, comparison = null, createdAt = null) {
  const runCore = {
    mission: result.mission,
    configuration: result.configuration,
    metrics: result.metrics,
    status: result.status,
    ledger: result.ledger,
    claimBoundary: result.mission.claimBoundary,
  };
  const runSha256 = await sha256Hex(runCore);
  const proofCreatedAt = typeof createdAt === 'string' && createdAt.trim()
    ? createdAt.trim()
    : new Date().toISOString();

  const body = {
    schema: 'gaugegap.brainsnn_proof_mission.v1',
    runtime: 'brainsnn.proof_mission_runtime.v2',
    createdAt: proofCreatedAt,
    ...runCore,
    comparison,
    runIdentity: {
      algorithm: runSha256 ? 'SHA-256' : 'unavailable',
      sha256: runSha256,
    },
  };
  const artifactSha256 = await sha256Hex(body);

  return {
    ...body,
    evidence: {
      algorithm: artifactSha256 ? 'SHA-256' : 'unavailable',
      sha256: artifactSha256,
    },
  };
}
