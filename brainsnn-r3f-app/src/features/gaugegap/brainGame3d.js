// Packets: the persuasion techniques found in real text, made into things that
// travel the brain's axons and have to be stopped.
//
// WHY PACKETS ARE DERIVED RATHER THAN SIMULATED
//
// A run is verifiable because runProof.js can replay `(seed, [{tick, id}])`
// through stepBrain and recompute the score. If packets moved under their own
// frame-rate-dependent physics, two replays of the same log would disagree and
// every proof would fail. So a packet is never integrated: it is scheduled up
// front from a seeded RNG, and everything that affects scoring is resolved in
// the LOGICAL TICK domain.
//
// The renderer is free to interpolate a packet's position between ticks for
// smoothness — that is presentation, and nothing reads it back. The rule is:
//
//     visuals may interpolate; scoring never does.
//
// Everything in this file is pure and three-free so the bare-Node test runner
// can execute it.
import { createRng } from '../../lib/rng.js';
import { applyIntervention } from './brainGame.js';

/**
 * Where a technique attacks.
 *
 * These are not decorative. Each route ends somewhere the brain model actually
 * cares about, and each has a counter among the five interventions the game
 * already has — so adding packets needs no new player verbs.
 *
 *  threat   the classic hijack: meaning feeds salience feeds the action gate.
 *           Counter by cutting either link or taking the amygdala offline.
 *  memory   familiarity attacks — they do not frighten you, they make a claim
 *           feel already-agreed. Counter by steadying the pattern (CBL).
 *  judgment attacks on reasoning itself. Counter by driving judgment (PFC).
 */
export const ROUTES = Object.freeze({
  threat: {
    id: 'threat',
    label: 'Threat loop',
    path: ['THL-CTX', 'CTX-AMY', 'AMY-BG'],
    regions: ['THL', 'CTX', 'AMY', 'BG'],
    guard: null, // stopped by cuts or by lesioning AMY, not by a stimulus
    blurb: 'Meaning feeds salience feeds the action gate.',
  },
  memory: {
    id: 'memory',
    label: 'Familiarity',
    path: ['THL-CTX', 'CTX-HPC'],
    regions: ['THL', 'CTX', 'HPC'],
    guard: 'CBL',
    blurb: 'Makes a claim feel already agreed rather than frightening.',
  },
  judgment: {
    id: 'judgment',
    label: 'Reasoning',
    path: ['THL-CTX', 'CTX-PFC'],
    regions: ['THL', 'CTX', 'PFC'],
    guard: 'PFC',
    blurb: 'Attacks the capacity to evaluate rather than the feelings.',
  },
});

/**
 * Which route each detected technique takes.
 *
 * Chosen to match what the technique actually does to a reader, so the game
 * teaches the taxonomy rather than decorating it: fear and ultimatums drive the
 * threat loop, bandwagon and authority work through familiarity, and the ones
 * that shut down thinking go straight at judgment.
 */
export const TECHNIQUE_ROUTES = Object.freeze({
  'appeal-to-fear': 'threat',
  'guilt-appeal': 'threat',
  'false-dilemma': 'threat',
  'appeal-to-time': 'threat',
  'loaded-language': 'threat',
  'prize-lure': 'threat',
  bandwagon: 'memory',
  'appeal-to-authority': 'memory',
  repetition: 'memory',
  'name-calling': 'memory',
  doubt: 'judgment',
  obfuscation: 'judgment',
  'thought-terminating': 'judgment',
  exaggeration: 'judgment',
});

export const DEFAULT_ROUTE = 'threat';

/** A stimulus at or above this level counts as a route's guard being up. */
export const GUARD_THRESHOLD = 0.15;

// Packets arrive in waves rather than as a uniform drizzle.
//
// Spreading them evenly across the run reads as an empty board: with a dozen
// packets over 300 ticks only two are ever in flight, so nothing feels like
// pressure. Waves give the run a shape — a surge you have to answer, then a lull
// to see whether the answer worked.
export const FIRST_SPAWN_TICK = 16;
export const TRAVEL_TICKS_MIN = 44;
export const TRAVEL_TICKS_MAX = 76;
export const MAX_PACKETS = 90;
export const PACKETS_PER_WAVE = 4;
export const MIN_WAVES = 2;
export const MAX_WAVES = 5;
// How much a packet may drift from its wave's arrival, so a wave lands as a
// cluster rather than a single instant.
export const WAVE_JITTER = 9;

export function waveCountFor(packetCount) {
  return Math.max(MIN_WAVES, Math.min(MAX_WAVES, Math.ceil(packetCount / PACKETS_PER_WAVE)));
}

export function routeForTechnique(techniqueId) {
  return ROUTES[TECHNIQUE_ROUTES[techniqueId] || DEFAULT_ROUTE] || ROUTES[DEFAULT_ROUTE];
}

/**
 * How many packets a technique is worth. Confidence is the detector's own
 * saturating measure, so this stays deliberately shallow — a technique detected
 * at 90% is not nine times the threat of one at 10%.
 */
export function packetsForTechnique(technique) {
  const confidence = Math.max(0, Math.min(100, Number(technique?.confidence) || 0));
  return Math.max(1, Math.round(1 + (confidence / 100) * 3));
}

/**
 * Build the wave schedule for a level. Pure and seeded: the same techniques and
 * the same seed always produce byte-identical packets, which is what lets a run
 * proof replay.
 */
export function buildPacketSchedule({ techniques = [], seed = 'defend-01', durationTicks = 300 } = {}) {
  const rng = createRng(`${seed}:packets`);
  const packets = [];

  // Plan the waves first so packets can be dealt into them. The last wave has
  // to leave room for the longest possible flight: a packet landing after the
  // final tick could never be scored.
  const planned = [];
  for (const technique of techniques) {
    const count = packetsForTechnique(technique);
    for (let index = 0; index < count && planned.length < MAX_PACKETS; index += 1) {
      planned.push({ technique, index });
    }
  }
  const waves = waveCountFor(planned.length);
  const lastSpawn = Math.max(FIRST_SPAWN_TICK, durationTicks - TRAVEL_TICKS_MAX - WAVE_JITTER - 4);
  const waveGap = waves > 1 ? (lastSpawn - FIRST_SPAWN_TICK) / (waves - 1) : 0;

  for (let slot = 0; slot < planned.length; slot += 1) {
    const { technique, index } = planned[slot];
    const route = routeForTechnique(technique.id);
    // Deal round-robin so a wave mixes routes: a surge of three different
    // attacks needs three different answers, which is the interesting case.
    const wave = slot % waves;
    const jitter = Math.round((rng() * 2 - 1) * WAVE_JITTER);
    const spawnTick = Math.max(
      FIRST_SPAWN_TICK,
      Math.min(lastSpawn + WAVE_JITTER, Math.round(FIRST_SPAWN_TICK + wave * waveGap + jitter)),
    );
    const travelTicks = Math.round(TRAVEL_TICKS_MIN + rng() * (TRAVEL_TICKS_MAX - TRAVEL_TICKS_MIN));
    packets.push({
      wave,
      id: `${technique.id}-${index}`,
      techniqueId: technique.id,
      label: technique.label || technique.id,
      published: technique.published || '',
      // The literal phrase that triggered the detection, so a packet can show
      // the player the actual words rather than an abstract category.
      phrase: (technique.matches && technique.matches[0]) || '',
      confidence: Math.max(0, Math.min(100, Number(technique.confidence) || 0)),
      route: route.id,
      path: route.path,
      regions: route.regions,
      guard: route.guard,
      spawnTick,
      travelTicks,
      landTick: spawnTick + travelTicks,
      impact: Math.max(0.05, Math.min(1, (Number(technique.confidence) || 0) / 100)),
    });
  }

  // Sorted by arrival so the renderer and the resolver agree on ordering, and
  // so a schedule is comparable between runs.
  packets.sort((a, b) => a.landTick - b.landTick || a.id.localeCompare(b.id));
  return packets;
}

/**
 * Rebuild the intervention state as it stood at a given tick by replaying the
 * log. This is the same accumulation runProof uses, so packet resolution and
 * score replay can never drift apart.
 */
export function interventionsAtTick(log = [], tick, interventions = []) {
  const byId = new Map(interventions.map((choice) => [choice.id, choice]));
  let state = { lesions: [], cuts: [], stimuli: {} };
  for (const entry of log) {
    if (entry.tick > tick) break;
    const choice = byId.get(entry.id);
    if (choice) state = applyIntervention(state, choice);
  }
  return state;
}

/**
 * Did this packet get stopped? Resolved entirely from the intervention state at
 * the tick it arrives — no frame data, no wall clock, no randomness.
 *
 * Three ways to stop one, matching the three routes:
 *   cut     any pathway on its path is severed
 *   lesion  any region on its path is offline
 *   guard   its route's guard region is being stimulated
 */
export function resolvePacket(packet, state) {
  const cuts = state?.cuts || [];
  const lesions = state?.lesions || [];
  const stimuli = state?.stimuli || {};

  const cutOn = packet.path.find((pathwayId) => cuts.includes(pathwayId));
  if (cutOn) return { blocked: true, by: 'cut', detail: cutOn };

  const lesionOn = packet.regions.find((code) => lesions.includes(code));
  if (lesionOn) return { blocked: true, by: 'lesion', detail: lesionOn };

  if (packet.guard && (stimuli[packet.guard] || 0) >= GUARD_THRESHOLD) {
    return { blocked: true, by: 'guard', detail: packet.guard };
  }

  return { blocked: false, by: null, detail: null };
}

/**
 * Resolve a whole schedule against an intervention log.
 * Pure function of (packets, log, interventions) — replayable and testable.
 */
export function resolvePackets({ packets = [], log = [], interventions = [], untilTick = Infinity } = {}) {
  const results = [];
  let blocked = 0;
  let landed = 0;
  let leak = 0;

  for (const packet of packets) {
    if (packet.landTick > untilTick) continue;
    const state = interventionsAtTick(log, packet.landTick, interventions);
    const outcome = resolvePacket(packet, state);
    if (outcome.blocked) blocked += 1;
    else {
      landed += 1;
      leak += packet.impact;
    }
    results.push({ ...outcome, id: packet.id, techniqueId: packet.techniqueId, landTick: packet.landTick });
  }

  const resolved = blocked + landed;
  return {
    results,
    blocked,
    landed,
    resolved,
    leak: Math.round(leak * 100) / 100,
    containment: resolved ? Math.round((blocked / resolved) * 100) : 100,
  };
}

/**
 * Per-technique breakdown for the post-run panel: which of the things actually
 * found in the text got through.
 */
export function breakdownByTechnique({ packets = [], resolution = null } = {}) {
  const byId = new Map();
  const outcomes = new Map((resolution?.results || []).map((row) => [row.id, row]));
  for (const packet of packets) {
    const entry = byId.get(packet.techniqueId) || {
      techniqueId: packet.techniqueId,
      label: packet.label,
      published: packet.published,
      phrase: packet.phrase,
      route: packet.route,
      total: 0,
      blocked: 0,
      landed: 0,
    };
    entry.total += 1;
    const outcome = outcomes.get(packet.id);
    if (outcome) {
      if (outcome.blocked) entry.blocked += 1;
      else entry.landed += 1;
    }
    byId.set(packet.techniqueId, entry);
  }
  // `pending` matters for the live panel: mid-run, "0 of 3 stopped" reads as
  // failure when in fact none of the three has arrived yet.
  for (const entry of byId.values()) {
    entry.pending = entry.total - entry.blocked - entry.landed;
    entry.resolved = entry.blocked + entry.landed;
  }
  return [...byId.values()].sort((a, b) => b.landed - a.landed || b.total - a.total);
}

/**
 * Where a packet is at a given moment, for rendering only.
 * `tickFloat` may be fractional so motion stays smooth between logical ticks;
 * nothing derived from this value is allowed to reach a score.
 */
export function packetProgress(packet, tickFloat) {
  if (tickFloat <= packet.spawnTick) return 0;
  if (tickFloat >= packet.landTick) return 1;
  return (tickFloat - packet.spawnTick) / Math.max(1, packet.travelTicks);
}

/** Which leg of the route a packet is on, and how far along that leg. */
export function packetSegment(packet, tickFloat) {
  const progress = packetProgress(packet, tickFloat);
  const legs = packet.path.length;
  const scaled = progress * legs;
  const index = Math.min(legs - 1, Math.floor(scaled));
  return { pathwayId: packet.path[index], legProgress: scaled - index, progress };
}

/** Packets that exist on screen at this moment. */
export function activePackets(packets, tickFloat) {
  return packets.filter((packet) => tickFloat >= packet.spawnTick && tickFloat < packet.landTick);
}

/**
 * The containment axis, kept separate from evaluateRun's three axes so the
 * existing scoring and its run proofs stay untouched and v1 proofs keep
 * verifying. A 3D run reports both.
 */
export function scorePackets(resolution) {
  if (!resolution || !resolution.resolved) return { containment: 100, leak: 0, grade: 'clean' };
  const containment = resolution.containment;
  let grade = 'breached';
  if (containment >= 90) grade = 'sealed';
  else if (containment >= 70) grade = 'holding';
  else if (containment >= 40) grade = 'leaking';
  return { containment, leak: resolution.leak, grade };
}
