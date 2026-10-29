/** Serialize the current scene state to real USDA, without a server dependency.
 * No physics engine is executed here. Collider/material values are configured
 * demo assumptions. The stable initial exporter is parse-checked with usd-core.
 */
const quote = (value) => JSON.stringify(String(value ?? ''));
const safe = (value) => String(value).replace(/[^A-Za-z0-9_]/g, '_');
const num = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('USD export requires finite numeric data');
  return String(Math.abs(n) < 1e-10 ? 0 : Math.round(n * 1e7) / 1e7);
};
const tuple = (values) => `(${values.map(num).join(', ')})`;
const tupleArray = (flat) => {
  const result = [];
  for (let i = 0; i < flat.length; i += 3) result.push(tuple(flat.slice(i, i + 3)));
  return `[${result.join(', ')}]`;
};

function meshData(geometry) {
  if (geometry?.type === 'mesh') {
    const positions = Array.from(geometry.positions);
    const indices = Array.from(geometry.indices);
    if (positions.length % 3 || indices.length % 3 || !positions.length) throw new Error('Invalid triangle mesh');
    positions.forEach(num);
    if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= positions.length / 3)) throw new Error('Invalid triangle index');
    return { positions, indices };
  }
  if (geometry?.type === 'box') {
    const [x,y,z] = geometry.dimensions.map((v) => Number(v) / 2);
    if (![x,y,z].every((v) => Number.isFinite(v) && v > 0)) throw new Error('Invalid box');
    return {
      positions: [-x,-y,-z, x,-y,-z, x,y,-z, -x,y,-z, -x,-y,z, x,-y,z, x,y,z, -x,y,z],
      indices: [4,5,6,4,6,7,0,3,2,0,2,1,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5],
    };
  }
  throw new Error(`Unsupported USD geometry: ${geometry?.type}`);
}

function normalsFor({ positions, indices }) {
  const result = [];
  for (let i = 0; i < indices.length; i += 3) {
    const points = indices.slice(i,i+3).map((index) => positions.slice(index*3,index*3+3));
    const a=points[1].map((v,j)=>v-points[0][j]), b=points[2].map((v,j)=>v-points[0][j]);
    const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const length=Math.hypot(...n);
    if (length < 1e-12) throw new Error('Degenerate triangle in USD export');
    const normalized=n.map(v=>v/length);
    result.push(...normalized,...normalized,...normalized);
  }
  return result;
}

function colorOf(material) {
  const color=material?.color;
  if (Array.isArray(color)) return color.slice(0,3).map(v=>Math.min(1,Math.max(0,Number(v))));
  if (typeof color==='string' && /^#[\da-fA-F]{6}$/.test(color)) {
    return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
  }
  return [.6,.6,.6];
}

export function exportSceneUSD(sceneData) {
  if (!Array.isArray(sceneData?.objects) || !sceneData.objects.length) throw new Error('Scene contains no objects');
  const objects=sceneData.objects;
  const byId=new Map(objects.map(o=>[o.id,o]));
  if (byId.size!==objects.length) throw new Error('Stable object IDs must be unique');
  const children=new Map();
  for(const object of objects){
    const parent=byId.has(object.parentId)?object.parentId:null;
    if(!children.has(parent)) children.set(parent,[]);
    children.get(parent).push(object);
  }
  const materialId=new Map(objects.map((o,i)=>[o.id,`m_${i}_${safe(o.id)}`]));
  const out=[`#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    kilogramsPerUnit = 1
    upAxis = "Y"
    customLayerData = {
        string title = ${quote(sceneData.title || 'BrainSNN Street Studio')}
        string origin_json = ${quote(JSON.stringify(sceneData.origin || {}))}
        string provenance = "Reference footprints and 2023 ground with authored demo parts; not registered to video; not current as-built verification."
        string validation = "Serialization only; no Isaac Sim, Unreal, Unity or sensor runtime executed."
    }
)
def Xform "World" {
    def PhysicsScene "PhysicsScene" {
        vector3f physics:gravityDirection = (0, -1, 0)
        float physics:gravityMagnitude = 9.81
    }
    def Scope "Materials" {
        def Material "ConfiguredContact" (
            prepend apiSchemas = ["PhysicsMaterialAPI"]
            customData = { string parameterStatus = "configured test coefficients; unmeasured" }
        ) {
            float physics:staticFriction = 0.7
            float physics:dynamicFriction = 0.55
            float physics:restitution = 0.05
        }`];
  for(const object of objects){
    const id=materialId.get(object.id),m=object.material||{};
    out.push(`        def Material ${quote(id)} {
            token outputs:surface.connect = </World/Materials/${id}/Surface.outputs:surface>
            def Shader "Surface" {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = ${tuple(colorOf(m))}
                float inputs:roughness = ${num(m.roughness ?? .8)}
                float inputs:metallic = ${num(m.metalness ?? 0)}
                token outputs:surface
            }
        }`);
  }
  out.push('    }');
  let emitted=0;
  const active=new Set();
  function emit(object,depth=1){
    if(active.has(object.id)) throw new Error('Object parent cycle');
    active.add(object.id);emitted++;
    const tabs='    '.repeat(depth),name=safe(object.id.split('/').pop());
    const mesh=meshData(object.geometry),normals=normalsFor(mesh);
    const collider=object.collider||{},dynamic=collider.enabled && collider.static===false;
    const apis=['SemanticsLabelsAPI:class','SemanticsLabelsAPI:source_status'];
    if(dynamic) apis.push('PhysicsRigidBodyAPI','PhysicsMassAPI');
    const transform=object.transform||{},position=transform.position||[0,0,0],rotation=transform.rotation||[0,0,0];
    const scale=transform.scale||[1,1,1];
    out.push(`${tabs}def Xform ${quote(name)} (
${tabs}    prepend apiSchemas = [${apis.map(quote).join(', ')}]
${tabs}    customData = {
${tabs}        string stableId = ${quote(object.id)}
${tabs}        string parentId = ${quote(object.parentId)}
${tabs}        string sourceStatus = ${quote(object.sourceStatus)}
${tabs}        string evidence = ${quote(JSON.stringify(object.metadata||{}))}
${tabs}    }
${tabs}) {
${tabs}    token[] semantics:labels:class = [${quote(object.class)}]
${tabs}    token[] semantics:labels:source_status = [${quote(object.sourceStatus)}]
${tabs}    double3 xformOp:translate = ${tuple(position)}
${tabs}    float3 xformOp:rotateXYZ = ${tuple(rotation.map(v=>v*180/Math.PI))}
${tabs}    float3 xformOp:scale = ${tuple(scale)}
${tabs}    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ", "xformOp:scale"]`);
    if(dynamic) out.push(`${tabs}    bool physics:rigidBodyEnabled = true
${tabs}    float physics:mass = ${num(collider.massKg ?? 20)}`);
    const meshApis=['MaterialBindingAPI'];
    if(collider.enabled) meshApis.push('PhysicsCollisionAPI','PhysicsMeshCollisionAPI');
    out.push(`${tabs}    def Mesh "Mesh" (
${tabs}        prepend apiSchemas = [${meshApis.map(quote).join(', ')}]
${tabs}    ) {
${tabs}        point3f[] points = ${tupleArray(mesh.positions)}
${tabs}        int[] faceVertexCounts = [${Array(mesh.indices.length/3).fill(3).join(', ')}]
${tabs}        int[] faceVertexIndices = [${mesh.indices.join(', ')}]
${tabs}        normal3f[] normals = ${tupleArray(normals)} (
${tabs}            interpolation = "faceVarying"
${tabs}        )
${tabs}        uniform token subdivisionScheme = "none"
${tabs}        uniform token orientation = "rightHanded"
${tabs}        token visibility = ${quote(object.visible === false ? 'invisible' : 'inherited')}
${tabs}        rel material:binding = </World/Materials/${materialId.get(object.id)}>`);
    if(collider.enabled) out.push(`${tabs}        bool physics:collisionEnabled = true
${tabs}        uniform token physics:approximation = ${quote(dynamic?'convexHull':'none')}
${tabs}        rel material:binding:physics = </World/Materials/ConfiguredContact>`);
    out.push(`${tabs}    }`);
    for(const child of children.get(object.id)||[]) emit(child,depth+1);
    out.push(`${tabs}}`);active.delete(object.id);
  }
  for(const object of children.get(null)||[]) emit(object);
  if(emitted!==objects.length) throw new Error('Parent cycle or disconnected hierarchy');
  out.push('}');
  return out.join('\n')+'\n';
}

export default exportSceneUSD;
