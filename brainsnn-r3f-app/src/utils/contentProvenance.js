/**
 * Layer 101 — Content Verification System
 *
 * "We're shifting from 'what we see is real' to 'what's the chain of
 * custody on what we see'." This layer answers two questions:
 *
 *   1. Who signed this content, and has it been tampered with?
 *      → ECDSA P-256 keypair via Web Crypto, persisted locally.
 *      → Signed manifests carry a SHA-256 of the payload + ordered
 *        edit log. Each edit is itself signed and references the
 *        previous step's hash, forming a chain of custody (lite C2PA).
 *
 *   2. Does this read as human or AI-perfect?
 *      → Heuristic humanity score: candid markers (typos, hedges,
 *        ellipses, ALL-CAPS bursts, em-dashes used naturally) versus
 *        AI-perfect markers (uniform sentence cadence, hedging
 *        boilerplate, listicle scaffolding, no contractions, etc).
 *      → Returns a 0–100 score + per-axis evidence so creators can
 *        see WHY a piece reads human or polished.
 *
 * All keys, manifests, and the rolling log live in localStorage.
 * Falls back gracefully when SubtleCrypto is unavailable (FNV hash
 * receipt only, signing disabled with a clear status).
 */

const PRIVKEY_KEY = 'brainsnn_provenance_priv_v1';
const PUBKEY_KEY = 'brainsnn_provenance_pub_v1';
const HANDLE_KEY = 'brainsnn_provenance_handle_v1';
const LOG_KEY = 'brainsnn_provenance_log_v1';
const MAX_LOG = 25;

const SIGN_ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS = { name: 'ECDSA', hash: { name: 'SHA-256' } };

/* ----------------------------- crypto core ---------------------------- */

export function isCryptoAvailable() {
  return (
    typeof crypto !== 'undefined'
    && !!crypto.subtle
    && typeof crypto.subtle.generateKey === 'function'
    && typeof crypto.subtle.sign === 'function'
  );
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function sha256Hex(str) {
  if (isCryptoAvailable()) {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // FNV-1a fallback (display-only; not cryptographically secure)
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0')
    + (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

/* ------------------------------ identity ------------------------------ */

export async function ensureIdentity({ handle } = {}) {
  if (!isCryptoAvailable()) {
    return { ok: false, reason: 'subtle-unavailable' };
  }
  const existing = loadIdentity();
  if (existing.priv && existing.pub) return { ok: true, identity: existing };

  const pair = await crypto.subtle.generateKey(SIGN_ALG, true, ['sign', 'verify']);
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pubFp = await sha256Hex(JSON.stringify(pubJwk));

  try {
    localStorage.setItem(PRIVKEY_KEY, JSON.stringify(privJwk));
    localStorage.setItem(PUBKEY_KEY, JSON.stringify(pubJwk));
    if (handle) localStorage.setItem(HANDLE_KEY, String(handle).slice(0, 40));
  } catch { /* quota — caller will retry */ }

  return {
    ok: true,
    identity: {
      priv: privJwk,
      pub: pubJwk,
      fingerprint: pubFp,
      handle: handle || loadHandle(),
    },
  };
}

export function loadIdentity() {
  try {
    const priv = JSON.parse(localStorage.getItem(PRIVKEY_KEY) || 'null');
    const pub = JSON.parse(localStorage.getItem(PUBKEY_KEY) || 'null');
    return { priv, pub, handle: loadHandle() };
  } catch { return { priv: null, pub: null, handle: '' }; }
}

export function loadHandle() {
  try { return localStorage.getItem(HANDLE_KEY) || ''; } catch { return ''; }
}

export function setHandle(h) {
  try { localStorage.setItem(HANDLE_KEY, String(h || '').slice(0, 40)); } catch { /* noop */ }
}

export async function fingerprintFor(pubJwk) {
  return sha256Hex(JSON.stringify(pubJwk));
}

export function clearIdentity() {
  try {
    localStorage.removeItem(PRIVKEY_KEY);
    localStorage.removeItem(PUBKEY_KEY);
  } catch { /* noop */ }
}

async function importPriv(jwk) {
  return crypto.subtle.importKey('jwk', jwk, SIGN_ALG, false, ['sign']);
}

async function importPub(jwk) {
  return crypto.subtle.importKey('jwk', jwk, SIGN_ALG, true, ['verify']);
}

/* ----------------------------- manifests ------------------------------ */

function canonicalize(obj) {
  // Stable JSON: sort keys recursively so signatures are reproducible.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

function nowIso() { return new Date().toISOString(); }

/**
 * Sign content. Returns a manifest object suitable for sharing alongside
 * the original payload. Recipients only need the manifest + payload to
 * verify (manifest carries the public key + chain).
 */
export async function signContent({
  payload,
  payloadKind = 'text',
  capturedAt,
  device,
  location,
  note,
}) {
  if (!isCryptoAvailable()) {
    return { ok: false, reason: 'subtle-unavailable' };
  }
  const id = await ensureIdentity();
  if (!id.ok) return { ok: false, reason: id.reason };
  const { priv, pub, handle } = id.identity;

  const payloadHash = await sha256Hex(String(payload || ''));
  const fingerprint = await fingerprintFor(pub);
  const step = {
    kind: 'origin',
    payloadKind,
    payloadHash,
    capturedAt: capturedAt || nowIso(),
    device: (device || '').slice(0, 80),
    location: (location || '').slice(0, 80),
    note: (note || '').slice(0, 200),
    prevHash: null,
  };
  const stepCanonical = canonicalize(step);
  const stepHash = await sha256Hex(stepCanonical);

  const privKey = await importPriv(priv);
  const sigBuf = await crypto.subtle.sign(
    SIGN_PARAMS,
    privKey,
    new TextEncoder().encode(stepCanonical),
  );
  const sig = bufToB64(sigBuf);

  const manifest = {
    v: 'brainsnn-prov/1',
    handle: handle || '',
    pub,
    fingerprint,
    chain: [{ ...step, hash: stepHash, sig }],
  };
  return { ok: true, manifest, payloadHash };
}

/**
 * Append a signed edit step to an existing manifest. Use this when the
 * creator legitimately edits the post — the chain shows reviewers the
 * full history with hash-linked signatures.
 */
export async function appendEdit({ manifest, payload, note, kind = 'edit' }) {
  if (!isCryptoAvailable()) return { ok: false, reason: 'subtle-unavailable' };
  if (!manifest || !Array.isArray(manifest.chain) || manifest.chain.length === 0) {
    return { ok: false, reason: 'invalid-manifest' };
  }
  const id = loadIdentity();
  if (!id.priv) return { ok: false, reason: 'no-identity' };

  const last = manifest.chain[manifest.chain.length - 1];
  const payloadHash = await sha256Hex(String(payload || ''));
  const step = {
    kind,
    payloadKind: last.payloadKind,
    payloadHash,
    capturedAt: nowIso(),
    device: '',
    location: '',
    note: (note || '').slice(0, 200),
    prevHash: last.hash,
  };
  const stepCanonical = canonicalize(step);
  const stepHash = await sha256Hex(stepCanonical);
  const privKey = await importPriv(id.priv);
  const sigBuf = await crypto.subtle.sign(
    SIGN_PARAMS,
    privKey,
    new TextEncoder().encode(stepCanonical),
  );
  const sig = bufToB64(sigBuf);

  const next = {
    ...manifest,
    chain: [...manifest.chain, { ...step, hash: stepHash, sig }],
  };
  return { ok: true, manifest: next, payloadHash };
}

/**
 * Verify a manifest against a payload. Walks the chain, re-derives each
 * step's hash, checks signature against manifest.pub, confirms the
 * latest step's payloadHash matches the supplied payload, and that
 * prevHash links are intact.
 */
export async function verifyManifest({ manifest, payload }) {
  if (!isCryptoAvailable()) return { ok: false, reason: 'subtle-unavailable' };
  if (!manifest || manifest.v !== 'brainsnn-prov/1') {
    return { ok: false, reason: 'unknown-manifest' };
  }
  if (!manifest.pub || !Array.isArray(manifest.chain) || manifest.chain.length === 0) {
    return { ok: false, reason: 'invalid-manifest' };
  }

  const pubKey = await importPub(manifest.pub);
  const fingerprint = await fingerprintFor(manifest.pub);
  const steps = [];
  let prevHash = null;
  for (const entry of manifest.chain) {
    const { hash, sig, ...step } = entry;
    if (step.prevHash !== prevHash) {
      return {
        ok: false,
        reason: 'chain-broken',
        atIndex: steps.length,
        fingerprint,
      };
    }
    const stepCanonical = canonicalize(step);
    const reHash = await sha256Hex(stepCanonical);
    if (reHash !== hash) {
      return { ok: false, reason: 'hash-mismatch', atIndex: steps.length, fingerprint };
    }
    let sigOk = false;
    try {
      sigOk = await crypto.subtle.verify(
        SIGN_PARAMS,
        pubKey,
        b64ToBuf(sig),
        new TextEncoder().encode(stepCanonical),
      );
    } catch { sigOk = false; }
    if (!sigOk) {
      return { ok: false, reason: 'bad-signature', atIndex: steps.length, fingerprint };
    }
    steps.push(entry);
    prevHash = hash;
  }

  const last = steps[steps.length - 1];
  const payloadHash = await sha256Hex(String(payload || ''));
  const payloadOk = last.payloadHash === payloadHash;

  return {
    ok: payloadOk,
    reason: payloadOk ? 'verified' : 'payload-tampered',
    fingerprint,
    handle: manifest.handle || '',
    steps,
    payloadHash,
    expectedPayloadHash: last.payloadHash,
  };
}

/* ------------------------------- log ---------------------------------- */

export function recentManifestLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function logManifest({ manifest, payloadExcerpt }) {
  try {
    const list = recentManifestLog();
    const last = manifest.chain[manifest.chain.length - 1];
    const slim = {
      ts: Date.now(),
      handle: manifest.handle || '',
      fingerprint: manifest.fingerprint,
      payloadKind: last.payloadKind,
      payloadHash: last.payloadHash,
      stepCount: manifest.chain.length,
      excerpt: (payloadExcerpt || '').slice(0, 80),
      latestSig: last.sig.slice(0, 16),
    };
    const next = [slim, ...list.filter((x) => x.payloadHash !== slim.payloadHash)].slice(0, MAX_LOG);
    localStorage.setItem(LOG_KEY, JSON.stringify(next));
    return next;
  } catch { return recentManifestLog(); }
}

export function clearManifestLog() {
  try { localStorage.removeItem(LOG_KEY); } catch { /* noop */ }
}

/* ---------------------------- humanity score -------------------------- */

const AI_BOILERPLATE = [
  /\bin (?:today's|todays) (?:fast[- ]paced|digital|modern) world\b/i,
  /\bit (?:is|'s) important to (?:note|remember|consider)\b/i,
  /\bin conclusion,?\b/i,
  /\bdelve into\b/i,
  /\bfurthermore,?\b/i,
  /\bmoreover,?\b/i,
  /\badditionally,?\b/i,
  /\boverall,?\s+this\b/i,
  /\bnavigat(?:e|ing) the (?:complex|landscape|world)\b/i,
  /\b(?:tapestry|ever[- ]evolving|cutting[- ]edge|game[- ]changer)\b/i,
  /\b(?:unleash|harness|leverage|elevate) (?:your|the) (?:potential|power)\b/i,
  /\bas an ai (?:language )?model\b/i,
];

const HEDGE_HUMAN = /\b(kinda|sorta|maybe|honestly|tbh|idk|imo|fwiw|ish|ok so)\b/i;
const FILLER = /\b(uh|um|like,|you know|i mean|anyway,|right\?)\b/i;
const CANDID = /(\.\.\.|—| -- |\bbtw\b|\blol\b|\boof\b|\byikes\b|\bwtf\b|\bdamn\b)/i;
const CONTRACTIONS = /\b(don't|can't|won't|i'm|you're|it's|that's|we're|they're|isn't|aren't|wasn't|weren't|i'll|we'll)\b/i;

function tokenizeSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
    .filter(Boolean);
}

function tokenizeWords(text) {
  return String(text || '').toLowerCase().match(/[a-z']+/g) || [];
}

function stddev(arr) {
  if (!arr.length) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

/**
 * Heuristic humanity score 0–100. Higher = more human-feeling.
 * Returns score + per-axis evidence so the user can see WHY.
 */
export function humanityScore(text) {
  const t = String(text || '');
  const sentences = tokenizeSentences(t);
  const words = tokenizeWords(t);
  if (words.length < 6) {
    return {
      score: 50,
      tier: 'undecidable',
      verdict: 'Too short to score',
      evidence: [],
      axes: {},
    };
  }

  const lengths = sentences.map((s) => tokenizeWords(s).length);
  const cadenceStd = stddev(lengths);
  const cadenceScore = clamp01(cadenceStd / 8); // human prose varies; AI is uniform

  const aiHits = AI_BOILERPLATE.reduce((acc, rx) => acc + (rx.test(t) ? 1 : 0), 0);
  const aiScore = clamp01(aiHits / 3);

  const candidHits = (
    (HEDGE_HUMAN.test(t) ? 1 : 0)
    + (FILLER.test(t) ? 1 : 0)
    + (CANDID.test(t) ? 1 : 0)
  );
  const candidScore = clamp01(candidHits / 3);

  const contractionHits = (t.match(CONTRACTIONS) || []).length;
  const contractionScore = clamp01(contractionHits / 4);

  // Typo / casing irregularity proxy: lowercase-start sentences,
  // double spaces, repeated punctuation
  const lowerStarts = sentences.filter((s) => /^[a-z]/.test(s.trim())).length;
  const repeatPunct = (t.match(/!!|\?\?|\.{3,}/g) || []).length;
  const irregularityScore = clamp01((lowerStarts + repeatPunct) / 4);

  const human = (
    0.30 * cadenceScore
    + 0.25 * candidScore
    + 0.20 * contractionScore
    + 0.15 * irregularityScore
    + 0.10 * (1 - aiScore) // boilerplate suppresses humanity
  );
  const polished = (
    0.55 * aiScore
    + 0.20 * (1 - cadenceScore)
    + 0.15 * (1 - candidScore)
    + 0.10 * (1 - contractionScore)
  );

  const raw = 0.5 + (human - polished) * 0.6;
  const score = Math.round(clamp01(raw) * 100);

  const tier = (
    score >= 80 ? 'unmistakably human'
      : score >= 65 ? 'reads human'
        : score >= 45 ? 'mixed signals'
          : score >= 25 ? 'leans polished'
            : 'AI-perfect'
  );

  const evidence = [];
  if (aiHits > 0) evidence.push({ axis: 'boilerplate', hits: aiHits, note: 'AI-flavored phrasing detected' });
  if (candidHits > 0) evidence.push({ axis: 'candid', hits: candidHits, note: 'hedges / fillers / asides' });
  if (contractionHits > 0) evidence.push({ axis: 'contractions', hits: contractionHits, note: 'casual contractions' });
  if (cadenceStd >= 5) evidence.push({ axis: 'cadence', hits: Math.round(cadenceStd), note: 'varied sentence length' });
  if (lowerStarts + repeatPunct > 0) {
    evidence.push({ axis: 'irregularities', hits: lowerStarts + repeatPunct, note: 'lowercase starts / repeated punct' });
  }

  return {
    score,
    tier,
    verdict: tier,
    evidence,
    axes: {
      cadence: Math.round(cadenceScore * 100),
      candid: Math.round(candidScore * 100),
      contractions: Math.round(contractionScore * 100),
      irregularity: Math.round(irregularityScore * 100),
      boilerplate: Math.round(aiScore * 100),
    },
  };
}

/* ---------------------------- share helpers --------------------------- */

export function manifestToShareString(manifest) {
  return JSON.stringify(manifest);
}

export function tryParseManifest(str) {
  try {
    const obj = JSON.parse(String(str || ''));
    if (obj && obj.v === 'brainsnn-prov/1') return obj;
  } catch { /* noop */ }
  return null;
}
