// Route receipt: why a route went where it went, and which robots could make the same trip.
// Everything here is read off the same reviewed grid routeWorld used: the straight line and what stands in it, the
// tightest clearance along the route, and the same goal tried with every illustrative envelope at the same margin.
// A receipt explains a simulation on a map. It does not certify a real robot.
import {ROBOTS, normalizeWorld, routeWorld, blockers, label} from './core.mjs';

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

/** The things standing on the straight line from start to goal at the robot's radius, each once, in order met. */
export function straightLine(world, robot, goal) {
  const w = normalizeWorld(world), radius = Math.hypot(robot.width, robot.depth) / 2 + robot.margin;
  const dx = goal.x - w.start.x, dz = goal.z - w.start.z, length = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(length / 0.05));
  const seen = new Set(), met = [];
  for (let i = 0; i <= steps; i++) {
    const p = { x: w.start.x + dx * i / steps, z: w.start.z + dz * i / steps };
    for (const b of blockers(w, p, radius)) {
      const key = b.kind === 'object' ? `object:${b.id}` : b.kind;
      if (!seen.has(key)) { seen.add(key); met.push({ ...b, atMetres: r2(length * i / steps) }); }
    }
  }
  return { length, blockers: met };
}

/** The narrowest clearance along a route: the largest radius still clear at the tightest point (walls, unknown and
 *  objects alike), capped at `cap`. */
export function tightestClearance(world, route, cap = 3) {
  const w = normalizeWorld(world); let best = null;
  for (const p of route) {
    let lo = 0, hi = cap;
    if (blockers(w, p, hi).length === 0) { if (!best || hi > best.metres) {} ; if (!best) best = { metres: hi, at: { x: p.x, z: p.z }, against: null, capped: true }; continue; }
    for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (blockers(w, p, mid).length) hi = mid; else lo = mid; }
    const against = blockers(w, p, hi)[0] || null;
    if (!best || lo < best.metres) best = { metres: r2(lo), at: { x: r2(p.x), z: r2(p.z) }, against: against ? (against.kind === 'object' ? label(against.name, 'Obstacle') : against.kind === 'unknown' ? 'unknown space' : 'the wall') : null, capped: false };
  }
  return best;
}

/** Every illustrative envelope sent to the same goal with the same margin: distance, or the planner's own reason. */
export function fleetFit(world, goal, margin = 0.1, robots = ROBOTS) {
  return Object.entries(robots).map(([id, r]) => {
    const robot = { ...r, margin };
    try { const route = routeWorld(world, robot, goal); return { id, name: r.name, fits: true, distance: r1(route.distance), travelSeconds: Math.round(route.travelSeconds), radius: r2(Math.hypot(r.width, r.depth) / 2 + margin) }; }
    catch (error) { return { id, name: r.name, fits: false, reason: error.message, radius: r2(Math.hypot(r.width, r.depth) / 2 + margin) }; }
  });
}

/** The receipt for a routed goal. */
export function routeReceipt(world, robot, goal, route) {
  const straight = straightLine(world, robot, goal), tight = tightestClearance(world, route.route), fleet = fleetFit(world, goal, robot.margin);
  const detour = route.distance - straight.length;
  const why = straight.blockers.filter(b => b.kind !== 'wall');
  const whyText = why.length ? `The straight line (${r1(straight.length)} m) runs through ${why.map(b => b.kind === 'object' ? label(b.name, 'an obstacle') : 'unknown space').join(', ')}; the route goes round in ${r1(route.distance)} m (+${r1(Math.max(0, detour))} m).` : `Nothing stands on the straight line; the route follows the grid in ${r1(route.distance)} m (+${r1(Math.max(0, detour))} m over ${r1(straight.length)} m).`;
  const tightText = tight ? (tight.capped ? `At least ${tight.metres.toFixed(1)} m clear everywhere along it.` : `Tightest point: ${tight.metres.toFixed(2)} m from ${tight.against} at (${tight.at.x}, ${tight.at.z}).`) : '';
  const cannot = fleet.filter(f => !f.fits);
  return { schema: 'brainsnn.route-receipt.v1', goal: { x: r2(goal.x), z: r2(goal.z) }, robot: { width: robot.width, depth: robot.depth, margin: robot.margin, radius: r2(Math.hypot(robot.width, robot.depth) / 2 + robot.margin) },
    distance: r1(route.distance), straightLine: r1(straight.length), detourMetres: r1(Math.max(0, detour)), blockers: straight.blockers, tightest: tight, fleet,
    text: `${whyText} ${tightText}`.trim(), fleetText: cannot.length ? `${cannot.map(f => f.name).join(', ')} cannot make this trip on this map; ${fleet.length - cannot.length} of ${fleet.length} envelopes can.` : `All ${fleet.length} envelopes can make this trip.`,
    policyExecuted: false, safetyCertified: false, limitations: ['Circumscribed-circle footprints; no dynamics, no turning radius.', 'Same grid and margin for every envelope; appearance is not collision geometry.'] };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** The card under "Route to a spot". */
export function receiptCard(receipt) {
  if (!receipt) return '';
  const rows = receipt.fleet.map(f => `<li class="${f.fits ? 'fits' : 'no-fit'}"><span>${esc(f.name)} · r ${f.radius.toFixed(2)} m</span><span>${f.fits ? `${f.distance.toFixed(1)} m` : 'cannot'}</span></li>`).join('');
  return `<div class="route-receipt" role="note"><h4>Why this route</h4><p>${esc(receipt.text)}</p><p class="micro">${esc(receipt.fleetText)}</p><ul class="fleet-fit">${rows}</ul><p class="micro">Same goal, same margin, every envelope. A simulation on the reviewed map; no robot was moved.</p></div>`;
}
