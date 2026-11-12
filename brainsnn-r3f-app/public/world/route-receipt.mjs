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

/** An aerial envelope is a gate, not a route: this map has floor objects with heights but no ceiling and nothing about
 *  what hangs above them, so a drone cannot be planned honestly here. Says what is known and what is missing. */
export function aerialGate(world) {
  const w = normalizeWorld(world), tallest = w.objects.reduce((m, o) => Math.max(m, o.h || 0), 0);
  return { id: 'aerial', name: 'Aerial (drone)', fits: false, planned: false, radius: null, tallestObjectMetres: r2(tallest),
    reason: `Not planned: the map has object heights (tallest ${r2(tallest)} m) but no ceiling and no overhead obstacles. Add an overhead model before routing anything that flies.` };
}

/** The envelopes that fit, sent together from the map's start: each leaves when it can without coming within the sum
 *  of two radii of anyone already on the floor. Priority is the order given (first listed leaves first); the delay is
 *  the smallest whole second that keeps every sampled moment clear. A schedule on the map, not a traffic controller. */
export function fleetSchedule(world, goal, margin = 0.1, robots = ROBOTS, { step = 0.5, maxDelay = 600, dwell = 5 } = {}) {
  const w = normalizeWorld(world), agents = [], skipped = [];
  // With a fleet on the map, each robot leaves from its own start; otherwise every envelope leaves from the map's start.
  const members = w.fleet?.length ? w.fleet.map(f => ({ id: f.id, name: f.name, envelope: robots[f.robot] || ROBOTS[f.robot], start: f.start })) : Object.entries(robots).map(([id, r]) => ({ id, name: r.name, envelope: r, start: w.start }));
  for (const m of members) {
    const robot = { ...m.envelope, margin };
    try { const route = routeWorld({ ...w, start: m.start }, robot, goal); agents.push({ id: m.id, name: m.name, start: m.start, radius: Math.hypot(robot.width, robot.depth) / 2 + margin, speed: robot.speed, route: route.route, distance: route.distance }); }
    catch (error) { skipped.push({ id: m.id, name: m.name, reason: error.message }); }
  }
  const cum = pts => { const d = [0]; for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)); return d; };
  const at = (a, t) => { // position at time t since departure; holds at the goal for `dwell` seconds, then it is off the floor (handed over)
    if (t > a.distance / a.speed + dwell) return null;
    const s = Math.min(a.distance, Math.max(0, t) * a.speed), d = a.cum; let i = 1; while (i < d.length - 1 && d[i] < s) i++;
    const f = d[i] === d[i - 1] ? 1 : (s - d[i - 1]) / (d[i] - d[i - 1]); return { x: a.route[i - 1].x + (a.route[i].x - a.route[i - 1].x) * f, z: a.route[i - 1].z + (a.route[i].z - a.route[i - 1].z) * f };
  };
  for (const a of agents) a.cum = cum(a.route);
  const waits = !!w.fleet?.length;
  function schedule(order) {
    const placed = [];
    for (const a of order) {
      let delay = 0;
      for (; delay <= maxDelay; delay += 1) {
        const horizon = delay + a.distance / a.speed + dwell; let clear = true, whileWaiting = false;  // including its own dwell at the goal
        // A fleet robot stands on its own start until it leaves, so the others must clear it from time zero. Without a
        // fleet every envelope shares the one start and is taken to queue off the floor, so it is checked from its departure.
        for (let t = waits ? 0 : delay; t <= horizon + step && clear; t += step) {
          const p = at(a, t - delay);
          for (const b of placed) { if (b.departsAt === null) continue; const q = at(b, t - b.departsAt); if (p && q && Math.hypot(p.x - q.x, p.z - q.z) < a.radius + b.radius - 1e-9) { clear = false; whileWaiting = t < delay; break; } }
        }
        if (clear) break;
        if (whileWaiting) { delay = maxDelay + 1; break; }  // hit while still standing on its start: leaving later cannot help
      }
      placed.push({ ...a, departsAt: delay > maxDelay ? null : delay, arrivesAt: delay > maxDelay ? null : Math.round(delay + a.distance / a.speed) });
    }
    return placed;
  }
  // Robots are placed in the fleet's order. One that cannot leave is usually standing where an earlier robot drives, so it
  // is moved to the front and the schedule is tried again; the attempt that leaves the fewest robots waiting is kept.
  let order = agents, best = null;
  for (let attempt = 0; attempt <= agents.length; attempt++) {
    const tried = schedule(order), stuck = tried.filter(p => p.departsAt === null);
    if (!best || stuck.length < best.stuck) best = { placed: tried, stuck: stuck.length };
    if (!stuck.length || order[0].id === stuck[0].id) break;
    order = [order.find(a => a.id === stuck[0].id), ...order.filter(a => a.id !== stuck[0].id)];
  }
  const placed = agents.map(a => best.placed.find(p => p.id === a.id));
  const last = placed.reduce((m, p) => p.arrivesAt === null ? m : Math.max(m, p.arrivesAt), 0);
  return { schema: 'brainsnn.fleet-schedule.v1', goal: { x: r2(goal.x), z: r2(goal.z) }, separation: 'sum of the two planning radii at every sampled moment', stepSeconds: step,
    agents: placed.map(p => ({ id: p.id, name: p.name, start: { x: r2(p.start.x), z: r2(p.start.z) }, radius: r2(p.radius), distance: r1(p.distance), departsAt: p.departsAt, arrivesAt: p.arrivesAt })), skipped, allArrivedAt: last, perRobotStarts: !!w.fleet?.length,
    limitations: [w.fleet?.length ? 'Each fleet robot leaves from its own start on the map, and stands there until it leaves.' : 'No fleet on the map: every envelope leaves from the map\'s single start.', `Constant speed along the grid route; an arrival holds the goal for ${dwell} s and is then off the floor (handed over).`, 'A schedule on the map, not a traffic controller; no robot was moved.'] };
}

/** The receipt for a routed goal. */
export function routeReceipt(world, robot, goal, route) {
  const straight = straightLine(world, robot, goal), tight = tightestClearance(world, route.route), fleet = [...fleetFit(world, goal, robot.margin), aerialGate(world)], schedule = fleetSchedule(world, goal, robot.margin);
  const detour = route.distance - straight.length;
  const why = straight.blockers.filter(b => b.kind !== 'wall');
  const whyText = why.length ? `The straight line (${r1(straight.length)} m) runs through ${why.map(b => b.kind === 'object' ? label(b.name, 'an obstacle') : 'unknown space').join(', ')}; the route goes round in ${r1(route.distance)} m (+${r1(Math.max(0, detour))} m).` : `Nothing stands on the straight line; the route follows the grid in ${r1(route.distance)} m (+${r1(Math.max(0, detour))} m over ${r1(straight.length)} m).`;
  const tightText = tight ? (tight.capped ? `At least ${tight.metres.toFixed(1)} m clear everywhere along it.` : `Tightest point: ${tight.metres.toFixed(2)} m from ${tight.against} at (${tight.at.x}, ${tight.at.z}).`) : '';
  const cannot = fleet.filter(f => !f.fits && f.planned !== false);
  return { schema: 'brainsnn.route-receipt.v1', goal: { x: r2(goal.x), z: r2(goal.z) }, robot: { width: robot.width, depth: robot.depth, margin: robot.margin, radius: r2(Math.hypot(robot.width, robot.depth) / 2 + robot.margin) },
    distance: r1(route.distance), straightLine: r1(straight.length), detourMetres: r1(Math.max(0, detour)), blockers: straight.blockers, tightest: tight, fleet, schedule,
    text: `${whyText} ${tightText}`.trim(), fleetText: cannot.length ? `${cannot.map(f => f.name).join(', ')} cannot make this trip on this map; ${fleet.length - 1 - cannot.length} of ${fleet.length - 1} ground envelopes can. Aerial is not planned: no overhead model.` : `All ${fleet.length - 1} ground envelopes can make this trip. Aerial is not planned: no overhead model.`,
    scheduleText: schedule.agents.length > 1 ? `Together${schedule.perRobotStarts ? ', each from its own start' : ', from the start'}: ${schedule.agents.map(a => `${a.name} leaves at ${a.departsAt === null ? '—' : a.departsAt + ' s'}`).join(', ')}; all arrived by ${schedule.allArrivedAt} s, never within two radii of each other.${schedule.skipped.length ? ` Not in the schedule: ${schedule.skipped.map(k => k.name).join(', ')}.` : ''}` : '',
    policyExecuted: false, safetyCertified: false, limitations: ['Circumscribed-circle footprints; no dynamics, no turning radius.', 'Same grid and margin for every envelope; appearance is not collision geometry.'] };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** The card under "Route to a spot". */
export function receiptCard(receipt) {
  if (!receipt) return '';
  const dep = Object.fromEntries((receipt.schedule?.agents || []).map(a => [a.id, a]));
  const rows = receipt.fleet.map(f => `<li class="${f.fits ? 'fits' : f.planned === false ? 'gated' : 'no-fit'}" title="${esc(f.fits ? '' : f.reason)}"><span>${esc(f.name)}${f.radius === null ? '' : ` · r ${f.radius.toFixed(2)} m`}</span><span>${f.fits ? `${f.distance.toFixed(1)} m${dep[f.id] && dep[f.id].departsAt !== null ? ` · leaves ${dep[f.id].departsAt} s` : ''}` : f.planned === false ? 'not planned' : 'cannot'}</span></li>`).join('');
  const members = receipt.schedule?.perRobotStarts ? `<ul class="fleet-fit">${receipt.schedule.agents.map(a => `<li class="fits"><span>${esc(a.name)} · from (${a.start.x}, ${a.start.z})</span><span>${a.distance.toFixed(1)} m · leaves ${a.departsAt === null ? '—' : a.departsAt + ' s'}</span></li>`).join('')}${receipt.schedule.skipped.map(k => `<li class="no-fit" title="${esc(k.reason)}"><span>${esc(k.name)}</span><span>cannot</span></li>`).join('')}</ul>` : '';
  return `<div class="route-receipt" role="note"><h4>Why this route</h4><p>${esc(receipt.text)}</p><p class="micro">${esc(receipt.fleetText)}</p><ul class="fleet-fit">${rows}</ul>${members ? `<h4>Your fleet</h4>${members}` : ''}${receipt.scheduleText ? `<p class="micro">${esc(receipt.scheduleText)}</p>` : ''}<p class="micro">Same goal, same margin, every envelope. A simulation on the reviewed map; no robot was moved.</p></div>`;
}
