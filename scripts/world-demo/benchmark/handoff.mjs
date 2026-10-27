// The site's own hand-off for a reconstruction PLY: toArenaCloud, as the browser exports it after a measured distance.
// usage: node handoff.mjs <ply> <out.json> <metresPerUnit> <world dir> <colmap | right-handed-y-up> [<distance> <span>]
// With metresPerUnit 1 and no distance, the hand-off stays in reconstruction units (the order and framing are the same).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [ply, out, k, worldDir, frame, distance, span] = process.argv.slice(2);
if (!['colmap', 'right-handed-y-up'].includes(frame)) throw Error('usage: node handoff.mjs <ply> <out.json> <metresPerUnit> <world dir> <colmap | right-handed-y-up> [<distance> <span>]');
const { parsePLY, toArenaCloud } = await import(pathToFileURL(resolve(worldDir, 'visual-geometry.mjs')).href);
const buf = readFileSync(ply), { points } = parsePLY(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const metric = Number(k) !== 1 || distance !== undefined;
const cloud = toArenaCloud(points, { coordinateFrame: frame, source: basename(ply),
  ...(metric ? { metresPerUnit: Number(k), measurement: { distance: Number(distance), span: Number(span) } } : {}) });
cloud.multiView = true;
writeFileSync(out, JSON.stringify(cloud));
console.log(JSON.stringify({ points: cloud.points.length, provenance: cloud.provenance }));
