#!/usr/bin/env node
/** Reconstruction artifacts -> a proposed, unreviewed World v1 planning map, using the same code as
 * World Builder's Real → sim card. For pipelines that call the worker API directly.
 *
 *   node scripts/world-propose-map.mjs --points sparse-preview.ply --evidence reconstruction.json --out world.json
 *     [--report proposal.json] [--camera-height 1.35 | --measure "ax,ay,az;bx,by,bz;metres"] [--robot-height 1.9] [--name text]
 *
 * Scale: --measure when given, else the worker's estimated scale (reconstruction.json scale_estimate) when present, else the
 * phone height (--camera-height forces it). The map keeps scaleReviewed/mapReviewed false. Import it into World Builder and review scale and obstacles
 * before planning or exporting to Arena / OpenUSD; this tool never marks a map reviewed. */
import {parseArgs} from 'node:util';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseVisualAsset,MAX_FILE_BYTES} from '../public/world/visual-geometry.mjs';
import {proposeWorld,PROPOSAL} from '../public/world/reconstruction-map.mjs';

const USAGE='Usage: world-propose-map --points <points.ply|.splat> --evidence <reconstruction.json> --out <world.json> [--report <proposal.json>] [--camera-height <m> | --measure "ax,ay,az;bx,by,bz;metres"] [--robot-height <m>] [--name <text>]';
const MAX_EVIDENCE_BYTES=32*1024**2;

/** "ax,ay,az;bx,by,bz;metres": two points in the reconstruction's own coordinates and the distance measured between them. */
export function parseMeasure(text){
  const parts=String(text).split(';').map(s=>s.trim());
  const point=s=>{const v=s.split(',').map(Number);if(v.length!==3||!v.every(Number.isFinite))throw new Error('--measure points must be three comma-separated numbers each.');return v;};
  if(parts.length!==3)throw new Error('--measure must be "ax,ay,az;bx,by,bz;metres".');
  return {a:point(parts[0]),b:point(parts[1]),distance:Number(parts[2])};
}

async function readInput(path,limit){
  const info=await stat(path);
  if(!info.isFile()||info.size>limit)throw new Error(`${basename(path)} must be a regular file up to ${limit/1024**2} MiB.`);
  const bytes=await readFile(path);
  return {bytes,receipt:{file:basename(path),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
}

export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,strict:true,options:{points:{type:'string'},evidence:{type:'string'},out:{type:'string'},report:{type:'string'},
    'camera-height':{type:'string'},measure:{type:'string'},'robot-height':{type:'string'},name:{type:'string'},help:{type:'boolean'}}});
  if(values.help){console.log(USAGE);return null;}
  if(!values.points||!values.evidence||!values.out)throw new Error(USAGE);
  if(values.measure&&values['camera-height'])throw new Error('Use either --measure or --camera-height, not both.');
  const points=await readInput(values.points,MAX_FILE_BYTES),evidence=await readInput(values.evidence,MAX_EVIDENCE_BYTES);
  const visual=parseVisualAsset(points.bytes.buffer.slice(points.bytes.byteOffset,points.bytes.byteOffset+points.bytes.length),values.points);
  let reconstruction;try{reconstruction=JSON.parse(evidence.bytes.toString('utf8'));}catch{throw new Error(`${evidence.receipt.file} is not JSON.`);}
  const {world,report}=proposeWorld({points:visual.points,reconstruction,name:values.name||`Proposed map / ${points.receipt.file}`,
    cameraHeight:values['camera-height']===undefined?PROPOSAL.cameraHeight:Number(values['camera-height']),
    robotHeight:values['robot-height']===undefined?PROPOSAL.robotHeight:Number(values['robot-height']),
    measurement:values.measure?parseMeasure(values.measure):null,
    // The worker's estimated scale is used unless a phone height is given on purpose; a measurement replaces both.
    useEstimate:values['camera-height']===undefined});
  // The receipts tie the map to the exact artifacts; compare them with the worker's manifest SHA-256 values.
  const full={...report,inputs:{points:points.receipt,evidence:{...evidence.receipt,pipeline:String(reconstruction.pipeline||'unknown')}},tool:'brainsnn world-propose-map'};
  await writeFile(values.out,JSON.stringify(world,null,2)+'\n');
  if(values.report)await writeFile(values.report,JSON.stringify(full,null,2)+'\n');
  console.log(`Proposed ${world.width} × ${world.depth} m map from ${report.cameras} cameras and ${report.points.toLocaleString('en')} points `+
    `(${report.scaleSource==='measured-pair'?`measured ${report.measurement.distance} m scale`:report.scaleSource==='estimated-metric-depth'?`estimated scale, 1 unit ≈ ${report.metresPerUnit.toFixed(3)} m, not measured`:`assumed ${report.assumedCameraHeight} m phone height`}): `+
    `${report.area.free} m² free, ${report.area.obstacle} m² obstacles, ${report.area.unknown} m² unknown. Unreviewed: review scale and obstacles in World Builder before planning.`);
  return full;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
