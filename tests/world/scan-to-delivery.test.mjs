import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {parseVisualAsset} from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';
import {proposeWorld, toMap} from '../../brainsnn-r3f-app/public/world/reconstruction-map.mjs';
import {buildReviewedMapEpisodeScene} from '../../brainsnn-r3f-app/public/world/reviewed-map-episode.mjs';
import {runShowroomEpisode} from '../../brainsnn-r3f-app/public/world/showroom-episode-physics.mjs';
import {room, toColmap} from './fixtures/synthetic-room.mjs';

function gaussianFile(points) {
  const buffer = new ArrayBuffer(points.length * 32);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  for (const [i, point] of points.entries()) {
    const offset = 32 * i;
    for (const [k, value] of [...point, .02, .015, .01].entries()) view.setFloat32(offset + 4 * k, value, true);
    bytes.set([100, 145, 200, 255, 255, 128, 128, 128], offset + 24);
  }
  return buffer;
}

test('saved Gaussian observations require review before they become native cart collisions', async t => {
  // All dimensions and camera poses come from this authored room's ground truth.
  const fixture = room();
  const visual = parseVisualAsset(gaussianFile(fixture.points), 'authored-room.splat');
  const {world, report} = proposeWorld({
    points: visual.points, reconstruction: fixture.reconstruction, name: 'Authored Gaussian room',
    measurement: {a: toColmap([1, 0, 1]), b: toColmap([2, 0, 1]), distance: 1},
  });
  assert.equal(report.scaleSource, 'measured-pair');
  assert.equal(report.scaleVerified, false);
  assert.ok(report.objects.obstacles > 0 && report.objects.unknown > 0);
  const goal = toMap(report.transform, toColmap([1.5, 0, 2.4]));
  const hidden = toMap(report.transform, toColmap([7.3, 0, 5.6]));
  assert.throws(() => buildReviewedMapEpisodeScene(world, goal), /scale/i);
  const scaled = {...world, scaleReviewed: true};
  assert.throws(() => buildReviewedMapEpisodeScene(scaled, goal), /review/i);
  const reviewed = {...scaled, mapReviewed: true};
  assert.throws(() => buildReviewedMapEpisodeScene(reviewed, hidden), /unknown space/);

  const scene = buildReviewedMapEpisodeScene(reviewed, goal);
  assert.equal(scene.objectId, null);
  assert.equal(scene.sourceMap.geometrySource.kind, 'reconstruction-proposal');
  assert.equal(scene.sourceMap.mapReviewed, true);
  assert.equal(scene.sourceMap.scaleReviewed, true);
  assert.equal(scene.obstacles.filter(o => o.kind === 'unknown').length, report.objects.unknown);
  const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
  const {default: loadMuJoCo} = await import(pathToFileURL(require.resolve('@mujoco/mujoco')));
  const engine = await loadMuJoCo();
  const run = await runShowroomEpisode(engine, scene);
  assert.ok(run.score.success && run.score.distanceMeters > 3);
  assert.ok(run.score.finalErrorMeters < .035);
  assert.deepEqual(run.score.contactNames, []);

  // Independent collision check: place the simulated body within a region that the planner rejected.
  const collision = await runShowroomEpisode(engine, {
    ...scene, route: [[hidden.x, hidden.z], [goal.x, goal.z]],
  });
  assert.equal(collision.score.reason, 'contact');
  assert.ok(collision.score.contactNames.some(name => name.startsWith('unknown_')));
  t.diagnostic(JSON.stringify({input: 'authored .splat fixture', points: report.points, cameras: report.cameras,
    scaleSource: report.scaleSource, objects: report.objects, scenario: run.score, blockedProbe: collision.score.contactNames}));
});

test('a cart already at its reviewed destination keeps a zero-length route', () => {
  const world = {schema:'brainsnn.world.v1',name:'Empty room',provenance:'authored',
    width:5, depth:5, objects:[], start:{x:1.05,z:1.05}, scaleReviewed:true,mapReviewed:true};
  const scene = buildReviewedMapEpisodeScene(world, world.start);
  assert.deepEqual(scene.route,[[1.05,1.05],[1.05,1.05]]);
});
