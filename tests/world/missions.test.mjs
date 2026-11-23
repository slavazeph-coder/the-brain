import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  LEVELS, MISSIONS, TOTAL_STARS, applyEvent, emptyProgress, levelFor, missionStars, newlyEarned, nextMission, readProgress, totalStars,
} from '../../brainsnn-r3f-app/public/world/missions.mjs';

const run = (progress, type, detail, extra = {}) => applyEvent(progress, { type, detail, robotId: 'cleaner', map: 'Studio 01', ...extra });

test('missions are plain, unique and add up to the advertised total', () => {
  assert.equal(new Set(MISSIONS.map(({ id }) => id)).size, MISSIONS.length);
  for (const mission of MISSIONS) {
    assert.ok(mission.title && mission.goal && mission.how && mission.icon, mission.id);
    assert.ok(Number.isInteger(mission.stars) && mission.stars >= 1 && mission.stars <= 3, mission.id);
    assert.match(mission.show, /^(run|robots|edit|spot|street|before|own)$/u, mission.id);
  }
  assert.equal(TOTAL_STARS, MISSIONS.reduce((sum, m) => sum + m.stars, 0));
  assert.equal(totalStars(emptyProgress()), 0);
  assert.equal(LEVELS.at(-1).at, TOTAL_STARS, 'the last level needs every star');
});

test('stars only come from real planner results and real actions', () => {
  let p = emptyProgress();
  // A failed or empty run earns nothing.
  for (const detail of [{}, { metres: 0 }, { metres: -3 }, { metres: 'NaN' }, null]) {
    p = run(p, 'plan_completed', detail).progress;
  }
  assert.equal(totalStars(p), 0);
  ({ progress: p } = run(p, 'plan_completed', { metres: 1152.4, algorithm: 'conservative-grid-dfs-v1' }, { area: 116.1 }));
  assert.equal(missionStars('first', p), 1);
  assert.equal(missionStars('garage', p), 0, 'one robot is not a garage');
  for (const id of ['vacuum', 'amr']) p = run(p, 'plan_completed', { metres: 40 }, { robotId: id }).progress;
  assert.equal(missionStars('garage', p), 2);
  for (const id of ['humanoid', 'forklift']) p = run(p, 'plan_completed', { metres: 40 }, { robotId: id }).progress;
  assert.equal(missionStars('garage', p), 3);
  p = run(p, 'plan_completed', { metres: 40 }, { robotId: '<script>' }).progress;
  assert.equal(p.robots.length, 5, 'unsafe robot ids are ignored');
});

test('a coverage run reports floor covered, while spot routes keep the shortest so far', () => {
  const cover = run(emptyProgress(), 'plan_completed', { metres: 1152.4 }, { area: 116.1 }).outcome.run;
  assert.deepEqual(cover, { kind: 'cover', metres: 1152.4, area: 116.1 });
  let p = emptyProgress();
  let outcome;
  ({ progress: p, outcome } = run(p, 'goal_routed', { metres: 9.2 }));
  assert.equal(outcome.run.kind, 'route');
  assert.equal(outcome.run.previous, null);
  assert.equal(missionStars('spot', p), 1);
  ({ progress: p, outcome } = run(p, 'goal_routed', { metres: 9.25 }));
  assert.equal(outcome.run.newShortest, false, 'a few centimetres longer is not a new shortest');
  ({ progress: p, outcome } = run(p, 'goal_routed', { metres: 8.1 }));
  assert.equal(outcome.run.newShortest, true);
  assert.equal(p.shortest['cleaner|Studio 01'], 8.1);
});

test('the shortcut is scored on the what-if comparison, never on a longer route', () => {
  let p = emptyProgress();
  p = run(p, 'what_if_rerouted', { metres: 9, before: 8 }).progress;
  assert.equal(missionStars('shortcut', p), 0, 'a longer route is not a shortcut');
  p = run(p, 'what_if_rerouted', { metres: 7.6, before: 8.3 }).progress;
  assert.equal(missionStars('shortcut', p), 1);
  p = run(p, 'what_if_rerouted', { metres: 5, before: 7.5 }).progress;
  assert.equal(missionStars('shortcut', p), 2);
  p = run(p, 'what_if_rerouted', { metres: 3, before: 7.4 }).progress;
  assert.equal(missionStars('shortcut', p), 3);
  const later = run(p, 'what_if_rerouted', { metres: 7, before: 7.6 }).progress;
  assert.equal(missionStars('shortcut', later), 3, 'a smaller later cut keeps the best one');
});

test('actions, levels and newly earned stars', () => {
  let p = emptyProgress();
  p = applyEvent(p, { type: 'sandbox_selected', detail: { workspace: 'map' } }).progress;
  assert.equal(missionStars('street', p), 0);
  const before = p;
  p = applyEvent(p, { type: 'sandbox_selected', detail: { workspace: 'street' } }).progress;
  p = applyEvent(p, { type: 'scenario_forked', detail: { distance: 9 } }).progress;
  p = applyEvent(p, { type: 'source_added', detail: 'room.jpg (image), local only' }).progress;
  assert.deepEqual(newlyEarned(before, p).map(({ mission }) => mission.id), ['street', 'before', 'own']);
  assert.deepEqual(levelFor(0), { number: 1, name: 'Rookie', next: LEVELS[1], toNext: 3 });
  assert.equal(levelFor(3).name, 'Explorer');
  assert.equal(levelFor(TOTAL_STARS).name, 'Master');
  assert.equal(levelFor(TOTAL_STARS).next, null);
});

test('stored progress is validated; anything malformed starts again', () => {
  assert.deepEqual(readProgress(null), emptyProgress());
  assert.deepEqual(readProgress('stars'), emptyProgress());
  const restored = readProgress({ robots: ['cleaner', 'cleaner', 'x y', 7], bestCut: '3', firstRun: 'yes', street: true,
    shortest: { 'cleaner|Studio': 8, bad: -1, worse: 'x' } });
  assert.deepEqual(restored.robots, ['cleaner']);
  assert.equal(restored.bestCut, 3);
  assert.equal(restored.firstRun, false, 'only a real true counts');
  assert.equal(restored.street, true);
  assert.deepEqual(restored.shortest, { 'cleaner|Studio': 8 });
});

test('the playground wires missions to its own event log and keeps them in the offline shell', async () => {
  const directory = new URL('../../brainsnn-r3f-app/public/world/', import.meta.url);
  const [app, page, shell, css] = await Promise.all(['app.mjs', 'index.html', 'sw.js', 'studio.css'].map(name => readFile(new URL(name, directory), 'utf8')));
  assert.match(app, /new CustomEvent\('world:event'/u);
  assert.match(app, /mountMissions\(\{button:\$\('studio-missions-open'\)/u);
  assert.match(page, /id="studio-missions-open"/u);
  assert.ok(shell.includes("'./missions.mjs'"));
  // Celebration layers never take pointer events, and motion is optional.
  for (const selector of ['.mission-toast', '.mission-confetti', '.mission-run-card']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.') + '\\{[^}]*pointer-events:none'), selector);
  }
  assert.match(css, /@media\(prefers-reduced-motion:no-preference\)\{\s*#robot-setup-run/u);
});

test('the next mission is always the first one with stars left, until every star is earned', () => {
  let p = emptyProgress();
  assert.equal(nextMission(p).id, 'first');
  p = run(p, 'plan_completed', { metres: 40 }).progress;
  assert.equal(nextMission(p).id, 'garage');
  const all = { ...emptyProgress(), firstRun: true, robots: ['a', 'b', 'c', 'd', 'e'], bestCut: 5, spot: true, street: true, before: true, own: true };
  assert.equal(totalStars(all), TOTAL_STARS);
  assert.equal(nextMission(all), null);
});
