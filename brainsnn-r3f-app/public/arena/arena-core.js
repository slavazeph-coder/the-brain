/* BrainSNN Arena concept: deterministic illustrative grid world.
 * This is a discrete toy environment, not physics, an LLM, or robot validation.
 * No DOM, network, clocks, or external dependencies; also works in a Worker.
 */
(function (root) {
  'use strict';

  var WIDTH = 12, HEIGHT = 8, MAX_STEPS = 120;
  var MOVES = {
    up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0]
  };
  var ORDER = ['up', 'right', 'down', 'left'];

  function seedNumber(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
    var s = String(seed == null ? 1 : seed), h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mix(n) {
    n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
    n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
    return (n ^ (n >>> 15)) >>> 0;
  }

  function random(seed) {
    var n = seed >>> 0;
    return function () {
      n = (n + 0x9e3779b9) >>> 0;
      return mix(n) / 4294967296;
    };
  }

  function pct(value, fallback, max) {
    value = Number(value == null ? fallback : value);
    return Math.min(max, Math.max(0, Number.isFinite(value) ? value : fallback));
  }

  function idx(x, y) { return y * WIDTH + x; }
  function key(x, y) { return x + ',' + y; }

  // The seed determines each object's nth grip attempt independently of route.
  // Moving extra times never changes the next grip result; A/B policies see
  // the same faults for corresponding object/attempt pairs.
  function slipSample(seed, objectIndex, attempt) {
    var n = (seed ^ Math.imul(objectIndex + 1, 0x9e3779b1) ^
      Math.imul(attempt, 0x85ebca77) ^ 0x4c6f7b19) >>> 0;
    return mix(n) / 4294967296;
  }

  function allReachable(blocked, start, targets, queue, visited) {
    visited.fill(0);
    var head = 0, tail = 1;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      var at = queue[head++], x = at % WIDTH, y = (at / WIDTH) | 0;
      for (var d = 0; d < 4; d++) {
        var delta = MOVES[ORDER[d]], nx = x + delta[0], ny = y + delta[1];
        if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) continue;
        var next = idx(nx, ny);
        if (!blocked[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    for (var j = 0; j < targets.length; j++) if (!visited[targets[j]]) return false;
    return true;
  }

  function create(seed, opts) {
    opts = opts || {};
    var n = seedNumber(seed), rng = random(n);
    var agent = ['greedy', 'planner', 'recovery', 'human'].indexOf(opts.agent) >= 0 ?
      opts.agent : 'recovery';
    var clutter = pct(opts.clutter, 18, 45), slip = pct(opts.slip, 18, 50);
    var robot = { x: 1, y: 4, carrying: null };
    var goal = { x: 10, y: 4 };
    var objects = [4, 7, 9].map(function (x) {
      return { x: x, y: 1 + Math.floor(rng() * 6), delivered: false };
    });
    var blocked = new Uint8Array(WIDTH * HEIGHT);
    var reserved = new Uint8Array(WIDTH * HEIGHT);
    var targets = [idx(goal.x, goal.y)];
    reserved[idx(robot.x, robot.y)] = 1;
    reserved[idx(goal.x, goal.y)] = 1;
    objects.forEach(function (o) {
      reserved[idx(o.x, o.y)] = 1;
      targets.push(idx(o.x, o.y));
    });
    var candidates = [];
    for (var i = 0; i < blocked.length; i++) if (!reserved[i]) candidates.push(i);
    for (i = candidates.length - 1; i > 0; i--) {
      var swap = Math.floor(rng() * (i + 1)), value = candidates[i];
      candidates[i] = candidates[swap]; candidates[swap] = value;
    }
    var desired = Math.round(WIDTH * HEIGHT * clutter / 100), count = 0;
    var queue = new Int16Array(WIDTH * HEIGHT), visited = new Uint8Array(WIDTH * HEIGHT);
    var start = idx(robot.x, robot.y);
    for (i = 0; i < candidates.length && count < desired; i++) {
      var cell = candidates[i];
      blocked[cell] = 1;
      if (allReachable(blocked, start, targets, queue, visited)) count++;
      else blocked[cell] = 0;
    }
    var walls = [];
    for (i = 0; i < blocked.length; i++) if (blocked[i]) walls.push(key(i % WIDTH, (i / WIDTH) | 0));
    return {
      width: WIDTH, height: HEIGHT, seed: n,
      opts: { agent: agent, clutter: clutter, slip: slip,
        mission: opts.mission || 'table', recordTrail: opts.recordTrail !== false },
      walls: walls, objects: objects, robot: robot, goal: goal,
      steps: 0, collisions: 0, retries: 0, delivered: 0,
      done: false, success: false, failureReason: null, event: 'ready',
      trail: opts.recordTrail === false ? [] : [{ x: robot.x, y: robot.y, step: 0, event: 'ready' }],
      graspAttempts: [0, 0, 0], target: null,
      _blocked: blocked, _queue: queue, _parents: new Int16Array(WIDTH * HEIGHT),
      _firstMove: new Int8Array(WIDTH * HEIGHT)
    };
  }

  function nextTarget(state) {
    // Hold the target until its item is delivered, allowing a fair same-target
    // comparison between direct movement, planning, and retry policies.
    if (state.target != null && !state.objects[state.target].delivered) return state.target;
    var best = null, distance = Infinity;
    for (var i = 0; i < state.objects.length; i++) {
      var o = state.objects[i];
      if (o.delivered) continue;
      var d = Math.abs(o.x - state.robot.x) + Math.abs(o.y - state.robot.y);
      if (d < distance) { distance = d; best = i; }
    }
    state.target = best;
    return best;
  }

  function bfsMove(state, target) {
    var source = idx(state.robot.x, state.robot.y), dest = idx(target.x, target.y);
    if (source === dest) return 'wait';
    var parents = state._parents, firstMove = state._firstMove, queue = state._queue;
    parents.fill(-1);
    parents[source] = source;
    var head = 0, tail = 1;
    queue[0] = source;
    while (head < tail) {
      var at = queue[head++], x = at % WIDTH, y = (at / WIDTH) | 0;
      for (var d = 0; d < 4; d++) {
        var delta = MOVES[ORDER[d]], nx = x + delta[0], ny = y + delta[1];
        if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) continue;
        var next = idx(nx, ny);
        if (state._blocked[next] || parents[next] !== -1) continue;
        parents[next] = at;
        firstMove[next] = at === source ? d : firstMove[at];
        if (next === dest) return ORDER[firstMove[next]];
        queue[tail++] = next;
      }
    }
    return 'wait';
  }

  function policyAction(state) {
    if (state.opts.agent === 'human') return 'wait';
    var target;
    if (state.robot.carrying != null) {
      target = state.goal;
      if (state.robot.x === target.x && state.robot.y === target.y) return 'drop';
    } else {
      var which = nextTarget(state);
      if (which == null) return 'wait';
      target = state.objects[which];
      if (state.robot.x === target.x && state.robot.y === target.y) return 'pick';
    }
    if (state.opts.agent === 'greedy') {
      if (state.robot.x < target.x) return 'right';
      if (state.robot.x > target.x) return 'left';
      return state.robot.y < target.y ? 'down' : 'up';
    }
    return bfsMove(state, target);
  }

  // Mutates and returns the same state, suitable for low-allocation workers.
  // action: up/right/down/left/pick/drop/wait, or {type: <same>}.
  // Omitting action uses state.opts.agent.
  function step(state, action) {
    if (state.done) return state;
    action = action == null ? policyAction(state) :
      typeof action === 'string' ? action : action.type;
    state.steps++;
    state.event = 'wait';
    if (Object.prototype.hasOwnProperty.call(MOVES, action)) {
      var delta = MOVES[action], nx = state.robot.x + delta[0], ny = state.robot.y + delta[1];
      if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT || state._blocked[idx(nx, ny)]) {
        state.collisions++;
        state.event = 'bump';
      } else {
        state.robot.x = nx; state.robot.y = ny;
        state.event = 'move';
        if (state.robot.carrying != null) {
          var carried = state.objects[state.robot.carrying];
          carried.x = nx; carried.y = ny;
        }
      }
    } else if (action === 'pick') {
      var found = -1;
      if (state.robot.carrying == null) {
        for (var i = 0; i < state.objects.length; i++) {
          var item = state.objects[i];
          if (!item.delivered && item.x === state.robot.x && item.y === state.robot.y) { found = i; break; }
        }
      }
      if (found < 0) state.event = 'pick-empty';
      else {
        var attempt = ++state.graspAttempts[found];
        if (slipSample(state.seed, found, attempt) < state.opts.slip / 100) {
          var retryLimit = state.opts.agent === 'recovery' ? 3 : state.opts.agent === 'planner' ? 1 : 0;
          state.event = 'grip-slip';
          if (state.opts.agent === 'human' || attempt <= retryLimit) {
            state.retries++;
            state.event = 'grip-slip-retry';
          } else {
            state.done = true;
            state.failureReason = 'grasp-exhausted';
          }
        } else {
          state.robot.carrying = found;
          state.target = found;
          state.event = 'pick';
        }
      }
    } else if (action === 'drop') {
      if (state.robot.carrying == null) state.event = 'drop-empty';
      else {
        var carrying = state.robot.carrying, object = state.objects[carrying];
        object.x = state.robot.x; object.y = state.robot.y;
        state.robot.carrying = null;
        if (state.robot.x === state.goal.x && state.robot.y === state.goal.y) {
          object.delivered = true;
          state.delivered++;
          state.target = null;
          state.event = 'deliver';
          if (state.delivered === state.objects.length) {
            state.done = true; state.success = true; state.event = 'complete';
          }
        } else {
          state.event = 'drop';
          // A manual drop changes the item position, so the next grasp series
          // starts afresh. The episode still shares the same hard step cap.
          state.graspAttempts[carrying] = 0;
        }
      }
    } else if (action !== 'wait') state.event = 'invalid-action';

    if (!state.done && state.steps >= MAX_STEPS) {
      state.done = true; state.failureReason = 'step-limit'; state.event = 'timeout';
    }
    if (state.opts.recordTrail) state.trail.push({
      x: state.robot.x, y: state.robot.y, step: state.steps,
      event: state.event, carrying: state.robot.carrying
    });
    return state;
  }

  function run(seed, opts) {
    var state = create(seed, opts);
    while (!state.done) step(state);
    return {
      seed: state.seed, success: state.success, done: state.done,
      steps: state.steps, collisions: state.collisions, retries: state.retries,
      delivered: state.delivered, failureReason: state.failureReason,
      state: state
    };
  }

  root.BrainArena = Object.freeze({
    create: create, step: step, run: run,
    colors: Object.freeze({ floor: '#14202d', wall: '#34485e', robot: '#7ef5cc',
      object: '#ffd56d', goal: '#97a5ff', trail: '#51b5a0' })
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
