import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  activePackets,
  breakdownByTechnique,
  buildPacketSchedule,
  DEFAULT_ROUTE,
  GUARD_THRESHOLD,
  interventionsAtTick,
  MAX_PACKETS,
  packetProgress,
  packetSegment,
  packetsForTechnique,
  resolvePacket,
  resolvePackets,
  ROUTES,
  routeForTechnique,
  scorePackets,
  MIN_WAVES,
  MAX_WAVES,
  waveCountFor,
  TECHNIQUE_ROUTES,
} from './brainGame3d.js';
import { INTERVENTIONS } from './brainGame.js';
import { PATHWAYS, REGION_MAP } from '../brain3d/brainRegions.js';
import { TECHNIQUES } from '../../lib/persuasionTechniques.js';

const SAMPLE = [
  { id: 'appeal-to-fear', label: 'Appeal to fear', published: 'Appeal to Fear/Prejudice', confidence: 80, matches: ['danger'] },
  { id: 'bandwagon', label: 'Bandwagon', published: 'Bandwagon, Appeal to Popularity', confidence: 60, matches: ['everyone is'] },
  { id: 'doubt', label: 'Casting doubt', published: 'Doubt', confidence: 50, matches: ['wake up'] },
];

function schedule(overrides = {}) {
  return buildPacketSchedule({ techniques: SAMPLE, seed: 'test-seed', durationTicks: 300, ...overrides });
}

describe('routes', () => {
  it('only names pathways that exist in the brain graph', () => {
    const known = new Set(PATHWAYS.map((pathway) => pathway.id));
    for (const route of Object.values(ROUTES)) {
      for (const pathwayId of route.path) expect(known.has(pathwayId)).toBe(true);
    }
  });

  it('only names regions that exist', () => {
    for (const route of Object.values(ROUTES)) {
      for (const code of route.regions) expect(Boolean(REGION_MAP[code])).toBe(true);
    }
  });

  // Every route must be answerable with the five interventions the game already
  // has. A route with no counter would be an unwinnable attack.
  it('gives every route at least one counter among the existing interventions', () => {
    const cuts = INTERVENTIONS.filter((choice) => choice.kind === 'cut').map((choice) => choice.target);
    const lesions = INTERVENTIONS.filter((choice) => choice.kind === 'lesion').map((choice) => choice.target);
    const stimuli = INTERVENTIONS.filter((choice) => choice.kind === 'stimulus').map((choice) => choice.target);
    for (const route of Object.values(ROUTES)) {
      const byCut = route.path.some((pathwayId) => cuts.includes(pathwayId));
      const byLesion = route.regions.some((code) => lesions.includes(code));
      const byGuard = route.guard && stimuli.includes(route.guard);
      expect(Boolean(byCut || byLesion || byGuard)).toBe(true);
    }
  });

  it('routes every technique the detector can emit', () => {
    for (const technique of TECHNIQUES) {
      expect(Boolean(routeForTechnique(technique.id))).toBe(true);
    }
  });

  it('falls back to a real route for an unknown technique id', () => {
    expect(routeForTechnique('not-a-technique').id).toBe(DEFAULT_ROUTE);
  });

  it('maps only known technique ids', () => {
    const known = new Set(TECHNIQUES.map((technique) => technique.id));
    for (const id of Object.keys(TECHNIQUE_ROUTES)) expect(known.has(id)).toBe(true);
  });
});

describe('buildPacketSchedule', () => {
  it('is deterministic for a seed', () => {
    expect(schedule()).toEqual(schedule());
  });

  it('changes with the seed', () => {
    const a = schedule();
    const b = schedule({ seed: 'other-seed' });
    expect(a.map((p) => p.spawnTick).join()).not.toBe(b.map((p) => p.spawnTick).join());
  });

  it('returns nothing for no techniques', () => {
    expect(schedule({ techniques: [] })).toHaveLength(0);
  });

  it('sorts by arrival', () => {
    const packets = schedule();
    for (let i = 1; i < packets.length; i += 1) {
      expect(packets[i].landTick).toBeGreaterThanOrEqual(packets[i - 1].landTick);
    }
  });

  // A packet landing after the final tick could never be scored, so the
  // schedule has to leave room for the longest possible flight.
  it('lands every packet before the run ends', () => {
    for (const duration of [220, 300]) {
      for (const packet of schedule({ durationTicks: duration })) {
        expect(packet.landTick).toBeLessThanOrEqual(duration);
      }
    }
  });

  it('gives the player a moment before the first arrival', () => {
    for (const packet of schedule()) expect(packet.spawnTick).toBeGreaterThan(0);
  });

  it('caps total packets so a pathological input cannot flood the scene', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ ...SAMPLE[0], id: `t${index}`, confidence: 100 }));
    expect(schedule({ techniques: many }).length).toBeLessThanOrEqual(MAX_PACKETS);
  });

  it('scales packet count with confidence, but shallowly', () => {
    expect(packetsForTechnique({ confidence: 10 })).toBeGreaterThan(0);
    expect(packetsForTechnique({ confidence: 100 })).toBeLessThanOrEqual(4);
    expect(packetsForTechnique({ confidence: 100 })).toBeGreaterThan(packetsForTechnique({ confidence: 10 }));
  });

  it('carries the triggering phrase so a packet can show real words', () => {
    expect(schedule()[0].phrase.length).toBeGreaterThan(0);
  });
});

// Spreading packets evenly across the run left only two in flight at a time and
// read as an empty board. These pin the wave structure that fixed it.
describe('wave pacing', () => {
  it('scales wave count with volume, within bounds', () => {
    expect(waveCountFor(1)).toBe(MIN_WAVES);
    expect(waveCountFor(1000)).toBe(MAX_WAVES);
    expect(waveCountFor(12)).toBeGreaterThanOrEqual(MIN_WAVES);
    expect(waveCountFor(12)).toBeLessThanOrEqual(MAX_WAVES);
  });

  it('assigns every packet to a wave inside the planned range', () => {
    const packets = schedule();
    const waves = waveCountFor(packets.length);
    for (const packet of packets) {
      expect(packet.wave).toBeGreaterThanOrEqual(0);
      expect(packet.wave).toBeLessThan(waves);
    }
  });

  it('puts several packets in the air at once', () => {
    const packets = schedule();
    let peak = 0;
    for (let tick = 0; tick <= 300; tick += 2) {
      peak = Math.max(peak, activePackets(packets, tick).length);
    }
    expect(peak).toBeGreaterThan(2);
  });

  it('mixes routes within a wave so a surge needs more than one answer', () => {
    // Round-robin dealing is what produces this; a wave of one route would be
    // answerable with a single cut.
    const mixed = buildPacketSchedule({
      techniques: SAMPLE,
      seed: 'mix',
      durationTicks: 300,
    });
    const routesInWaveZero = new Set(mixed.filter((packet) => packet.wave === 0).map((packet) => packet.route));
    expect(routesInWaveZero.size).toBeGreaterThan(1);
  });
});

describe('interventionsAtTick', () => {
  const log = [{ tick: 10, id: 'cut-ctx-amy' }, { tick: 40, id: 'lesion-amy' }];

  it('applies only what has happened by that tick', () => {
    expect(interventionsAtTick(log, 5, INTERVENTIONS).cuts).toHaveLength(0);
    expect(interventionsAtTick(log, 10, INTERVENTIONS).cuts).toEqual(['CTX-AMY']);
    expect(interventionsAtTick(log, 50, INTERVENTIONS).lesions).toEqual(['AMY']);
  });

  it('ignores unknown intervention ids', () => {
    const state = interventionsAtTick([{ tick: 1, id: 'nope' }], 100, INTERVENTIONS);
    expect(state.cuts).toHaveLength(0);
    expect(state.lesions).toHaveLength(0);
  });
});

describe('resolvePacket', () => {
  const threat = schedule().find((packet) => packet.route === 'threat');
  const memory = schedule().find((packet) => packet.route === 'memory');

  it('blocks on a cut pathway', () => {
    expect(resolvePacket(threat, { cuts: ['CTX-AMY'] }).by).toBe('cut');
  });

  it('blocks on a lesioned region', () => {
    expect(resolvePacket(threat, { lesions: ['AMY'] }).by).toBe('lesion');
  });

  it('blocks when the route guard is stimulated', () => {
    expect(resolvePacket(memory, { stimuli: { CBL: GUARD_THRESHOLD } }).by).toBe('guard');
  });

  it('does not block on a stimulus below the guard threshold', () => {
    expect(resolvePacket(memory, { stimuli: { CBL: GUARD_THRESHOLD - 0.01 } }).blocked).toBe(false);
  });

  it('does not block on an unrelated intervention', () => {
    expect(resolvePacket(memory, { cuts: ['AMY-BG'], lesions: ['AMY'] }).blocked).toBe(false);
  });

  it('lets everything through against no interventions', () => {
    expect(resolvePacket(threat, {}).blocked).toBe(false);
  });
});

describe('resolvePackets', () => {
  const packets = schedule();

  it('is a pure function of packets and log', () => {
    const log = [{ tick: 5, id: 'lesion-amy' }];
    expect(resolvePackets({ packets, log, interventions: INTERVENTIONS }))
      .toEqual(resolvePackets({ packets, log, interventions: INTERVENTIONS }));
  });

  it('lets everything land when the player does nothing', () => {
    const result = resolvePackets({ packets, log: [], interventions: INTERVENTIONS });
    expect(result.blocked).toBe(0);
    expect(result.containment).toBe(0);
    expect(result.landed).toBe(packets.length);
  });

  it('seals the run when every counter is played early', () => {
    const log = INTERVENTIONS.map((choice, index) => ({ tick: 1 + index, id: choice.id }));
    expect(resolvePackets({ packets, log, interventions: INTERVENTIONS }).containment).toBe(100);
  });

  // Timing is the skill: the same interventions played late save far less.
  it('rewards intervening early over intervening late', () => {
    const early = INTERVENTIONS.map((choice, index) => ({ tick: 1 + index, id: choice.id }));
    const late = INTERVENTIONS.map((choice, index) => ({ tick: 250 + index, id: choice.id }));
    const earlyResult = resolvePackets({ packets, log: early, interventions: INTERVENTIONS });
    const lateResult = resolvePackets({ packets, log: late, interventions: INTERVENTIONS });
    expect(earlyResult.containment).toBeGreaterThan(lateResult.containment);
  });

  it('only resolves packets that have landed by untilTick', () => {
    const partial = resolvePackets({ packets, log: [], interventions: INTERVENTIONS, untilTick: 0 });
    expect(partial.resolved).toBe(0);
    expect(partial.containment).toBe(100);
  });

  it('keeps containment inside 0-100', () => {
    for (const log of [[], [{ tick: 1, id: 'lesion-amy' }]]) {
      const result = resolvePackets({ packets, log, interventions: INTERVENTIONS });
      expect(result.containment).toBeGreaterThanOrEqual(0);
      expect(result.containment).toBeLessThanOrEqual(100);
    }
  });
});

describe('rendering helpers stay out of scoring', () => {
  const packet = schedule()[0];

  it('reports progress from 0 to 1 across the flight', () => {
    expect(packetProgress(packet, packet.spawnTick)).toBe(0);
    expect(packetProgress(packet, packet.landTick)).toBe(1);
    expect(packetProgress(packet, packet.spawnTick - 10)).toBe(0);
    expect(packetProgress(packet, packet.landTick + 10)).toBe(1);
  });

  it('accepts fractional ticks so motion can interpolate', () => {
    const mid = packet.spawnTick + packet.travelTicks / 2;
    const progress = packetProgress(packet, mid + 0.5);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
  });

  it('walks the route leg by leg', () => {
    const first = packetSegment(packet, packet.spawnTick + 0.1);
    const last = packetSegment(packet, packet.landTick - 0.1);
    expect(first.pathwayId).toBe(packet.path[0]);
    expect(last.pathwayId).toBe(packet.path[packet.path.length - 1]);
  });

  it('lists only packets currently in flight', () => {
    const packets = schedule();
    const early = activePackets(packets, 0);
    expect(early).toHaveLength(0);
    const mid = activePackets(packets, 120);
    for (const entry of mid) {
      expect(entry.spawnTick).toBeLessThanOrEqual(120);
      expect(entry.landTick).toBeGreaterThan(120);
    }
  });
});

describe('breakdownByTechnique', () => {
  it('accounts for every packet exactly once', () => {
    const packets = schedule();
    const resolution = resolvePackets({ packets, log: [], interventions: INTERVENTIONS });
    const rows = breakdownByTechnique({ packets, resolution });
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(packets.length);
    expect(rows.reduce((sum, row) => sum + row.landed, 0)).toBe(resolution.landed);
  });

  it('puts what got through first', () => {
    const packets = schedule();
    const resolution = resolvePackets({ packets, log: [{ tick: 1, id: 'lesion-amy' }], interventions: INTERVENTIONS });
    const rows = breakdownByTechnique({ packets, resolution });
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].landed).toBeLessThanOrEqual(rows[i - 1].landed);
  });
});

describe('scorePackets', () => {
  it('calls a clean board sealed', () => {
    expect(scorePackets({ resolved: 4, blocked: 4, containment: 100, leak: 0 }).grade).toBe('sealed');
  });

  it('calls a total failure breached', () => {
    expect(scorePackets({ resolved: 4, blocked: 0, containment: 0, leak: 3 }).grade).toBe('breached');
  });

  it('treats a level with nothing to stop as clean rather than failed', () => {
    expect(scorePackets(null).containment).toBe(100);
    expect(scorePackets({ resolved: 0 }).containment).toBe(100);
  });
});
