/** Display recorded Z-up physics snapshots. This renderer never advances a model. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CYAN = 0x68eaff, VIOLET = 0x947cff, PINK = 0xff81c4;
const point = value => Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite);
const points = value => Array.isArray(value) ? value.filter(point) : [];

function canvasFallback(container) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  canvas.setAttribute('aria-label', 'Recorded whip physics, projected in two dimensions');
  container.appendChild(canvas);
  let frame = null, trail = [], mode = 'front';
  function draw() {
    const width = container.clientWidth || 700, height = container.clientHeight || 440, ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio; canvas.style.width = '100%'; canvas.style.height = '100%';
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = '#0b1520'; context.fillRect(0, 0, width, height);
    const scale = Math.min(width / 4.8, height / 3.8), project = p => [width * .35 + p[0] * scale, height * .8 - (mode === 'top' ? p[1] : p[2]) * scale];
    context.lineWidth = 1; context.strokeStyle = '#213341';
    for (let i = -5; i <= 8; i++) { context.beginPath(); context.moveTo(width * .35 + i * scale * .4, 0); context.lineTo(width * .35 + i * scale * .4, height); context.stroke(); }
    for (let i = 0; i < 10; i++) { context.beginPath(); context.moveTo(0, height * .8 - i * scale * .4); context.lineTo(width, height * .8 - i * scale * .4); context.stroke(); }
    function line(list, color, weight) { if (!list.length) return; context.strokeStyle = color; context.lineWidth = weight; context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath(); list.forEach((p, index) => { const [x, y] = project(p); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke(); }
    if (frame) {
      line(trail, '#947cff70', 2); line(points(frame.arm), '#d7e0eb', 18); line(points(frame.rope), '#68eaff', 4);
      if (point(frame.target)) { const [x, y] = project(frame.target); context.strokeStyle = '#ff81c4'; context.lineWidth = 2; context.beginPath(); context.arc(x, y, (frame.targetRadius || .13) * scale, 0, Math.PI * 2); context.stroke(); }
    }
    context.fillStyle = '#8a9caf'; context.font = '11px system-ui'; context.fillText('2D view · same recorded physics', 18, 26);
  }
  const observer = new ResizeObserver(draw); observer.observe(container); draw();
  return { available: true, mode: 'canvas', setFrame(next, options = {}) { frame = next; trail = points(options.trail); draw(); }, setCamera(next) { mode = next; draw(); }, resize: draw, dispose() { observer.disconnect(); canvas.remove(); } };
}

export function create(container) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true }); }
  catch { return canvasFallback(container); }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x0b1520); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement; canvas.setAttribute('aria-label', 'Three-dimensional recorded whip physics. Drag to orbit and scroll to zoom.'); canvas.setAttribute('role', 'img'); canvas.tabIndex = 0;
  container.appendChild(canvas);
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x0b1520, 7, 18);
  const camera = new THREE.PerspectiveCamera(39, 1, .02, 50); camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = false; controls.minDistance = 2; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * .92;
  controls.target.set(.55, 0, .85);
  scene.add(new THREE.HemisphereLight(0xc4edff, 0x28334b, 2.8));
  const key = new THREE.DirectionalLight(0xe4f5ff, 4); key.position.set(-3, -4, 7); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 4; key.shadow.camera.bottom = -4; key.shadow.normalBias = .025; scene.add(key);
  const accent = new THREE.PointLight(VIOLET, 16, 8); accent.position.set(0, 2, 2); scene.add(accent);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x111f2c, roughness: .9, metalness: .08 })); floor.position.z = -.018; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(14, 35, 0x375263, 0x1d3342); grid.rotation.x = Math.PI / 2; grid.position.z = -.012; scene.add(grid);
  const armGroup = new THREE.Group(), ropeGroup = new THREE.Group(); scene.add(armGroup, ropeGroup);
  const armMaterial = new THREE.MeshStandardMaterial({ color: 0xd7e0eb, metalness: .3, roughness: .28 });
  const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x1e3043, metalness: .45, roughness: .4 });
  const ropeMaterial = new THREE.MeshStandardMaterial({ color: CYAN, emissive: 0x09333b, emissiveIntensity: .7, metalness: .2, roughness: .4 });
  const armSegments = [], joints = [], ropeSegments = [];
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12), sphere = new THREE.SphereGeometry(1, 16, 10);
  const pedestal = new THREE.Group(); scene.add(pedestal);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.29, .35, .12, 32), jointMaterial); base.rotation.x = Math.PI / 2; base.position.z = .06; base.castShadow = true; pedestal.add(base);
  const column = new THREE.Mesh(cylinder, armMaterial); column.rotation.x = Math.PI / 2; column.castShadow = true; pedestal.add(column); pedestal.visible = false;
  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(.26, .009, 8, 48), new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: .5 })); baseRing.position.z = .125; pedestal.add(baseRing);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(.035, 16, 10), new THREE.MeshStandardMaterial({ color: 0xe4fcff, emissive: CYAN, emissiveIntensity: .4 })); scene.add(tip); tip.visible = false;
  const target = new THREE.Group(); scene.add(target); target.visible = false;
  target.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: PINK, wireframe: true, transparent: true, opacity: .35 })));
  const targetRing = new THREE.Mesh(new THREE.TorusGeometry(1, .025, 8, 60), new THREE.MeshBasicMaterial({ color: PINK })); target.add(targetRing);
  const center = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), new THREE.MeshBasicMaterial({ color: PINK })); target.add(center);
  const trailGeometry = new THREE.BufferGeometry(), trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: VIOLET, transparent: true, opacity: .65 })); scene.add(trail);
  const up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), direction = new THREE.Vector3();
  let disposed = false;
  function draw() { if (!disposed) { targetRing.quaternion.copy(camera.quaternion); renderer.render(scene, camera); } }
  function resize() { if (disposed) return; const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight || 440); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); draw(); }
  function segments(group, pool, positions, material, radius) {
    while (pool.length < Math.max(0, positions.length - 1)) { const mesh = new THREE.Mesh(cylinder, material); mesh.castShadow = true; group.add(mesh); pool.push(mesh); }
    pool.forEach((mesh, index) => {
      mesh.visible = index < positions.length - 1;
      if (!mesh.visible) return;
      a.fromArray(positions[index]); b.fromArray(positions[index + 1]); direction.subVectors(b, a); const length = direction.length();
      if (length < 1e-8) { mesh.visible = false; return; }
      mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(up, direction.normalize()); const r = radius(index, positions.length); mesh.scale.set(r, Math.max(.001, length), r);
    });
  }
  function setFrame(frame, options = {}) {
    if (disposed || !frame) return;
    const arm = points(frame.arm), rope = points(frame.rope);
    pedestal.visible = arm.length > 0;
    if (arm.length) { pedestal.position.set(arm[0][0], arm[0][1], 0); const height = Math.max(.01, arm[0][2] - .12); column.position.z = .12 + height / 2; column.scale.set(.13, height, .13); }
    segments(armGroup, armSegments, arm, armMaterial, index => Math.max(.065, .14 - index * .025));
    while (joints.length < arm.length) { const mesh = new THREE.Mesh(sphere, jointMaterial); armGroup.add(mesh); joints.push(mesh); }
    joints.forEach((mesh, index) => { mesh.visible = index < arm.length; if (mesh.visible) { mesh.position.fromArray(arm[index]); mesh.scale.setScalar(index === 0 ? .19 : Math.max(.08, .15 - index * .015)); } });
    segments(ropeGroup, ropeSegments, rope, ropeMaterial, () => Math.max(.008, options.ropeRadius || .00635));
    tip.visible = rope.length > 0; if (tip.visible) tip.position.fromArray(rope[rope.length - 1]);
    target.visible = point(frame.target);
    if (target.visible) { target.position.fromArray(frame.target); target.scale.setScalar(frame.targetRadius || options.targetRadius || .13); targetRing.quaternion.copy(camera.quaternion); }
    trailGeometry.setFromPoints(points(options.trail).slice(-350).map(p => new THREE.Vector3(...p)));
    draw();
  }
  function setCamera(mode = 'orbit') {
    controls.target.set(.55, 0, .85);
    if (mode === 'top') camera.position.set(.55, -.001, 7);
    else if (mode === 'front') camera.position.set(.55, -7, 1.7);
    else camera.position.set(2.5, -3.6, 2.8);
    controls.update(); targetRing.quaternion.copy(camera.quaternion); draw();
  }
  controls.addEventListener('change', draw); const observer = new ResizeObserver(resize); observer.observe(container);
  setCamera(); resize();
  function dispose() {
    if (disposed) return; disposed = true; observer.disconnect(); controls.removeEventListener('change', draw); controls.dispose();
    const geometries = new Set(), materials = new Set(); scene.traverse(child => { if (child.geometry) geometries.add(child.geometry); if (child.material) materials.add(child.material); });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
  }
  return { available: true, mode: 'three', setFrame, setCamera, resize, dispose };
}

if (typeof window !== 'undefined') window.BrainSNNDeformableRenderer = Object.freeze({ create });
