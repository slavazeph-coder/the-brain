// Plan the robot route on a compiled scene with the site's own code: worldFromScene, then planWorld (vacuum preset).
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [sceneFile, out, worldDir] = process.argv.slice(2);
// The site's modules, from a directory given relative to where the command runs.
const load = name => import(pathToFileURL(resolve(worldDir, name)).href);
const {worldFromScene} = await load('scene-preview.mjs');
const {planWorld, ROBOTS} = await load('core.mjs');
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
const {world, counts, summary} = worldFromScene(scene, 'Scene map');
const floor = scene.objects.find(o => o.name === 'floor_observed');
// Scripted review flags demonstrate the planner; they are not a person's acceptance.
Object.assign(world, {scaleReviewed: true, mapReviewed: true});
const robot = {...ROBOTS.vacuum, margin: 0.1};
const result = planWorld(world, robot);
writeFileSync(out, JSON.stringify({summary, counts, origin: [floor.min[0], floor.min[2]], world: {width: world.width, depth: world.depth, start: world.start, objects: world.objects}, route: result.route, distance: result.distance, travelSeconds: result.travelSeconds, reachableArea: result.reachableArea, cell: result.cell,
  provenance: {sceneSha256: createHash('sha256').update(readFileSync(sceneFile)).digest('hex'), robot,
    automatedReviewFlags: true, humanAccepted: false, physicalRobotValidated: false, basis: 'planar planning preview'}}));
console.log(summary, '\nroute points', result.route.length, 'distance', result.distance.toFixed(1), 'm', 'area', result.reachableArea.toFixed(2), 'm2', 'start', JSON.stringify(world.start), 'size', world.width, world.depth);
