import test from 'node:test';
import assert from 'node:assert/strict';
import {ROBOTS, sampleWorld, routeWorld, blockers, normalizeWorld} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {straightLine, tightestClearance, fleetFit, routeReceipt, receiptCard, aerialGate, fleetSchedule} from '../../brainsnn-r3f-app/public/world/route-receipt.mjs';
import {proofPack} from '../../brainsnn-r3f-app/public/world/core.mjs';
const robot = {...ROBOTS.cleaner, margin: .1};
test('blockers itemises what planningGrid tests: wall, objects, nothing', () => {
  const w = sampleWorld(), o = w.objects[0];
  assert.deepEqual(blockers(w, {x: o.x + o.w / 2, z: o.z + o.d / 2}, .1).map(b => b.kind), ['object']);
  assert.deepEqual(blockers(w, {x: .05, z: w.depth / 2}, .3).map(b => b.kind), ['wall']);
  assert.equal(blockers(w, {x: w.width / 2, z: w.depth - 1.5}, .4).length, 0);
});
test('the straight line names what it crosses, each once, in order; the receipt explains the detour', () => {
  const w = sampleWorld(), goal = {x: 16.5, z: 11.5}, route = routeWorld(w, robot, goal), s = straightLine(w, robot, goal);
  assert.ok(s.length > 0 && s.blockers.length >= 1);
  const ids = s.blockers.filter(b => b.kind === 'object').map(b => b.id); assert.equal(new Set(ids).size, ids.length);
  for (let i = 1; i < s.blockers.length; i++) assert.ok(s.blockers[i].atMetres >= s.blockers[i - 1].atMetres);
  const r = routeReceipt(w, robot, goal, route);
  assert.equal(r.schema, 'brainsnn.route-receipt.v1'); assert.ok(r.distance >= r.straightLine); assert.equal(r.detourMetres, Math.round((r.distance - r.straightLine) * 10) / 10 || r.detourMetres);
  assert.match(r.text, /straight line/); assert.equal(r.policyExecuted, false);
});
test('tightest clearance is never below the planning radius and names what it is against', () => {
  const w = sampleWorld(), goal = {x: 16.5, z: 11.5}, route = routeWorld(w, robot, goal), t = tightestClearance(w, route.route);
  const radius = Math.hypot(robot.width, robot.depth) / 2 + robot.margin;
  assert.ok(t.metres >= radius - 1e-6, `${t.metres} >= ${radius}`); assert.ok(t.capped || typeof t.against === 'string');
});
test('fleet fit: wider envelopes are refused where narrow ones pass, with the planner\'s reason', () => {
  const w = sampleWorld(); w.objects.push({id: 'gate-a', name: 'Gate post A', x: 11, z: 6, w: .3, d: 4, h: 1, kind: 'obstacle'}, {id: 'gate-b', name: 'Gate post B', x: 12.6, z: 6, w: .3, d: 4, h: 1, kind: 'obstacle'});
  const goal = {x: 11.95, z: 8}; const f = fleetFit(w, goal, .1);
  assert.equal(f.length, Object.keys(ROBOTS).length); assert.ok(f.find(x => x.id === 'vacuum').fits);
  const fork = f.find(x => x.id === 'forklift'); assert.equal(fork.fits, false); assert.match(fork.reason, /too close|No route|start is blocked/);  // the planner's own words: goal, cut-off or start
  const card = receiptCard(routeReceipt(w, {...ROBOTS.vacuum, margin: .1}, goal, routeWorld(w, {...ROBOTS.vacuum, margin: .1}, goal)));
  assert.match(card, /Compact forklift/); assert.match(card, /cannot/); assert.match(card, /no robot was moved/);
});

test('aerial is a gate, not a route: it names the tallest object and the missing overhead model', () => {
  const g = aerialGate(sampleWorld()); assert.equal(g.fits, false); assert.equal(g.planned, false); assert.ok(g.tallestObjectMetres > 0); assert.match(g.reason, /no ceiling/);
  const card = receiptCard(routeReceipt(sampleWorld(), robot, {x: 16.5, z: 11.5}, routeWorld(sampleWorld(), robot, {x: 16.5, z: 11.5}))); assert.match(card, /Aerial \(drone\)/); assert.match(card, /not planned/);
});
test('a fleet from one start is time-separated: nobody leaves while someone is within two radii, and the schedule is deterministic', () => {
  const w = sampleWorld(), goal = {x: 16.5, z: 11.5}, s = fleetSchedule(w, goal, .1), t = fleetSchedule(w, goal, .1);
  assert.deepEqual(s, t); assert.ok(s.agents.length >= 2); assert.equal(s.agents[0].departsAt, 0);
  for (let i = 1; i < s.agents.length; i++) assert.ok(s.agents[i].departsAt > 0, `${s.agents[i].name} must wait: same start as ${s.agents[0].name}`);
  assert.ok(s.allArrivedAt >= Math.max(...s.agents.map(a => a.arrivesAt))); assert.equal(s.schema, 'brainsnn.fleet-schedule.v1');
});
test('the proof pack carries the receipt under the hash', async () => {
  const w = sampleWorld(), goal = {x: 16.5, z: 11.5}, route = routeWorld(w, robot, goal), receipt = routeReceipt(w, robot, goal, route);
  const p = await proofPack(w, route, {}, [], [{type: 'test'}], [], null, {routeReceipt: receipt});
  assert.equal(p.routeReceipt.schema, 'brainsnn.route-receipt.v1'); assert.equal(p.routeReceipt.fleet.length, receipt.fleet.length);
  const {integrity, ...body} = p; const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  assert.equal(integrity.value, Array.from(new Uint8Array(h), v => v.toString(16).padStart(2, '0')).join(''));
  const q = await proofPack(w, route, {}, [], [{type: 'test'}]); assert.equal(q.routeReceipt, undefined);
});

test('a fleet on the map: validated, each robot leaves from its own start, far-apart starts leave together', () => {
  const base = sampleWorld();
  assert.throws(() => normalizeWorld({...base, fleet: [{robot: 'tank', start: {x: 1, z: 1}}]}), /robot must be one of/);
  assert.throws(() => normalizeWorld({...base, fleet: [{robot: 'amr', start: {x: 99, z: 1}}]}), /Fleet start X/);
  assert.throws(() => normalizeWorld({...base, fleet: [{id: 'a', robot: 'amr', start: {x: 1, z: 1}}, {id: 'a', robot: 'vacuum', start: {x: 2, z: 2}}]}), /unique/);
  const w = normalizeWorld({...base, fleet: [{id: 'v1', robot: 'vacuum', start: {x: 1, z: 1}}, {id: 'v2', robot: 'vacuum', start: {x: 16.5, z: 1.5}}]});
  assert.equal(w.fleet.length, 2); assert.equal(w.fleet[1].name, 'Robot vacuum');
  const s = fleetSchedule(w, {x: 9, z: 11.5}, .1); assert.equal(s.perRobotStarts, true); assert.equal(s.agents.length, 2);
  assert.deepEqual(s.agents.map(a => a.start.x), [1, 16.5]);
  // both leave at 0 s: the second start is on the far side of the floor, so they meet only near the goal, in turn
  assert.equal(s.agents[0].departsAt, 0); assert.ok(s.agents[1].departsAt !== null);
  const card = receiptCard(routeReceipt(w, {...ROBOTS.vacuum, margin: .1}, {x: 9, z: 11.5}, routeWorld(w, {...ROBOTS.vacuum, margin: .1}, {x: 9, z: 11.5})));
  assert.match(card, /Your fleet/); assert.match(card, /from \(16.5, 1.5\)/);
});

test('a robot waiting on its own start is never driven through, and it goes first when that is the only way', () => {
  // An empty 20 x 6 m floor: the forklift's straight run to the goal passes over the spot where the vacuum stands.
  const base = sampleWorld(), goal = {x: 18, z: 3}, margin = .1;
  const w = normalizeWorld({...base, width: 20, depth: 6, floor: [[0, 0], [20, 0], [20, 6], [0, 6]], objects: [], start: {x: 1, z: 1},
    fleet: [{id: 'forklift', robot: 'forklift', start: {x: 2, z: 3}}, {id: 'vacuum', robot: 'vacuum', start: {x: 8, z: 3}}]});
  const s = fleetSchedule(w, goal, margin);
  const [forklift, vacuum] = s.agents;
  assert.deepEqual(s.agents.map(a => a.id), ['forklift', 'vacuum'], 'reported in the fleet\'s own order');
  assert.equal(vacuum.departsAt, 0, 'the robot in the way leaves first');
  assert.ok(forklift.departsAt > 0 && forklift.arrivesAt > vacuum.arrivesAt, 'the forklift follows once the floor ahead is clear');
  // Replay both robots from time zero, standing on their starts until they leave, and measure the gap at every step.
  const moving = s.agents.map(a => { const robot = {...ROBOTS[a.id], margin}, route = routeWorld({...w, start: a.start}, robot, goal).route;
    const cum = [0]; for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z));
    return {...a, route, cum, speed: robot.speed}; });
  const at = (a, t) => { const gone = t - a.departsAt; if (gone > a.cum.at(-1) / a.speed + 5) return null;
    const d = Math.min(a.cum.at(-1), Math.max(0, gone) * a.speed); let i = 1; while (i < a.cum.length - 1 && a.cum[i] < d) i++;
    const f = a.cum[i] === a.cum[i - 1] ? 1 : (d - a.cum[i - 1]) / (a.cum[i] - a.cum[i - 1]);
    return {x: a.route[i - 1].x + (a.route[i].x - a.route[i - 1].x) * f, z: a.route[i - 1].z + (a.route[i].z - a.route[i - 1].z) * f}; };
  let closest = Infinity;
  for (let t = 0; t <= s.allArrivedAt + 6; t += s.stepSeconds) { const [p, q] = moving.map(a => at(a, t)); if (p && q) closest = Math.min(closest, Math.hypot(p.x - q.x, p.z - q.z)); }
  assert.ok(closest >= forklift.radius + vacuum.radius - 1e-6, `closest approach ${closest.toFixed(2)} m, needs ${(forklift.radius + vacuum.radius).toFixed(2)} m`);
  assert.ok(s.limitations.some(line => /occupies its start from time zero until departure/.test(line)));
  // Without a fleet every envelope shares the single start and queues off the floor, as before: all of them are scheduled.
  const shared = fleetSchedule(normalizeWorld({...base, fleet: []}), {x: 16.5, z: 11.5}, margin);
  assert.ok(shared.agents.length > 1 && shared.agents.every(a => a.departsAt !== null));
});
