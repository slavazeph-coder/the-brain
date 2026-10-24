import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import * as W from './vendor/web-ifc-api.js';

const CLASSES = [[W.IFCWALL, 'IfcWall', '#abbbc6', 1], [W.IFCSLAB, 'IfcSlab', '#e5e2d9', 1],
  [W.IFCFURNITURE, 'IfcFurniture', '#a855f7', 1], [W.IFCBUILDINGELEMENTPROXY, 'IfcBuildingElementProxy', '#f2b8c2', .55]];
const $ = id => document.getElementById(id), esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const stage = $('stage'), renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio); renderer.setClearColor(0x000000, 0); stage.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, .05, 500), controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 9, 6); scene.add(sun);
const meshes = new Map();
function resize() { const r = stage.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function table(el, rows) { el.innerHTML = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="${typeof v === 'boolean' ? v : ''}">${esc(typeof v === 'number' ? +v.toFixed(3) : v)}</td></tr>`).join(''); }
const value = p => p.NominalValue?.value === undefined ? '' : p.NominalValue.type === 3 ? p.NominalValue.value === 'T' || p.NominalValue.value === true : p.NominalValue.value;
async function brainsnnPset(api, model, id) {
  const sets = await api.properties.getPropertySets(model, id, true);
  return (sets.find(s => s.Name?.value === 'Pset_BrainSNN')?.HasProperties || []).map(p => [p.Name.value, value(p)]);
}
function dimensions(api, model, id) {
  const solid = api.GetLine(model, id, true).Representation?.Representations?.[0]?.Items;
  if (!solid || solid.length !== 1 || !solid[0].SweptArea?.XDim) return solid ? `${solid.length} extruded solids` : '';
  const s = solid[0], d = [s.SweptArea.XDim.value, s.SweptArea.YDim.value, s.Depth.value].map(v => v.toFixed(2));
  return `${d[0]} × ${d[1]} m, ${d[2]} m high`;
}

async function open(file) {
  const api = new W.IfcAPI(); api.SetWasmPath(new URL('./vendor/', location.href).href, true); await api.Init();
  const model = api.OpenModel(new Uint8Array(await file.arrayBuffer()));
  $('schema').textContent = api.GetModelSchema(model); $('file-name').textContent = file.name; $('drop').hidden = true;
  const one = type => { const ids = api.GetLineIDsWithType(model, type); return ids.size() ? api.GetLine(model, ids.get(0)) : null; };
  const tree = [['IfcProject', one(W.IFCPROJECT)], ['IfcSite', one(W.IFCSITE)], ['IfcBuilding', one(W.IFCBUILDING)], ['IfcBuildingStorey', one(W.IFCBUILDINGSTOREY)]];
  $('tree').innerHTML = tree.map(([k, line], i) => `<li style="padding-left:${i * 12}px"><span class="lvl">${k}</span>${esc(line?.Name?.value ?? '—')}</li>`).join('');
  const groups = new Map(), owner = new Map();
  for (const [type, name, colour, opacity] of CLASSES) {
    const ids = api.GetLineIDsWithType(model, type);
    for (let i = 0; i < ids.size(); i++) { const id = ids.get(i); owner.set(id, { name, colour, opacity, label: api.GetLine(model, id).Name?.value ?? `#${id}` }); }
  }
  api.StreamAllMeshes(model, flat => {
    const info = owner.get(flat.expressID); if (!info) return;
    const group = new THREE.Group(); group.userData.id = flat.expressID;
    const material = new THREE.MeshStandardMaterial({ color: info.colour, transparent: info.opacity < 1, opacity: info.opacity, roughness: .8, metalness: 0, emissive: 0x000000, side: THREE.DoubleSide });
    for (let i = 0; i < flat.geometries.size(); i++) {
      const placed = flat.geometries.get(i), geo = api.GetGeometry(model, placed.geometryExpressID);
      const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize()), idx = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
      const g = new THREE.BufferGeometry(), pos = new Float32Array(v.length / 2), nrm = new Float32Array(v.length / 2);
      for (let k = 0, j = 0; k < v.length; k += 6, j += 3) { pos.set(v.subarray(k, k + 3), j); nrm.set(v.subarray(k + 3, k + 6), j); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation));
      const mesh = new THREE.Mesh(g, material); group.add(mesh);
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x0b0b12, transparent: true, opacity: .55 })));
      geo.delete();
    }
    meshes.set(flat.expressID, { group, material }); scene.add(group);
    if (!groups.has(info.name)) groups.set(info.name, []);
    groups.get(info.name).push([flat.expressID, info]);
  });
  const box = new THREE.Box3(); meshes.forEach(({ group }) => box.expandByObject(group));
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3()), span = Math.max(size.x, size.z, 1);
  const grid = new THREE.GridHelper(Math.ceil(span) + 2, Math.ceil(span) + 2, 0x2a6a74, 0x1c2230); grid.position.set(centre.x, box.min.y - .002, centre.z); scene.add(grid);
  $('stamp').textContent = `1 m GRID · MODEL ${size.x.toFixed(2)} × ${size.z.toFixed(2)} m, ${size.y.toFixed(2)} m HIGH · UNITS FROM THE FILE`;
  camera.position.set(centre.x + span * .9, centre.y + span * .75, centre.z + span * 1.05); controls.target.copy(centre); controls.update();
  $('elements').innerHTML = [...groups].map(([name, items]) => `<h2>${esc(name.toUpperCase())} · ${items.length}</h2>` +
    items.map(([id, info]) => `<button class="el" data-id="${id}" aria-pressed="false"><i style="background:${info.colour}"></i>${esc(info.label)}<code>#${id}</code></button>`).join('')).join('');
  document.querySelectorAll('.el').forEach(b => b.onclick = async () => {
    const id = +b.dataset.id;
    document.querySelectorAll('.el').forEach(o => o.setAttribute('aria-pressed', o === b));
    meshes.forEach(({ material }, key) => material.emissive.set(key === id ? 0x007a80 : 0x000000));
    const rows = await brainsnnPset(api, model, id), dims = dimensions(api, model, id);
    table($('pset'), [['IfcClass', owner.get(id).name], ['Name', owner.get(id).label], ...(dims ? [['Geometry', dims]] : []), ...rows]); $('pset-title').hidden = false;
  });
  const project = api.GetLineIDsWithType(model, W.IFCPROJECT).get(0);
  table($('project'), (await brainsnnPset(api, model, project)).filter(([k]) => ['Units', 'ScaleSource', 'MeasuredDistanceMetres', 'SelfReported', 'MetricVerified'].includes(k))); $('project-title').hidden = false;
  window.__ifc = { schema: api.GetModelSchema(model), elements: [...groups].map(([k, v]) => [k, v.length]) };
}
$('file').onchange = e => e.target.files[0] && open(e.target.files[0]).catch(err => { $('drop').hidden = false; $('drop').textContent = 'Could not open: ' + err.message; window.__ifc = { error: err.message }; });
