/** Record the showroom's route pairs using the same MuJoCo engine as the playground. */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, readFile, rename, rm, rmdir, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createShowroomExample, MAX_SHOWROOM_BYTES, parseShowroomBundle} from '../../brainsnn-r3f-app/public/world/showroom-model.mjs';
import {buildShowroomEpisodeScene, runShowroomEpisode} from '../../brainsnn-r3f-app/public/world/showroom-episode-physics.mjs';
import {makeShowroomEpisodeUSD} from '../../brainsnn-r3f-app/public/world/showroom-episode-usd.mjs';

const {values} = parseArgs({options:{room:{type:'string'},out:{type:'string'}}});
if (!values.out) throw Error('Use --out <new directory> and optionally --room <showroom.json>.');
let input;
if (values.room) {
  if ((await stat(values.room)).size > MAX_SHOWROOM_BYTES) throw Error('Room exceeds the showroom file limit.');
  input = await readFile(values.room);
}
const room = parseShowroomBundle(input ? JSON.parse(input) : createShowroomExample());
const pairs = [room.routes, ...(room.comparisons ?? [])].filter(Boolean);
if (!pairs.length) throw Error('The room needs a recorded route comparison.');
const requireApp = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const {default:loadMuJoCo} = await import(pathToFileURL(requireApp.resolve('@mujoco/mujoco')));
const physics = await loadMuJoCo();
const out = resolve(values.out);
await mkdir(dirname(out), {recursive:true});
const temp = await mkdtemp(join(dirname(out), '.showroom-run-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const runs = [];
  for (const [index, pair] of pairs.entries()) {
    for (const variant of ['before','after']) {
      const scene = buildShowroomEpisodeScene(room, {objectId:pair.objectId, variant});
      const episode = await runShowroomEpisode(physics, scene);
      const prefix = 'route-' + (index + 1) + '-' + variant;
      const files = [[prefix+'.episode.json',JSON.stringify(episode)], [prefix+'.xml',episode.modelXML], [prefix+'.usda',makeShowroomEpisodeUSD(episode)]];
      const hashes = {};
      for (const [name,content] of files) {
        await writeFile(join(temp,name),content);
        hashes[name] = digest(content);
      }
      runs.push({objectId:pair.objectId,variant,sceneSha256:episode.sceneSha256,samples:episode.frames.length,score:episode.score,files:hashes});
    }
  }
  await writeFile(join(temp,'runs.json'),JSON.stringify({schema:'brainsnn.showroom-run-set.v1',
    source:input ? basename(values.room) : 'Authored practice room',inputSha256:input ? digest(input) : null,runs},null,2)+'\n');
  // Claim the name without replacing an existing directory, including an empty one.
  await mkdir(out);
  try { await rename(temp,out); }
  catch (error) { await rmdir(out).catch(()=>{}); throw error; }
  console.log('Saved', runs.length, 'runs in', out);
} finally {
  await rm(temp,{recursive:true,force:true});
}
