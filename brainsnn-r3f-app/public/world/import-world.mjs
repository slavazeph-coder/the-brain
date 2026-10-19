/** Reuse Arena's measured-map and RoomPlan parsers; never fill a scan's bounding box. */
import '../arena/site-core.js';
import {SCHEMA,normalizeWorld} from './core.mjs';
const siteCore=globalThis.BrainSNNSiteCore;

export function importWorld(input,fileName=''){
  if(input?.schema===SCHEMA){const world=normalizeWorld(input);world.scaleReviewed=false;world.mapReviewed=false;return world;}
  const scene=input?.schemaVersion===siteCore.SCHEMA?siteCore.normalizeScene(input):siteCore.importRoomPlan(input);
  const warnings=[...scene.source.warnings];
  const objects=scene.obstacles.map(o=>{
    // Arena permits boxes extending across the outer bounds. Their intersection
    // with the bounds is identical for planning inside the preserved polygon.
    const x=Math.max(0,o.x-o.width/2),z=Math.max(0,o.z-o.depth/2);
    const w=Math.min(scene.width,o.x+o.width/2)-x,d=Math.min(scene.depth,o.z+o.depth/2)-z;
    if(w<.02-1e-8||d<.02-1e-8)throw new Error('An imported obstacle is too thin after clipping. Review its dimensions in the source map.');
    return{id:o.id,name:o.label,x,z,w:Math.max(.02,w),d:Math.max(.02,d),h:o.height,kind:'obstacle'};
  });
  warnings.push('The original floor polygon is preserved. Independently check scale, openings, obstacles and the start before planning.');
  return normalizeWorld({schema:SCHEMA,name:scene.name,width:scene.width,depth:scene.depth,floor:scene.floor,objects,
    provenance:scene.source.kind==='generated'?'generated':scene.source.kind==='sample'?'authored':'observed',
    scaleReviewed:false,mapReviewed:false,start:{x:scene.start[0],z:scene.start[1]},
    geometrySource:{...scene.source,name:scene.source.name||fileName,warnings}});
}
