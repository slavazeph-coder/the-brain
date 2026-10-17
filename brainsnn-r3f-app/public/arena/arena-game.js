/* BrainSNN Arena "Beat the bot": the visitor drives the same generic demo arm
 * through the same move/pick/place skill contract as the scripted controller,
 * on the same seeded world, and races a replay of that controller's run.
 * Pure game rules only, no DOM. Kinematic toy, not a benchmark. */
(function (root) {
  'use strict';
  var DT = 0.1, SPEED = 0.65, STEP = SPEED * DT;
  var CARRY_Z = 0.62, PICK_Z = 0.11, PLACE_Z = 0.16;
  var STUN_STEPS = 5, TIME_LIMIT = 90, ARRIVE = 0.004, THREE_STAR_MARGIN = 4;
  var XY_LIMIT = [[-1.3, 1.3], [-0.8, 0.8]];
  var LEVELS = Object.freeze([
    Object.freeze({ id: 'starter', name: 'First moves', blurb: 'Three blocks, one tray. Cut corners the bot will not.' }),
    Object.freeze({ id: 'clutter', name: 'Clutter course', blurb: 'Crates on the table. Clip one and you lose about a second.' }),
    Object.freeze({ id: 'moving', name: 'Moving world', blurb: 'A crate slides across your path. Time your dives.' }),
    Object.freeze({ id: 'night', name: 'Night shift', blurb: 'Same job, lights down. The bot does not need to see. You do.' }),
    Object.freeze({ id: 'surprise', name: 'Plot twist', blurb: 'The tray jumps at 6 s. React faster than the script.' })
  ]);

  function engine() {
    if (!root.BrainArena3D) throw new Error('BrainArena3D must load before arena-game.js is used.');
    return root.BrainArena3D;
  }
  function level(id) { return LEVELS.find(function (l) { return l.id === id; }) || LEVELS[0]; }
  function nextLevel(id) { var i = LEVELS.indexOf(level(id)); return LEVELS[(i + 1) % LEVELS.length]; }
  function seedOf(seed) {
    var s = String(seed == null ? '42' : seed).trim().slice(0, 64);
    return s || '42';
  }
  function engineSeed(seed) { return /^\d+$/.test(seed) && Number.isSafeInteger(Number(seed)) ? Number(seed) : seed; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  // The opponent is a replay of the existing scripted baseline on an identical
  // world, so both runs are measured on the same simulation clock.
  function simulateBot(seed, challenge) {
    var A = engine(), w = A.create(engineSeed(seed), { challenge: challenge });
    var frames = [{ p: w.robot.position.slice(), c: false }], deliveries = [];
    while (!w.done) {
      var before = w.delivered;
      A.step(w, A.demoAction(w));
      if (w.delivered > before) deliveries.push(w.time);
      frames.push({ p: w.robot.position.slice(), c: w.robot.carrying != null });
    }
    return { time: w.time, success: w.success, contacts: w.collisions, deliveries: deliveries, frames: frames };
  }

  function create(options) {
    options = options || {};
    var challenge = level(options.challenge).id, seed = seedOf(options.seed);
    var world = engine().create(engineSeed(seed), { challenge: challenge });
    return { challenge: challenge, seed: seed, world: world, bot: simulateBot(seed, challenge),
      phase: 'ready', claw: 'hover', pending: null, stun: 0, goal: null,
      contacts: 0, misses: 0, drops: 0, prev: world.robot.position.slice(), feed: [], seq: 0 };
  }

  function start(game) { if (game.phase === 'ready') game.phase = 'play'; return game; }

  function note(game, kind, text) {
    game.feed.push({ id: ++game.seq, kind: kind, text: text, time: game.world.time });
    if (game.feed.length > 12) game.feed.shift();
  }

  function underClaw(game) {
    var w = game.world, p = w.robot.position;
    if (w.robot.carrying != null) {
      var g = w.goal;
      return Math.abs(p[0] - g.position[0]) <= g.size[0] * 0.4 && Math.abs(p[1] - g.position[1]) <= g.size[1] * 0.4 ? 'tray' : 'table';
    }
    for (var i = 0; i < w.objects.length; i++) {
      var o = w.objects[i];
      if (!o.delivered && Math.hypot(p[0] - o.position[0], p[1] - o.position[1]) <= 0.12) return o.id;
    }
    return null;
  }

  // input: { dir: [x, y] unit-ish horizontal intent, tap: [x, y] goal, drop: boolean edge }
  function tick(game, input) {
    if (game.phase !== 'play') return game;
    input = input || {};
    var A = engine(), w = game.world, p = w.robot.position;
    game.prev = p.slice();
    if (Array.isArray(input.tap) && Number.isFinite(input.tap[0]) && Number.isFinite(input.tap[1])) {
      game.goal = [clamp(input.tap[0], XY_LIMIT[0][0], XY_LIMIT[0][1]), clamp(input.tap[1], XY_LIMIT[1][0], XY_LIMIT[1][1])];
    }
    if (input.drop && game.stun === 0 && ['hover', 'rising'].includes(game.claw)) game.claw = 'dropping';
    var action;
    if (game.stun > 0) { game.stun--; action = { skill: 'wait' }; }
    else if (game.claw === 'acting') { action = { skill: game.pending }; }
    else {
      var h = [0, 0], dir = Array.isArray(input.dir) ? input.dir : null;
      if (dir && (dir[0] || dir[1])) {
        var m = Math.hypot(dir[0], dir[1]); h = [dir[0] / Math.max(1, m), dir[1] / Math.max(1, m)]; game.goal = null;
      } else if (game.goal) {
        var dx = game.goal[0] - p[0], dy = game.goal[1] - p[1], d = Math.hypot(dx, dy);
        if (d < ARRIVE) game.goal = null;
        else { var k = Math.min(1, d / STEP) / d; h = [dx * k, dy * k]; }
      }
      // After a bonk the claw backs straight up before steering again, so a
      // held key or a standing tap goal cannot grind it into the same crate.
      if (game.claw === 'recovering') h = [0, 0];
      var floor = w.robot.carrying != null ? PLACE_Z : PICK_Z;
      var zGoal = game.claw === 'dropping' ? floor : game.claw === 'rising' || game.claw === 'recovering' ? CARRY_Z : p[2];
      var v = clamp((zGoal - p[2]) / STEP, -1, 1);
      if (Math.hypot(h[0], h[1], v) < 1e-6) action = { skill: 'wait' };
      else {
        var t = [clamp(p[0] + h[0] * STEP, XY_LIMIT[0][0], XY_LIMIT[0][1]), clamp(p[1] + h[1] * STEP, XY_LIMIT[1][0], XY_LIMIT[1][1]),
          clamp(p[2] + v * STEP, 0.09, 1.05)];
        action = { skill: 'move_to', position: t };
      }
    }
    var delivered = w.delivered, collisions = w.collisions, shifted = w.targetShifted;
    A.step(w, action);
    if (action.skill === 'pick' || action.skill === 'place') {
      if (w.event === 'pick') note(game, 'grab', 'Got it');
      else if (w.event === 'pick-empty') { game.misses++; note(game, 'miss', 'Missed: nothing under the claw'); }
      else if (w.delivered > delivered) note(game, 'deliver', 'Block ' + w.delivered + ' in the tray');
      else if (w.event === 'place-on-table') { game.drops++; note(game, 'drop', 'Dropped outside the tray'); }
      game.pending = null; game.claw = 'rising';
    } else if (/^collision:/.test(w.event)) {
      // Counted like the engine counts the bot: once per new contact.
      if (w.collisions > collisions) { game.contacts++; note(game, 'bonk', 'Bonk! Contact with a crate'); }
      game.stun = STUN_STEPS; game.claw = 'recovering'; game.goal = null;
    } else if (game.claw === 'dropping' && w.robot.position[2] <= (w.robot.carrying != null ? PLACE_Z : PICK_Z) + 0.002) {
      game.claw = 'acting'; game.pending = w.robot.carrying != null ? 'place' : 'pick';
    } else if ((game.claw === 'rising' || game.claw === 'recovering') && w.robot.position[2] >= CARRY_Z - 0.002) game.claw = 'hover';
    // The engine keeps the step's action event when the tray jumps, so watch the flag.
    if (!shifted && w.targetShifted) note(game, 'twist', 'The tray moved!');
    if (w.success) game.phase = 'won';
    else if (w.time >= TIME_LIMIT || w.done) game.phase = 'timeout';
    return game;
  }

  // The bot's replay at any simulation time, interpolated between its steps.
  function botAt(game, time) {
    var b = game.bot, t = time == null ? game.world.time : time, last = b.frames.length - 1;
    var f = clamp(t / DT, 0, last), i = Math.floor(f), j = Math.min(i + 1, last), a = f - i;
    var p = b.frames[i].p, q = b.frames[j].p;
    var delivered = b.deliveries.filter(function (d) { return d <= t + 1e-9; }).length;
    return { position: [p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a, p[2] + (q[2] - p[2]) * a],
      carrying: b.frames[a < 0.5 ? i : j].c, delivered: delivered, finished: b.success && t >= b.time - 1e-9 };
  }

  function result(game) {
    var w = game.world, won = game.phase === 'won', delta = won ? Number((w.time - game.bot.time).toFixed(1)) : null;
    // Three stars need glide play: tap-and-wait driving only edges the bot.
    var beat = won && delta < 0, stars = !won ? 0 : beat && delta <= -THREE_STAR_MARGIN && game.contacts === 0 ? 3 : beat ? 2 : 1;
    return { challenge: game.challenge, seed: game.seed, finished: won, time: Number(w.time.toFixed(1)), botTime: Number(game.bot.time.toFixed(1)),
      delta: delta, beatBot: beat, stars: stars, delivered: w.delivered, contacts: game.contacts, misses: game.misses, drops: game.drops };
  }

  // The engine's own seed for a link or input seed, as the practice world reports it.
  function worldSeed(seed) { return String(engine().create(engineSeed(seedOf(seed)), {}).seed); }
  function bestKey(challenge, seed) { return level(challenge).id + ':' + seedOf(seed); }
  function shareURL(origin, challenge, seed, time) {
    var t = Number(time), friend = Number.isFinite(t) && t > 0 && t <= TIME_LIMIT ? '&t=' + t.toFixed(1) : '';
    return String(origin || '').replace(/\/+$/, '') + '/arena/?play=' + encodeURIComponent(level(challenge).id) + '&seed=' + encodeURIComponent(seedOf(seed)) + friend + '#playground';
  }
  // A shared link names a level, a seed and, optionally, the sender's own time.
  // The time is whatever the link says; it is shown as a friend's claim only.
  function parseLink(search) {
    var p; try { p = new URLSearchParams(search || ''); } catch (e) { return null; }
    if (!p.get('play')) return null;
    var t = Number(p.get('t'));
    return { level: level(p.get('play')).id, seed: seedOf(p.get('seed')),
      friend: Number.isFinite(t) && t > 0 && t <= TIME_LIMIT ? Math.round(t * 10) / 10 : null };
  }
  function shareText(r) {
    var name = level(r.challenge).name;
    if (!r.finished) return 'The BrainSNN bot beat me on ' + name + '. Think you can beat it?';
    if (r.delta === 0) return 'I tied the BrainSNN bot on ' + name + ' (' + r.time.toFixed(1) + ' s). Your turn:';
    return (r.beatBot ? 'I beat the BrainSNN bot by ' + Math.abs(r.delta).toFixed(1) + ' s' : 'The BrainSNN bot beat me by ' + r.delta.toFixed(1) + ' s') +
      ' on ' + name + ' (' + r.time.toFixed(1) + ' s). Your turn:';
  }

  root.BrainSNNArenaGame = Object.freeze({ LEVELS: LEVELS, CARRY_Z: CARRY_Z, PICK_Z: PICK_Z, PLACE_Z: PLACE_Z, TIME_LIMIT: TIME_LIMIT, DT: DT, THREE_STAR_MARGIN: THREE_STAR_MARGIN,
    level: level, nextLevel: nextLevel, create: create, start: start, tick: tick, underClaw: underClaw, botAt: botAt, result: result,
    simulateBot: simulateBot, worldSeed: worldSeed, bestKey: bestKey, shareURL: shareURL, shareText: shareText, parseLink: parseLink });
})(typeof globalThis !== 'undefined' ? globalThis : this);
