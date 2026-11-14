/** Pinned, local IFC extraction. No upload, origin recentering or inferred scale. */
import * as WebIFC from 'web-ifc';
import {sha256,MAX_PRIOR_BYTES,MAX_COMPONENTS,validatePrior,footprintHull} from '../../public/world/asbuilt-core.mjs';
const val=x=>x&&typeof x==='object'&&'value' in x?x.value:x;
function unitScale(api,id){
  const projects=api.GetLineIDsWithType(id,WebIFC.IFCPROJECT);if(projects.size()!==1)throw Error('One IFC project with explicit units is required.');
  const project=api.GetLine(id,projects.get(0)),units=api.GetLine(id,val(project.UnitsInContext))?.Units??[],length=units.map(u=>api.GetLine(id,val(u))).filter(u=>val(u.UnitType)==='LENGTHUNIT');
  if(length.length!==1)throw Error('Declare exactly one IFC length unit; units are never assumed.');
  function scale(u,depth=0){
    if(depth>4)throw Error('Unsupported cyclic IFC unit definition.');
    if(u.type===WebIFC.IFCSIUNIT){const prefixes={EXA:1e18,PETA:1e15,TERA:1e12,GIGA:1e9,MEGA:1e6,KILO:1e3,HECTO:1e2,DECA:10,DECI:.1,CENTI:.01,MILLI:.001,MICRO:1e-6,NANO:1e-9};const prefix=val(u.Prefix);if(val(u.Name)!=='METRE'||prefix&&!Object.hasOwn(prefixes,prefix))throw Error('Unsupported IFC length unit.');return prefix?prefixes[prefix]:1;}
    if(u.type===WebIFC.IFCCONVERSIONBASEDUNIT){const f=api.GetLine(id,val(u.ConversionFactor));return val(f.ValueComponent)*scale(api.GetLine(id,val(f.UnitComponent)),depth+1);}
    throw Error('Unsupported IFC length unit.');
  }
  const result=scale(length[0]);if(!Number.isFinite(result)||result<1e-9||result>1e6)throw Error('Invalid IFC unit scale.');return result;
}
function provenance(api,id){
  const map=new Map(),relations=api.GetLineIDsWithType(id,WebIFC.IFCRELDEFINESBYPROPERTIES);
  if(relations.size()>100000)throw Error('IFC relationship limit exceeded.');
  for(let i=0;i<relations.size();i++){
    const r=api.GetLine(id,relations.get(i)),p=api.GetLine(id,val(r.RelatingPropertyDefinition));if(val(p?.Name)!=='Pset_BrainSNN')continue;
    const props={};for(const h of p.HasProperties??[]){const property=api.GetLine(id,val(h));props[val(property.Name)]=val(property.NominalValue);}
    for(const item of r.RelatedObjects??[])map.set(val(item),props);
  }return map;
}
export async function readIfcPrior(bytes,wasmPath,options={}){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_PRIOR_BYTES)throw Error('Choose an IFC under 16 MiB.');
  const sourceSha256=await sha256(bytes),api=options.api??new WebIFC.IfcAPI();let id;
  try{
    if(wasmPath)api.SetWasmPath(wasmPath,true);await api.Init();
    id=api.OpenModel(bytes,{COORDINATE_TO_ORIGIN:false,ALLOW_INCOMPATIBLE_SCHEMA_ALIASES:false,MEMORY_LIMIT:512*1024*1024});
    if(!api.IsModelOpen(id))throw Error('IFC could not be opened.');
    const nativeLengthScale=unitScale(api,id),props=provenance(api,id),elements=[],skipped=[],represented=[],ids=api.GetLineIDsWithType(id,WebIFC.IFCELEMENT,true);let vertices=0;
    if(ids.size()>100000)throw Error('IFC element limit exceeded.');
    for(let i=0;i<ids.size();i++){const e=api.GetLine(id,ids.get(i));if(e.Representation)represented.push({id:e.expressID,globalId:val(e.GlobalId)});}
    if(represented.length>MAX_COMPONENTS)throw Error('Use an IFC slice with at most 1024 represented elements.');
    api.StreamAllMeshes(id,mesh=>{
      if(!api.IsIfcElement(api.GetLineType(id,mesh.expressID)))return;
      if(elements.length>=MAX_COMPONENTS)throw Error('Use an IFC slice with at most 1024 represented elements.');
      const line=api.GetLine(id,mesh.expressID),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],footprint=[];
      for(let i=0;i<mesh.geometries.size();i++){
        const placed=mesh.geometries.get(i),geometry=api.GetGeometry(id,placed.geometryExpressID);
        try{
          const array=api.GetVertexArray(geometry.GetVertexData(),geometry.GetVertexDataSize()),m=placed.flatTransformation;vertices+=array.length/6;if(vertices>2000000)throw Error('IFC exceeds two million preview vertices.');
          for(let at=0;at<array.length;at+=6){
            // web-ifc emits SI geometry in its right-handed Y-up render frame.
            const p=[0,1,2].map(j=>m[j]*array[at]+m[4+j]*array[at+1]+m[8+j]*array[at+2]+m[12+j]);
            footprint.push([p[0],p[2]]);
            p.forEach((n,j)=>{if(!Number.isFinite(n)||Math.abs(n)>1e7)throw Error('IFC coordinates exceed the review range.');min[j]=Math.min(min[j],n);max[j]=Math.max(max[j],n);});
          }
        }finally{geometry.delete();}
      }
      const globalId=val(line.GlobalId),p=props.get(mesh.expressID)??{};
      if(!min.every(Number.isFinite)){skipped.push({globalId,reason:'No preview geometry.'});return;}
      const name=String(val(line.Name)||globalId).slice(0,160);
      const footprintXZ=footprintHull(footprint);if(footprintXZ.length>2048)throw Error('IFC footprint exceeds the bounded review complexity.');
      elements.push({globalId,expressId:mesh.expressID,name,ifcClass:api.GetNameFromTypeCode(line.type).replace(/^IFC/, 'Ifc').replace(/BUILDINGELEMENTPROXY$/,'BuildingElementProxy'),componentId:p.ComponentId??null,provenance:p.Provenance??null,min,max,footprintXZ});
    });
    // Schema API returns uppercase names. Canonical names are used only as declared semantics.
    const names={IFCWALL:'IfcWall',IFCWALLSTANDARDCASE:'IfcWallStandardCase',IFCSLAB:'IfcSlab',IFCDOOR:'IfcDoor',IFCWINDOW:'IfcWindow',IFCFURNITURE:'IfcFurniture',IFCFURNISHINGELEMENT:'IfcFurnishingElement',IFCBUILDINGELEMENTPROXY:'IfcBuildingElementProxy',IFCOPENINGELEMENT:'IfcOpeningElement'};
    for(const e of elements){const type=api.GetNameFromTypeCode(api.GetLineType(id,e.expressId));e.ifcClass=names[type]??type;}
    for(const e of represented)if(!elements.some(row=>row.expressId===e.id)&&!skipped.some(row=>row.globalId===e.globalId))skipped.push({globalId:e.globalId,reason:'Represented element has no preview geometry.'});
    elements.sort((a,b)=>a.globalId.localeCompare(b.globalId));
    const result={schema:'brainsnn.ifc-prior.v1',sourceSha256,ifcSchema:api.GetModelSchema(id),nativeLengthScale,units:'m',coordinateFrame:'right-handed-y-up',geometry:'world-axis-aligned-bounds',elements,skipped};
    return validatePrior(result);
  }finally{if(id!==undefined&&api.IsModelOpen(id))api.CloseModel(id);api.Dispose();}
}
