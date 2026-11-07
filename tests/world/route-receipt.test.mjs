import test from 'node:test';
import assert from 'node:assert/strict';
import {ROBOTS, sampleWorld, routeWorld, blockers} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {straightLine, tightestClearance, fleetFit, routeReceipt, receiptCard} from '../../brainsnn-r3f-app/public/world/route-receipt.mjs';
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
