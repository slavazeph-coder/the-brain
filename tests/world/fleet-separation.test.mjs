import test from 'node:test';
import assert from 'node:assert/strict';
import { ROBOTS, routeWorld, sampleWorld } from '../../brainsnn-r3f-app/public/world/core.mjs';
import { fleetSchedule, receiptCard, routeReceipt } from '../../brainsnn-r3f-app/public/world/route-receipt.mjs';

const margin = 0.1;
const vacuum = { ...ROBOTS.vacuum, margin };

function openMap(fleet, width = 10, depth = 5) {
  return { ...sampleWorld(), width, depth, objects: [], start: { x: 2, z: 3 }, fleet };
}

// Replay the planner's actual polyline at the envelope's speed, independently of
// the scheduler's separation check.
function replay(world, member, goal, departure, dwell) {
  const robot = { ...ROBOTS[member.robot], margin };
  const { route, travelSeconds } = routeWorld({ ...world, start: member.start }, robot, goal);
  const arrival = departure + travelSeconds;
  return {
    radius: Math.hypot(robot.width, robot.depth) / 2 + margin,
    arrival,
    position(time) {
      if (time <= departure) return member.start;
      if (time > arrival + dwell) return null;
      let distance = (time - departure) * robot.speed;
      for (let i = 1; i < route.length; i++) {
        const from = route[i - 1], to = route[i];
        const length = Math.hypot(to.x - from.x, to.z - from.z);
        if (distance <= length) {
          const t = distance / length;
          return { x: from.x + t * (to.x - from.x), z: from.z + t * (to.z - from.z) };
        }
        distance -= length;
      }
      return goal;
    },
  };
}

function assertWithheld(schedule) {
  assert.equal(schedule.status, 'unscheduled');
  assert.equal(schedule.allArrivedAt, null);
  assert.equal(schedule.separation, null);
  assert.ok(schedule.reason?.trim());
  for (const member of schedule.agents) {
    assert.equal(member.departsAt, null, member.name);
    assert.equal(member.arrivesAt, null, member.name);
  }
}

test('the 20 × 6 m review example clears the occupied vacuum start before the forklift passes', () => {
  const fleet = [
    { id: 'fork', robot: 'forklift', start: { x: 2, z: 3 } },
    { id: 'vac', robot: 'vacuum', start: { x: 8, z: 3 } },
  ];
  const world = openMap(fleet, 20, 6), goal = { x: 18, z: 3 }, dwell = 5;
  const oldFork = replay(world, fleet[0], goal, 0, dwell);
  const oldVac = replay(world, fleet[1], goal, 7, dwell);
  const p = oldFork.position(5), q = oldVac.position(5);
  assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < oldFork.radius + oldVac.radius);

  const receipt = routeReceipt(world, vacuum, goal, routeWorld(world, vacuum, goal));
  const schedule = receipt.schedule;
  assert.deepEqual(fleetSchedule(world, goal, margin), schedule);
  assert.deepEqual(schedule.agents.map(a => a.id).sort(), ['fork', 'vac']);
  const [fork, vac] = fleet.map(member => {
    const { departsAt } = schedule.agents.find(a => a.id === member.id);
    assert.ok(Number.isFinite(departsAt) && departsAt >= 0);
    return replay(world, member, goal, departsAt, dwell);
  });
  const lastArrival = Math.max(fork.arrival, vac.arrival);
  for (let tick = 0; tick / 40 <= lastArrival + dwell; tick++) {
    const t = tick / 40, p = fork.position(t), q = vac.position(t);
    if (p && q) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= fork.radius + vac.radius - 1e-9, `overlap at ${t} s`);
  }
  assert.equal(schedule.status, 'scheduled');
  assert.ok(schedule.allArrivedAt + 1e-9 >= lastArrival);
  assert.ok(receipt.scheduleText.trim());
  assert.match(receiptCard(receipt), /simulat/i);
  assert.equal(receipt.policyExecuted, false);
  assert.equal(receipt.safetyCertified, false);
});

test('separated starts can depart together when one robot finishes dwelling before the other approaches', () => {
  const world = openMap([
    { id: 'near', robot: 'vacuum', start: { x: 4.05, z: 2.05 } },
    { id: 'far', robot: 'vacuum', start: { x: 9.05, z: 2.05 } },
  ]);
  const goal = { x: 5.05, z: 2.05 };
  const schedule = fleetSchedule(world, goal, margin, ROBOTS, { maxDelay: 0 });
  assert.equal(schedule.status, 'scheduled');
  assert.deepEqual(schedule.agents.map(a => a.departsAt), [0, 0]);
  assert.ok(schedule.allArrivedAt >= 4 / ROBOTS.vacuum.speed - 1e-9);
});

test('an unavoidable time-zero overlap withholds the whole timetable and the success claim', () => {
  const world = openMap([
    { id: 'one', robot: 'vacuum', start: { x: 2, z: 3 } },
    { id: 'two', robot: 'vacuum', start: { x: 2.2, z: 3 } },
    { id: 'elsewhere', robot: 'vacuum', start: { x: 8, z: 3 } },
  ]);
  const goal = { x: 5, z: 3 };
  const receipt = routeReceipt(world, vacuum, goal, routeWorld(world, vacuum, goal));
  assertWithheld(receipt.schedule);
  assert.equal(receipt.schedule.agents.length, 3);
  assert.match(receipt.scheduleText, /no fleet schedule/i);
  assert.ok(receipt.scheduleText.includes(receipt.schedule.reason));
  const card = receiptCard(receipt);
  assert.match(card, /no fleet schedule/i);
  assert.doesNotMatch(card, /all (?:scheduled robots )?arrive(?:d)? by|never within two radii|planning radii stay separated/i);
  assert.equal(receipt.safetyCertified, false);
});

test('a named robot without a route cannot silently disappear from a successful fleet receipt', () => {
  const world = openMap([
    { id: 'mobile', robot: 'vacuum', start: { x: 2, z: 3 } },
    { id: 'blocked', robot: 'forklift', start: { x: 0.05, z: 3 } },
  ]);
  const goal = { x: 8, z: 3 };
  const receipt = routeReceipt(world, vacuum, goal, routeWorld(world, vacuum, goal));
  assertWithheld(receipt.schedule);
  assert.ok(receipt.schedule.skipped.some(a => a.id === 'blocked' && a.reason));
  assert.ok(receipt.scheduleText.trim());
});

test('two moving robots can overlap between both grid vertices and half-second samples', () => {
  const world = openMap([
    { id: 'fast', robot: 'amr', start: { x: 10.5, z: 11.5 } },
    { id: 'slow', robot: 'vacuum', start: { x: 15.5, z: 11.5 } },
  ], 80, 75);
  const robots = {
    amr: { ...ROBOTS.amr, width: 0.1, depth: 0.1, speed: 3 },
    vacuum: { ...ROBOTS.vacuum, width: 0.1, depth: 0.1, speed: 7 / 9 },
  };
  const goal = { x: 42.5, z: 11.5 };
  // On this one-metre grid both centres reach x=17.25 at t=2.25, inside
  // the same segment. At both t=2.0 and 2.5 the centres are over 0.5 m apart.
  assertWithheld(fleetSchedule(world, goal, 0, robots, { step: 0.5, maxDelay: 0, dwell: 0 }));
  const withDelay = fleetSchedule(world, goal, 0, robots, { step: 2, maxDelay: 30, dwell: 0 });
  assert.equal(withDelay.status, 'scheduled');
  assert.equal(withDelay.stepSeconds, 2);  // legacy receipt replay cadence
  assert.deepEqual(withDelay.agents, fleetSchedule(world, goal, 0, robots, { maxDelay: 30, dwell: 0 }).agents);
});

test('an arrival still occupies the common goal at the fractional end of its dwell', () => {
  const world = openMap([
    { id: 'west', robot: 'vacuum', start: { x: 6, z: 3 } },
    { id: 'east', robot: 'vacuum', start: { x: 14, z: 3 } },
  ], 20, 6);
  const goal = { x: 10, z: 3 };
  const schedule = fleetSchedule(world, goal, margin, ROBOTS, { maxDelay: 8, dwell: 5 });
  assert.deepEqual(schedule.agents.map(a => a.departsAt).sort((a, b) => a - b), [0, 8]);
  assert.equal(schedule.status, 'scheduled');
});

test('a zero-length trip occupies its goal through the dwell endpoint before the next staged robot enters', () => {
  const goal = { x: 5.05, z: 2.05 };
  const world = { ...openMap([]), start: goal };
  const robots = { vacuum: ROBOTS.vacuum, cleaner: ROBOTS.cleaner };
  assert.equal(routeWorld(world, vacuum, goal).distance, 0);
  assertWithheld(fleetSchedule(world, goal, margin, robots, { dwell: 1, maxDelay: 1 }));
  const schedule = fleetSchedule(world, goal, margin, robots, { dwell: 1, maxDelay: 2 });
  assert.equal(schedule.status, 'scheduled');
  assert.deepEqual(schedule.agents.map(a => a.departsAt), [0, 2]);
});
