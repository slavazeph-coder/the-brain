/** Simulation scene preview: a worker's scene.glb in the same-site mesh viewer, described only by its own scene.json. */
import { SCHEMA as WORLD_SCHEMA, LIMITS, normalizeWorld } from './core.mjs';

export const SCENE_PREVIEW_BYTES = 50 * 1024 ** 2;
export const SCENE_SCHEMA = 'brainsnn.scene.v1';

const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
const metres = v => Number.isFinite(v) && v > 0 && v < 1000;
/** "Object 1: 3.41 × 1.26 m, 0.73 m high" from a separated object's size [length, height, width]. */
function measured(o) {
  const name = o.label && o.label !== 'object' ? o.label : String(o.name || 'object').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  return `${name.slice(0, 40)}: ${o.size[0].toFixed(2)} × ${o.size[2].toFixed(2)} m, ${o.size[1].toFixed(2)} m high`;
}

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
  const scale = scene.scale && typeof scene.scale === 'object' ? scene.scale : null;
  facts.push(scene.units === 'm' ? (scale?.selfReported === true
      ? `Units: metres, from an entered distance${Number.isFinite(scale.distance) ? ` (${scale.distance} m)` : ''}. Self-reported, not verified.`
      : 'Units: metres, from the scale recorded in this scene.')
    : scene.units === 'arbitrary' ? 'Units: arbitrary reconstruction units. No measured scale, so sizes are relative.' : 'Units: not recorded.');
  const usd = scene.usd && typeof scene.usd === 'object' ? scene.usd : null;
  // A video job has no measured scale, so point to the site's metric routes instead of the compiler's advice.
  facts.push(usd?.written === true ? 'scene.usda was written for Isaac Sim (metersPerUnit = 1).'
    : usd?.written === false && scene.units === 'arbitrary' ? 'No scene.usda: Isaac Sim reads USD in metres and this scene has no measured scale. Measure a known distance on the reconstruction, then build a metric simulation scene there, or review the map and use Export static OpenUSD.'
    : usd?.written === false ? `No scene.usda. ${typeof usd.reason === 'string' ? usd.reason.slice(0, 300) : ''}`.trim()
    : 'USD status was not recorded.');
  if (scene.ifc && typeof scene.ifc === 'object' && scene.ifc.written === true)
    facts.push('scene.ifc was written for BIM tools (IFC4, metres), with each element\'s provenance in Pset_BrainSNN.');
  const separation = scene.separation && typeof scene.separation === 'object' ? scene.separation : null, separated = count(c.separated);
  if (separation?.done === true && separated !== null) {
    const largest = (Array.isArray(scene.objects) ? scene.objects : [])
      .filter(o => o && o.kind === 'separated' && Array.isArray(o.size) && o.size.length === 3 && o.size.every(metres)).slice(0, 3);
    facts.push(separated ? `Separated: ${plural(separated, 'object')} from the points, each measured as an oriented box in metres${largest.length ? `. Largest: ${largest.map(measured).join('; ')}` : ''}.`
      : 'Separated: no clusters of points stand above the floor apart from walls.');
  } else if (separation?.done === false) facts.push('Separated: none, because object sizes need a measured scale.');
  const naming = scene.naming && typeof scene.naming === 'object' ? scene.naming : null, named = count(naming?.named);
  if (naming && named !== null) facts.push(`Named: ${plural(named, 'object')} by ${typeof naming.model === 'string' ? naming.model.slice(0, 60) : 'a vision model'} from the walkthrough frames. Suggestions, not reviewed.`);
  const elements = [...(Array.isArray(scene.objects) ? scene.objects : []), ...(Array.isArray(scene.walls) ? scene.walls : [])].filter(o => o && typeof o === 'object');
  const inferred = elements.filter(o => o.kind === 'separated' && o.base === 'inferred').length;
  if (inferred) facts.push(`Inferred: ${plural(inferred, 'object')} ${inferred === 1 ? 'stands' : 'stand'} on the floor, though the floor under ${inferred === 1 ? 'it' : 'them'} went unseen. Check against the walkthrough.`);
  // The worker's fit check: how closely the boxes follow the points (fit-check.json has every element).
  const fit = scene.fit && typeof scene.fit === 'object' ? scene.fit : null;
  if (scene.units === 'm' && fit && Number.isFinite(fit.within_5cm) && fit.within_5cm >= 0 && fit.within_5cm <= 1) {  // centimetres need metres
    const kinds = [['floor', 'floor'], ['wall', 'walls'], ['object', 'objects']].filter(([k]) => Number.isFinite(fit.by_kind?.[k]?.median_cm))
      .map(([k, word]) => `${word} ${fit.by_kind[k].median_cm.toFixed(1)} cm`);
    const misfits = (Array.isArray(fit.misfits) ? fit.misfits : []).filter(n => typeof n === 'string').slice(0, 4)
      .map(n => { const o = elements.find(e => e.name === n); return o?.label && o.label !== 'object' ? String(o.label).slice(0, 40) : title(n); });
    facts.push(`Fit: ${Math.round(fit.within_5cm * 100)}% of points within 5 cm of the model${kinds.length ? ` (median ${kinds.join(', ')})` : ''}`
      + `${misfits.length ? `; flagged for review: ${misfits.join(', ')}` : ''}. Model to points, not a survey.`);
  }
  return facts;
}

const triple = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const title = name => String(name || 'object').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).slice(0, 60);
// A box with a centre and size is oriented by its yaw (none: axis-aligned); one with only min/max is axis-aligned.
const oriented = o => triple(o.centre) && triple(o.size) && (Number.isFinite(o.yaw_degrees) || !(triple(o.min) && triple(o.max)));
const turned = o => oriented(o) && Number.isFinite(o.yaw_degrees) && Math.abs(Math.sin(2 * o.yaw_degrees * Math.PI / 180)) > .05;
/** Floor-plan boxes that together contain a scene element, never smaller than it. An oriented box (centre, size
 * [length, height, width], yaw about the vertical) is cut into `strips` pieces along its length and each piece's
 * axis-aligned box is kept, so a diagonal object blocks little more than itself; a detected object keeps its min/max. */
function footprints(o, strips = 1) {
  if (oriented(o)) {
    const a = (Number.isFinite(o.yaw_degrees) ? o.yaw_degrees : 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), [length, , width] = o.size, top = o.centre[1] + o.size[1] / 2;
    const hx = Math.abs(width * s) / 2, hz = Math.abs(width * c) / 2;
    return Array.from({ length: strips }, (_, i) => {
      const t0 = length * (i / strips - .5), t1 = length * ((i + 1) / strips - .5);
      const xs = [t0 * c, t1 * c].map(v => o.centre[0] + v), zs = [t0 * s, t1 * s].map(v => o.centre[2] + v);
      return { x0: Math.min(...xs) - hx, x1: Math.max(...xs) + hx, z0: Math.min(...zs) - hz, z1: Math.max(...zs) + hz, top };
    });
  }
  return triple(o.min) && triple(o.max) ? [{ x0: o.min[0], x1: o.max[0], z0: o.min[2], z1: o.max[2], top: o.max[1] }] : [];
}
/** Unknown floor cells [x, z, size] merged into runs along x, row by row. */
function unknownRuns(cells) {
  const valid = (Array.isArray(cells) ? cells : []).filter(u => Array.isArray(u) && u.length === 3 && u.every(Number.isFinite) && u[2] > 0)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]), runs = [];
  for (const [x, z, c] of valid) {
    const last = runs.at(-1);
    if (last && last.z0 === z && last.c === c && Math.abs(last.x1 - x) < 1e-6) last.x1 = x + c;
    else runs.push({ x0: x, x1: x + c, z0: z, z1: z + c, c });
  }
  return runs;
}
/** Reviewed voids are an explicit scene edit. Reject malformed/stale host snapshots rather than guessing a gap. */
function checkedOpenings(scene, walls) {
  const openings = scene.openings ?? [];
  if (!Array.isArray(openings) || openings.length > 32) throw new Error('Invalid reviewed openings in this scene.');
  const ids = new Set();
  for (const o of openings) {
    const wall = walls.find(w => w?.name === o?.hostWall);
    if (!o || typeof o.id !== 'string' || ids.has(o.id) || !wall || !triple(wall.centre) || !triple(wall.size)
      || o.reviewed !== true || !['opening', 'door'].includes(o.kind)
      || !triple(o.host?.centre) || !triple(o.host?.size)
      || !Number.isFinite(o.host?.yaw_degrees)
      || !['offsetMeters', 'widthMeters', 'heightMeters', 'sillMeters'].every(k => Number.isFinite(o[k]))
      || o.offsetMeters < 0 || o.sillMeters < 0 || o.widthMeters <= 0 || o.heightMeters <= 0
      || o.offsetMeters + o.widthMeters > wall.size[0] + 1e-8 || o.sillMeters + o.heightMeters > wall.size[1] + 1e-8
      || wall.centre.some((v, i) => v !== o.host.centre[i]) || wall.size.some((v, i) => v !== o.host.size[i])
      || (wall.yaw_degrees ?? 0) !== o.host.yaw_degrees) throw new Error('The reviewed opening or its host changed. Review and rebuild the BIM scene.');
    ids.add(o.id);
  }
  for (let i = 0; i < openings.length; i++) for (const b of openings.slice(i + 1)) {
    const a = openings[i];
    if (a.hostWall === b.hostWall && Math.min(a.offsetMeters + a.widthMeters, b.offsetMeters + b.widthMeters) - Math.max(a.offsetMeters, b.offsetMeters) > 1e-9
      && Math.min(a.sillMeters + a.heightMeters, b.sillMeters + b.heightMeters) - Math.max(a.sillMeters, b.sillMeters) > 1e-9)
      throw new Error('Reviewed openings overlap. Review and rebuild the BIM scene.');
  }
  return openings;
}
function wallPlanParts(wall, openings, floor) {
  if (!triple(wall?.centre) || !triple(wall?.size)) return [wall];
  const [length, height] = wall.size, base = wall.centre[1] - height / 2;
  const cuts = openings.filter(o => o.hostWall === wall.name && o.kind === 'opening'
    && base + o.sillMeters <= floor + .02 && base + o.sillMeters + o.heightMeters >= floor + 2)
    .map(o => [o.offsetMeters, o.offsetMeters + o.widthMeters]).sort((a, b) => a[0] - b[0]);
  if (!cuts.length) return [wall];
  const angle = (wall.yaw_degrees ?? 0) * Math.PI / 180, parts = []; let cursor = 0;
  for (const [start, end] of [...cuts, [length, length]]) {
    if (start - cursor > 1e-8) {
      const t = (cursor + start - length) / 2;
      parts.push({...wall, centre: [wall.centre[0] + t * Math.cos(angle), wall.centre[1], wall.centre[2] + t * Math.sin(angle)], size: [start - cursor, height, wall.size[2]]});
    }
    cursor = Math.max(cursor, end);
  }
  return parts;
}
/** The free point farthest from every box and the floor's edge, on a grid of at most about 20,000 points. */
function openest(objects, width, depth) {
  const step = Math.max(.1, Math.sqrt(width * depth / 20000));
  let best = { x: width / 2, z: depth / 2 }, clearance = -Infinity;
  for (let z = step / 2; z < depth; z += step) for (let x = step / 2; x < width; x += step) {
    let c = Math.min(x, z, width - x, depth - z);
    for (const o of objects) {
      c = Math.min(c, Math.hypot(Math.max(o.x - x, 0, x - o.x - o.w), Math.max(o.z - z, 0, z - o.z - o.d)));
      if (c <= clearance) break;
    }
    if (c > clearance) { clearance = c; best = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }; }
  }
  return best;
}

/** A metric scene.json -> an unreviewed World v1 planning map in the scene's own frame, shifted so the observed floor
 * starts at 0, 0. Walls and separated or detected objects are obstacles (the boxes around them); floor cells no point
 * reached are unknown; the rest of the observed floor is proposed as free and still needs review. */
export function worldFromScene(scene, name = 'Scene map') {
  if (!scene || typeof scene !== 'object' || scene.schema !== SCENE_SCHEMA) throw new Error('No valid scene.json came with this scene, so it cannot become a planning map.');
  if (scene.units !== 'm') throw new Error('A planning map needs a metric scene. Measure a known distance on the reconstruction, then build the scene again.');
  const objects = Array.isArray(scene.objects) ? scene.objects : [], walls = Array.isArray(scene.walls) ? scene.walls : [];
  const floor = objects.find(o => o?.name === 'floor_observed'), extent = floor && footprints(floor)[0];
  if (!extent || !Number.isFinite(scene.floor_y)) throw new Error('This scene has no observed floor, so free space cannot be proposed.');
  const openings = checkedOpenings(scene, walls);
  const cm = v => Math.round(v * 100) / 100, width = cm(extent.x1 - extent.x0), depth = cm(extent.z1 - extent.z0);
  // Round outwards to whole centimetres and clip to the floor, so a box never shrinks below the element it stands for.
  const down = v => Math.floor(v * 100 + 1e-6) / 100, up = v => Math.ceil(v * 100 - 1e-6) / 100;  // tolerant of float noise
  const place = (b, extra) => {
    const x0 = Math.max(0, down(b.x0 - extent.x0)), x1 = Math.min(width, up(b.x1 - extent.x0));
    const z0 = Math.max(0, down(b.z0 - extent.z0)), z1 = Math.min(depth, up(b.z1 - extent.z0));
    return x1 - x0 >= .02 && z1 - z0 >= .02 ? { ...extra, x: x0, z: z0, w: cm(x1 - x0), d: cm(z1 - z0) } : null;
  };
  const height = b => Math.min(20, Math.max(.02, cm(b.top - scene.floor_y)));
  const elements = [...walls.map((o, i) => o && { o, pieces: wallPlanParts(o, openings, scene.floor_y), id: `wall-${i + 1}`, name: title(o.name || `wall_${i + 1}`), count: 'walls', note: 'Observed wall: boxes around its oriented box. Reviewed floor openings need at least 2 m of headroom; closed reference doors stay blocked.' }),
    ...objects.map((o, i) => o && o !== floor && o.provenance !== 'detected-unplaced' && { o, id: `object-${i}`,
      name: o.label && o.label !== 'object' ? String(o.label).slice(0, 60) : title(o.name), count: o.kind === 'separated' ? 'separated' : 'detected',
      note: o.kind === 'separated' ? 'Separated from the points: boxes around its measured oriented box. Objects that touch stay one.' : 'Placed from a 2D detection and its supporting points.' })]
    .filter(e => e && footprints(e.o).length);
  const runs = unknownRuns(scene.unknown);
  // Diagonal elements share what is left of the object budget as strips, at most four each.
  const diagonal = elements.filter(e => turned(e.o)).length, spare = LIMITS.objects - elements.length - runs.length;
  const strips = diagonal && spare > 0 ? Math.min(4, 1 + Math.floor(spare / diagonal)) : 1;
  const counts = { walls: 0, separated: 0, detected: 0, unknown: 0, outside: 0 }, placed = [];
  for (const e of elements) {
    const boxes = (e.pieces || [e.o]).flatMap(p => footprints(p, turned(p) ? strips : 1));
    const parts = boxes.map((b, k, all) => place(b, { id: all.length > 1 ? `${e.id}-${k + 1}` : e.id,
      name: all.length > 1 ? `${e.name} (part ${k + 1} of ${all.length})` : e.name, kind: 'obstacle', h: height(b), note: e.note })).filter(Boolean);
    if (parts.length) { placed.push(...parts); counts[e.count]++; } else counts.outside++;
  }
  runs.forEach((u, i) => { const r = place(u, { id: `unknown-${i + 1}`, name: `Unobserved area ${i + 1}`, kind: 'unknown', h: .05,
    note: 'No reconstructed point reached this floor area. Blocked until observed or reviewed.' }); if (r) { placed.push(r); counts.unknown++; } });
  if (placed.length > LIMITS.objects) throw new Error(`This scene has ${placed.length} walls, objects and unobserved areas; a planning map holds at most ${LIMITS.objects}.`);
  const self = scene.scale?.selfReported === true;
  const world = normalizeWorld({ schema: WORLD_SCHEMA, name: String(name).slice(0, 120), width, depth, provenance: 'observed', scaleReviewed: false, mapReviewed: false,
    geometrySource: { kind: 'compiled-scene', name: String(scene.source || 'scene.json'), warnings: [
      self ? 'Scale comes from an entered distance, not verified.' : 'Scale comes from the scene and is not verified.',
      'Obstacles are axis-aligned boxes around walls and separated objects (diagonal ones in strips), so they are a little larger than the objects.',
      'Clusters too small or too low to separate are not obstacles: check for low clutter before a robot runs.',
      ...(openings.length ? ['Reviewed openings are planar passage suggestions with a 2 m headroom convention. Robot height, swings and physical clearance are not validated; closed reference doors and elevated voids stay blocked.'] : []),
      'Floor no point reached is unknown; the rest of the observed floor is proposed as free.'] },
    start: openest(placed, width, depth), objects: placed });
  const objectCount = counts.separated + counts.detected;
  const summary = `Map built from the simulation scene: ${plural(counts.walls, 'wall')} and ${plural(objectCount, 'object')} as obstacles, `
    + `${plural(counts.unknown, 'unobserved area')}, ${width} × ${depth} m of observed floor${counts.outside ? ` (${counts.outside} beyond it left out)` : ''}. Review scale and obstacles, then plan.`;
  return { world, counts, summary };
}
