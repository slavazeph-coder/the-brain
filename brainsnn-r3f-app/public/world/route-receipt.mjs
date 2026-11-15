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

// Times are relative to departure. Each leg stores its position at its finite end time,
// so an occupied start can extend back to the beginning of the simulation.
function trajectory(plan, occupiesStart, dwell) {
  const points = plan.route, speed = plan.robot.speed;
  const hold = (from, to, point) => ({ from, to, point, vx: 0, vz: 0 });
  const legs = occupiesStart ? [hold(-Infinity, 0, points[0])] : [];
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x, dz = points[i].z - points[i - 1].z;
    const length = Math.hypot(dx, dz), from = distance / speed;
    distance += length;
    legs.push({ from, to: distance / speed, point: points[i], vx: speed * dx / length, vz: speed * dz / length });
  }
  legs.push(hold(plan.travelSeconds, plan.travelSeconds + dwell, points.at(-1)));
  return legs;
}

// Merge the two timelines. Within an overlapping interval relative velocity is constant,
// so the closest approach is the projection onto that interval, including both endpoints.
function conflictTime(agent, departure, other, otherDeparture) {
  const radius = agent.radius + other.radius;
  let i = 0, j = 0;
  while (i < agent.legs.length && j < other.legs.length) {
    const a = agent.legs[i], b = other.legs[j];
    const endA = a.to + departure, endB = b.to + otherDeparture;
    const from = Math.max(0, a.from + departure, b.from + otherDeparture), to = Math.min(endA, endB);
    if (from <= to) {
      const dx = a.point.x + a.vx * (from - endA) - (b.point.x + b.vx * (from - endB));
      const dz = a.point.z + a.vz * (from - endA) - (b.point.z + b.vz * (from - endB));
      const vx = a.vx - b.vx, vz = a.vz - b.vz, speedSquared = vx * vx + vz * vz;
      const nearest = speedSquared ? Math.max(0, Math.min(to - from, -(dx * vx + dz * vz) / speedSquared)) : 0;
      if (Math.hypot(dx + vx * nearest, dz + vz * nearest) < radius) return from + nearest;
    }
    if (endA <= endB) i++;
    if (endB <= endA) j++;
  }
  return null;
}

function tryDepartures(order, perRobotStarts, maxDelay) {
  const departures = new Map();
  for (const agent of order) {
    for (let delay = 0; delay <= maxDelay; delay++) {
      let conflict = null;
      for (const [other, otherDeparture] of departures) {
        conflict = conflictTime(agent, delay, other, otherDeparture);
        if (conflict !== null) break;
      }
      if (conflict === null) {
        departures.set(agent, delay);
        break;
      }
      // Leaving even later cannot clear a collision that occurred while still waiting.
      if (perRobotStarts && conflict <= delay) break;
    }
    if (!departures.has(agent)) return { blocked: agent };
  }
  return { departures };
}

/** Schedule the fixed grid routes with whole-second departure delays. Only publish a complete
 *  schedule. Named robots occupy their starts from time zero. Illustrative envelopes queue off-map. */
export function fleetSchedule(world, goal, margin = 0.1, robots = ROBOTS, { step = 0.5, maxDelay = 600, dwell = 5 } = {}) {
  // Preserve the v1 replay interval. Separation is independent of the replay sampling rate.
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('The replay interval must be finite and positive.');
  if (!Number.isFinite(maxDelay) || maxDelay < 0 || !Number.isFinite(dwell) || dwell < 0) {
    throw new RangeError('Departure delay and destination dwell limits must be finite and nonnegative.');
  }
  const w = normalizeWorld(world), agents = [], skipped = [], perRobotStarts = !!w.fleet?.length;
  const members = perRobotStarts ? w.fleet.map(f => ({ id: f.id, name: f.name, envelope: robots[f.robot] || ROBOTS[f.robot], start: f.start })) : Object.entries(robots).map(([id, r]) => ({ id, name: r.name, envelope: r, start: w.start }));
  for (const m of members) {
    try {
      const plan = routeWorld({ ...w, start: m.start }, { ...m.envelope, margin }, goal);
      agents.push({ id: m.id, name: m.name, start: m.start, radius: Math.hypot(plan.robot.width, plan.robot.depth) / 2 + plan.robot.margin,
        distance: plan.distance, travelSeconds: plan.travelSeconds, legs: trajectory(plan, perRobotStarts, dwell) });
    } catch (error) { skipped.push({ id: m.id, name: m.name, reason: error.message }); }
  }

  let reason = null, departures = null;
  if (!agents.length || (perRobotStarts && skipped.length)) {
    reason = perRobotStarts ? 'A fleet member has no route from its occupied start.' : 'No envelope has a route to the goal.';
  }
  if (perRobotStarts && !reason) {
    for (const [i, a] of agents.entries()) {
      const b = agents.slice(0, i).find(b => Math.hypot(a.start.x - b.start.x, a.start.z - b.start.z) < a.radius + b.radius);
      if (b) { reason = `${b.name} and ${a.name} overlap at their occupied starts at 0 s.`; break; }
    }
  }
  if (!reason) {
    let order = agents;
    // If an earlier route is blocked by a waiting robot, try giving that robot priority.
    // This is a bounded search, so failure does not prove that every ordering is impossible.
    for (let attempt = 0; attempt <= agents.length; attempt++) {
      const result = tryDepartures(order, perRobotStarts, maxDelay);
      if (result.departures) { departures = result.departures; break; }
      if (!perRobotStarts) break;
      order = [result.blocked, ...order.filter(a => a !== result.blocked)];
    }
    if (!departures) reason = `The departure orders tried on these routes did not maintain separation within the ${maxDelay} s delay limit.`;
  }

  const scheduledAgents = agents.map(a => {
    const departsAt = departures ? departures.get(a) : null;
    return { id: a.id, name: a.name, start: a.start, radius: a.radius, distance: a.distance,
      departsAt, arrivesAt: departsAt === null ? null : departsAt + a.travelSeconds };
  });
  return { schema: 'brainsnn.fleet-schedule.v1', goal: { x: goal.x, z: goal.z }, status: departures ? 'scheduled' : 'unscheduled', reason,
    separation: departures ? 'sum of the two planning radii throughout overlapping simulated occupancy' : null,
    stepSeconds: step, dwellSeconds: dwell, maxDelaySeconds: maxDelay, agents: scheduledAgents, skipped, perRobotStarts,
    allArrivedAt: departures ? Math.ceil(Math.max(...scheduledAgents.map(a => a.arrivesAt))) : null,
    limitations: [perRobotStarts ? 'Each named robot occupies its start from time zero until departure.' : 'Illustrative envelopes wait off the map and enter the shared start at departure.',
      `Robots move at constant speed along their grid routes and occupy the goal through the end of their ${dwell} s dwell.`,
      'A simulation on the reviewed map. No robot was moved. Physical collision avoidance has not been verified.'] };
}

function describeSchedule(schedule) {
  const excluded = schedule.skipped.length ? ` No route for ${schedule.skipped.map(a => a.name).join(', ')}.` : '';
  if (schedule.status === 'unscheduled') return `No fleet schedule issued. ${schedule.reason}${excluded}`;
  const departures = schedule.agents.map(a => `${a.name} leaves at ${a.departsAt} s`).join(', ');
  return `In simulation, ${departures}. All scheduled robots arrive by ${schedule.allArrivedAt} s. ${schedule.limitations[0]} Planning radii stay separated through movement and the ${schedule.dwellSeconds} s goal dwell.${excluded}`;
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
    scheduleText: describeSchedule(schedule),
    policyExecuted: false, safetyCertified: false, limitations: ['Circumscribed-circle footprints; no dynamics, no turning radius.', 'Same grid and margin for every envelope; appearance is not collision geometry.'] };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** The card under "Route to a spot". */
export function receiptCard(receipt) {
  if (!receipt) return '';
  const dep = new Map((receipt.schedule?.perRobotStarts ? [] : receipt.schedule?.agents || []).map(a => [a.id, a.departsAt]));
  const rows = receipt.fleet.map(f => `<li class="${f.fits ? 'fits' : f.planned === false ? 'gated' : 'no-fit'}" title="${esc(f.fits ? '' : f.reason)}"><span>${esc(f.name)}${f.radius === null ? '' : ` · r ${f.radius.toFixed(2)} m`}</span><span>${f.fits ? `${f.distance.toFixed(1)} m${Number.isFinite(dep.get(f.id)) ? ` · leaves ${dep.get(f.id)} s` : ''}` : f.planned === false ? 'not planned' : 'cannot'}</span></li>`).join('');
  const members = receipt.schedule?.perRobotStarts ? `<ul class="fleet-fit">${receipt.schedule.agents.map(a => `<li class="${a.departsAt === null ? 'no-fit' : 'fits'}"><span>${esc(a.name)} · from (${a.start.x}, ${a.start.z})</span><span>${a.distance.toFixed(1)} m · ${a.departsAt === null ? 'unscheduled' : 'leaves ' + a.departsAt + ' s'}</span></li>`).join('')}${receipt.schedule.skipped.map(k => `<li class="no-fit" title="${esc(k.reason)}"><span>${esc(k.name)}</span><span>cannot</span></li>`).join('')}</ul>` : '';
  return `<div class="route-receipt" role="note"><h4>Why this route</h4><p>${esc(receipt.text)}</p><p class="micro">${esc(receipt.fleetText)}</p><ul class="fleet-fit">${rows}</ul>${members ? `<h4>Your fleet</h4>${members}` : ''}${receipt.scheduleText ? `<p class="micro">${esc(receipt.scheduleText)}</p>` : ''}<p class="micro">Same goal, same margin, every envelope. A simulation on the reviewed map; no robot was moved.</p></div>`;
}
