/** Simulation scene preview: a worker's scene.glb in the same-site mesh viewer, described only by its own scene.json. */
export const SCENE_PREVIEW_BYTES = 50 * 1024 ** 2;
export const SCENE_SCHEMA = 'brainsnn.scene.v1';

const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;

/** Facts from scene.json, one per line. Missing or malformed fields are reported as unknown, never guessed. */
export function sceneFacts(scene) {
  if (!scene || typeof scene !== 'object' || scene.schema !== SCENE_SCHEMA)
    return ['No valid scene.json came with this scene, so its provenance and scale are unknown. Treat it as a picture only.'];
  const c = scene.counts && typeof scene.counts === 'object' ? scene.counts : {};
  const [points, walls, objects, unplaced, unknown] = ['points', 'walls', 'objects', 'unplaced', 'unknown_cells'].map(k => count(c[k]));
  const facts = [];
  facts.push(points === null || walls === null ? 'Observed: counts not recorded.'
    : `Observed: ${plural(points, 'reconstructed point')}, the floor and ${plural(walls, 'wall')}.`);
  if (objects === null) facts.push('Detected: not recorded.');
  else facts.push(`Detected: ${objects ? plural(objects, 'object') + ' placed from 2D detections' : 'no objects placed'}${unplaced ? `, ${unplaced.toLocaleString('en')} left unplaced` : ''}.`);
  facts.push(unknown === null ? 'Unknown space: not recorded.' : `Unknown: ${plural(unknown, 'floor cell')} no point reached, kept as a tagged volume, never free space.`);
  facts.push(scene.units === 'm' ? 'Units: metres, from a measured scale.'
    : scene.units === 'arbitrary' ? 'Units: arbitrary reconstruction units. No measured scale, so sizes are relative.' : 'Units: not recorded.');
  const usd = scene.usd && typeof scene.usd === 'object' ? scene.usd : null;
  // Worker jobs cannot carry a measured scale yet, so point to the metric export the site already has instead of the compiler's advice.
  facts.push(usd?.written === true ? 'scene.usda was written for Isaac Sim (metersPerUnit = 1).'
    : usd?.written === false && scene.units === 'arbitrary' ? 'No scene.usda: Isaac Sim reads USD in metres and this scene has no measured scale. For a metric OpenUSD file, measure a known distance on the reconstruction, review the map, then use Export static OpenUSD.'
    : usd?.written === false ? `No scene.usda. ${typeof usd.reason === 'string' ? usd.reason.slice(0, 300) : ''}`.trim()
    : 'USD status was not recorded.');
  return facts;
}
