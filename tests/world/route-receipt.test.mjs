import test from 'node:test';
import assert from 'node:assert/strict';
import {ROBOTS, sampleWorld, routeWorld, blockers} from '../../brainsnn-r3f-app/public/world/core.mjs';
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
