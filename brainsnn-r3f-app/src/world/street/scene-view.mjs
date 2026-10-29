import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SoftwareSceneRenderer } from './software-view.mjs';

// All distances are metres. World axes are X east, Y up, Z minus north.
// Walking/robot yaw 0 faces +Z; positive yaw turns toward +X.
export const SOURCE_COLORS = Object.freeze({
  'municipal-site-plan': '#7abbd0',
  'municipal-lidar-2015': '#89b1c4',
  'lidar-2023': '#97e3c0',
  'authored-assumed': '#d8a96a',
  unknown: '#96a1ac',
});

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const DEFAULT_DETAIL_IDS = ['bldg-130159', 'bldg-130140', 'bldg-130143'];

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function xyz(value, fallback = [0, 0, 0]) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [number(value[0], fallback[0]), number(value[1], fallback[1]), number(value[2], fallback[2])];
  }
  if (value && typeof value === 'object') {
    return [number(value.x, fallback[0]), number(value.y, fallback[1]), number(value.z, fallback[2])];
  }
  return [...fallback];
}

function color(value, fallback = '#c5c0b5') {
  if (Array.isArray(value)) {
    const scale = value.some((v) => number(v) > 1) ? 255 : 1;
    return new THREE.Color().setRGB(
      number(value[0], 0.7) / scale,
      number(value[1], 0.7) / scale,
      number(value[2], 0.7) / scale,
      THREE.SRGBColorSpace,
    );
  }
  try { return new THREE.Color(value || fallback); } catch { return new THREE.Color(fallback); }
}

function jsonCopy(value, fallback = {}) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
}

function mergedObject(original, patch) {
  const result = { ...original, ...patch };
  for (const key of ['transform', 'material', 'metadata', 'collider']) {
    if (patch[key] && typeof patch[key] === 'object') {
      result[key] = { ...(original[key] || {}), ...patch[key] };
    }
  }
  // Also accept simple transform patches from app controls.
  if (patch.position || patch.rotation || patch.scale) {
    result.transform = { ...(result.transform || {}) };
    for (const key of ['position', 'rotation', 'scale']) if (patch[key]) result.transform[key] = patch[key];
  }
  return result;
}

function canvasTexture(draw, width = 512, height = 512, isColor = true) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeTextures() {
  // Procedural surface appearances are authored; these are not site photographs.
  const brick = (bump = false) => canvasTexture((ctx, w, h) => {
    const random = randomGenerator(719);
    ctx.fillStyle = bump ? '#4b4b4b' : '#c5c0b4';
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 5; col++) {
        const x = col * 128 + (row % 2) * 64;
        const y = row * 64;
        const shade = Math.floor(172 + random() * 34);
        ctx.fillStyle = bump ? `rgb(${190 + Math.floor(random() * 18)},${190},${190})` : `rgb(${shade + 23},${shade + 8},${shade - 5})`;
        ctx.fillRect(x + 3, y + 3, 122, 58);
        ctx.fillStyle = bump ? 'rgba(255,255,255,.13)' : 'rgba(255,251,238,.15)';
        ctx.fillRect(x + 4, y + 4, 120, 2);
        ctx.fillStyle = 'rgba(35,31,28,.12)';
        ctx.fillRect(x + 4, y + 59, 120, 2);
      }
    }
    for (let i = 0; i < 10500; i++) {
      ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,.075)' : 'rgba(25,20,16,.07)';
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
  }, 512, 512, !bump);
  const grain = (seed, shade) => canvasTexture((ctx, w, h) => {
    const random = randomGenerator(seed);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 17500; i++) {
      const light = random() > 0.48;
      ctx.fillStyle = light ? 'rgba(255,255,255,.09)' : 'rgba(30,32,28,.09)';
      ctx.fillRect(random() * w, random() * h, random() * 2 + 0.6, random() * 2 + 0.6);
    }
  });
  const glass = canvasTexture((ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w * 0.2, h);
    gradient.addColorStop(0, '#e6eef1');
    gradient.addColorStop(0.4, '#a4bfca');
    gradient.addColorStop(0.62, '#c4d0cd');
    gradient.addColorStop(1, '#647c83');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    ctx.beginPath();
    ctx.moveTo(w * 0.72, 0); ctx.lineTo(w * 0.91, 0);
    ctx.lineTo(w * 0.35, h); ctx.lineTo(w * 0.15, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(244,247,245,.16)';
    ctx.fillRect(0, h * 0.19, w, 2);
  }, 128, 256);
  const textures = { brick: brick(), brickBump: brick(true), concrete: grain(830, '#dddcd6'), asphalt: grain(318, '#b8bdbe'), glass };
  return textures;
}

function materialKind(object) {
  const name = String(object.material?.name || object.material?.type || object.class || '').toLowerCase();
  if (object.class === 'road') return 'asphalt';
  if (/glass|glazing|window/.test(name)) return 'glass';
  if (/brick|masonry/.test(name)) return 'brick';
  if (/asphalt|road/.test(name)) return 'asphalt';
  if (/concrete|sidewalk|curb|pav|step/.test(name)) return 'concrete';
  if (/foliage|leaf|canopy|grass|vegetation/.test(name)) return 'foliage';
  if (/metal|rail|steel|alumin/.test(name)) return 'metal';
  if (/roof/.test(name)) return 'roof';
  if (/wood|trunk|bark/.test(name)) return 'wood';
  return 'plain';
}

function applyMetricUV(geometry, kind) {
  if (kind === 'glass' || kind === 'plain' || kind === 'metal' || kind === 'foliage') return;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal) return;
  const uv = new Float32Array(position.count * 2);
  const spanU = kind === 'brick' ? 1.28 : 2;
  const spanV = kind === 'brick' ? 0.64 : 2;
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (ay > ax && ay > az) { uv[i * 2] = x / spanU; uv[i * 2 + 1] = z / spanV; }
    else if (ax > az) { uv[i * 2] = z / spanU; uv[i * 2 + 1] = y / spanV; }
    else { uv[i * 2] = x / spanU; uv[i * 2 + 1] = y / spanV; }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function makeGeometry(spec = {}) {
  const type = String(spec.type || 'box').toLowerCase();
  let geometry;
  if (type === 'mesh' || type === 'buffer' || type === 'triangles') {
    const positions = spec.positions || spec.vertices;
    if (!positions || positions.length < 9 || positions.length % 3) throw new Error('Mesh positions must contain XYZ triples.');
    if (Array.from(positions).some((v) => !Number.isFinite(Number(v)))) throw new Error('Mesh contains invalid coordinates.');
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const indices = spec.indices || spec.index;
    if (indices?.length) {
      if (indices.length % 3 || Array.from(indices).some((i) => !Number.isInteger(i) || i < 0 || i >= positions.length / 3)) {
        throw new Error('Mesh indices reference invalid triangles.');
      }
      geometry.setIndex(Array.from(indices));
    }
    if (spec.normals?.length === positions.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(spec.normals, 3));
    else geometry.computeVertexNormals();
    if (spec.uvs?.length === (positions.length / 3) * 2) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(spec.uvs, 2));
  } else if (type === 'cylinder') {
    geometry = new THREE.CylinderGeometry(number(spec.radiusTop, spec.radius || 0.25), number(spec.radiusBottom, spec.radius || 0.25), number(spec.height, 1), number(spec.radialSegments, 12));
  } else if (type === 'cone') {
    geometry = new THREE.ConeGeometry(number(spec.radius, 1), number(spec.height, 2), number(spec.radialSegments, 12));
  } else if (type === 'sphere') {
    geometry = new THREE.SphereGeometry(number(spec.radius, 1), 16, 12);
  } else if (type === 'plane') {
    const dimensions = spec.dimensions || spec.size || [1, 1];
    geometry = new THREE.PlaneGeometry(number(dimensions[0], 1), number(dimensions[1], 1));
  } else {
    const dimensions = xyz(spec.dimensions || spec.size, [1, 1, 1]);
    geometry = new THREE.BoxGeometry(...dimensions.map((v) => Math.max(0.002, Math.abs(v))));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Independent canvas renderer. Callbacks are assigned as properties if needed.
 * onSelect(id, object): pointer selection only; select(id) does not call it again.
 * onLook({yaw,pitch}): first-person drag-look; app/physics owns translation.
 * onObjectChange(id, patch, {final}): optional transform gizmo edits.
 */
export class SceneView {
  constructor(canvasOrContainer, sceneData, onSelect = () => {}) {
    this.sceneData = sceneData || {};
    this.onSelect = onSelect;
    this.onLook = null;
    this.onObjectChange = null;
    this.warnings = [];
    this.mode = 'orbit';
    this.selectedId = null;
    this.sourceView = false;
    this.showColliders = false;
    this.records = new Map();
    this._listeners = [];
    this._pickMeshes = [];
    this._layerVisibility = new Map([['context', false]]);
    this._runtimeColliders = null;
    this._disposed = false;
    this._active = true;
    this._transformMode = 'translate';
    this._gizmoDragging = false;
    this._player = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, eyeHeight: 1.65 };
    this._coarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches || false;
    this._ownsCanvas = !(canvasOrContainer instanceof HTMLCanvasElement);
    this.container = this._ownsCanvas ? canvasOrContainer : canvasOrContainer.parentElement;
    this.canvas = this._ownsCanvas ? document.createElement('canvas') : canvasOrContainer;
    if (!this.canvas || !this.container) throw new Error('SceneView requires a canvas or container.');
    if (this._ownsCanvas) this.container.appendChild(this.canvas);
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.canvas.setAttribute('aria-label', 'Interactive 3D street scene. Drag to orbit; scroll or pinch to zoom.');
    this.canvas.tabIndex = 0;

    const contextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' };
    let webglContext = null;
    try { webglContext = this.canvas.getContext('webgl2', contextAttributes); } catch { /* Browser policy can disable WebGL. */ }
    if (webglContext) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: webglContext, ...contextAttributes });
        this.renderMode = 'webgl';
      } catch { /* Continue with the same scene in Canvas2D. */ }
    }
    if (!this.renderer) {
      // A failed/partially initialized WebGL context can lock a canvas's type.
      // Replace it before obtaining Canvas2D; controls are installed afterwards.
      if (webglContext) {
        const replacement = this.canvas.cloneNode(false);
        this.canvas.replaceWith(replacement);
        this.canvas = replacement;
      }
      this.renderer = new SoftwareSceneRenderer({ canvas: this.canvas });
      this.renderMode = 'software';
      this.warnings.push('WebGL is unavailable in this browser; software 3D rendering is active.');
    }
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this._coarsePointer ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dce7eb');
    this.scene.fog = new THREE.Fog('#dce7eb', 150, 420);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.06, 1600);
    this.camera.position.set(25, 20, 30);
    this.camera.up.copy(Y_AXIS);
    this.objects = new THREE.Group();
    this.objects.name = 'BrainSNN_Street_Objects';
    this.scene.add(this.objects);
    this.effects = new THREE.Group();
    this.effects.name = 'Editor_overlays_not_exported';
    this.scene.add(this.effects);
    this._textures = makeTextures();
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    Object.values(this._textures).forEach((texture) => { texture.anisotropy = Math.min(8, maxAnisotropy); });

    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.controls = this.orbit;
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.075;
    this.orbit.minDistance = 1.6;
    this.orbit.maxDistance = 350;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.screenSpacePanning = true;
    this.orbit.rotateSpeed = 0.65;
    this.orbit.zoomSpeed = 0.8;
    this.orbit.panSpeed = 0.8;
    this.orbit.touches.ONE = THREE.TOUCH.ROTATE;
    this.orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    this._makeLighting();
    for (const object of (this.sceneData.objects || [])) {
      if (!object.id || !object.geometry) continue;
      try { this._addObject(object); }
      catch (error) { this.warnings.push(`${object.id}: ${error.message}`); }
    }
    this._makeRobot();
    this._makeRoute();
    this._makeTransformControls();
    this.raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._installInput();
    this._initialCamera();
    const start = this.sceneData.start || this.sceneData.spawn || this.sceneData.playerStart;
    if (start) this.setPlayerPose(start.position ? start : { position: start, yaw: number(start.yaw) });
    this._home = { position: this.camera.position.toArray(), target: this.orbit.target.toArray() };
    this._savedOrbit = jsonCopy(this._home);
    this._resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this._resizeObserver?.observe(this.container);
    this._listen(globalThis, 'resize', () => this.resize());
    this.resize();
    this._render = this._render.bind(this);
    this._raf = requestAnimationFrame(this._render);
  }

  _listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this._listeners.push([target, type, fn, options]);
  }

  _makeLighting() {
    this.scene.add(new THREE.HemisphereLight('#d8eaff', '#b5a183', 1.45));
    this.sun = new THREE.DirectionalLight('#fff1d9', 3.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(this._coarsePointer ? 1024 : 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 45;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight('#dceaff', 0.65);
    fill.position.set(-40, 35, -30);
    this.scene.add(fill);
  }

  _makeMaterial(object) {
    const spec = typeof object.material === 'object' ? object.material : { name: object.material };
    const kind = materialKind({ ...object, material: spec });
    const defaults = {
      brick: '#b47b60', concrete: '#c9c7bd', asphalt: '#646d72', glass: '#c3dce4',
      foliage: '#6d8153', metal: '#48545d', roof: '#596168', wood: '#8b6d50', plain: '#e1d8ca',
    };
    const params = {
      color: color(spec?.color, defaults[kind]),
      roughness: number(spec?.roughness, kind === 'glass' ? 0.23 : kind === 'metal' ? 0.45 : 0.88),
      metalness: number(spec?.metalness, kind === 'glass' ? 0.28 : kind === 'metal' ? 0.38 : 0.02),
      flatShading: !!object.geometry?.flatShading,
      side: THREE.DoubleSide,
    };
    const opacity = Math.min(1, Math.max(0, number(spec?.opacity, 1)));
    if (opacity < 1) { params.opacity = opacity; params.transparent = true; params.depthWrite = opacity >= 0.8; }
    if (kind === 'brick') { params.map = this._textures.brick; params.bumpMap = this._textures.brickBump; params.bumpScale = 0.012; }
    if (kind === 'concrete') { params.map = this._textures.concrete; params.bumpMap = this._textures.concrete; params.bumpScale = 0.005; }
    if (kind === 'asphalt') { params.map = this._textures.asphalt; params.bumpMap = this._textures.asphalt; params.bumpScale = 0.008; }
    if (kind === 'glass') params.map = this._textures.glass;
    const material = new THREE.MeshStandardMaterial(params);
    material.name = spec?.name || kind;
    material.userData = { appearanceSourceStatus: 'authored-assumed', appearanceMethod: 'Procedural material; not a site photograph' };
    return { material, kind };
  }

  _layerFor(object) {
    if (object.layer) return object.layer;
    if (object.metadata?.layer) return object.metadata.layer;
    if (object.class === 'terrain' || object.geometry?.type === 'terrain') return 'terrain';
    const detailIds = this.sceneData.detailBuildingIds || this.sceneData.focusBuildingIds || DEFAULT_DETAIL_IDS;
    if (detailIds.some((id) => object.id === id || object.id.startsWith(`${id}/`))) return 'detail';
    if (object.metadata?.role === 'context' || /building|roof/.test(object.class || '')) return 'context';
    return 'detail';
  }

  _addObject(source) {
    const data = jsonCopy(source);
    const group = new THREE.Group();
    group.name = data.id;
    const { material, kind } = this._makeMaterial(data);
    const geometry = makeGeometry(data.geometry);
    applyMetricUV(geometry, kind);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.label || data.id;
    mesh.castShadow = !['terrain', 'road', 'sidewalk', 'window'].includes(data.class);
    mesh.receiveShadow = data.class !== 'window';
    const extras = {
      id: data.id, parentId: data.parentId || null, label: data.label || data.id,
      class: data.class || 'object', sourceStatus: data.sourceStatus || 'unknown',
      appearanceSourceStatus: 'authored-assumed', metadata: jsonCopy(data.metadata),
      collider: jsonCopy(data.collider, null),
    };
    group.userData = { ...extras };
    mesh.userData = { ...extras };
    group.add(mesh);
    const sourceMaterial = new THREE.MeshStandardMaterial({
      color: SOURCE_COLORS[data.sourceStatus] || SOURCE_COLORS.unknown,
      roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    });
    const record = { id: data.id, data, group, mesh, geometry, material, sourceMaterial, kind, layer: this._layerFor(data), collider: null };
    this.records.set(data.id, record);
    this.objects.add(group);
    if (data.selectable !== false && data.metadata?.selectable !== false) this._pickMeshes.push(mesh);
    this._applyTransform(record);
    this._makeCollider(record);
    this._applyVisibility(record);
    if (this.sourceView) mesh.material = sourceMaterial;
    return record;
  }

  _applyTransform(record) {
    const t = record.data.transform || record.data;
    record.group.position.fromArray(xyz(t.position));
    record.group.rotation.set(...xyz(t.rotation));
    record.group.scale.fromArray(xyz(t.scale, [1, 1, 1]));
    record.group.updateMatrixWorld(true);
  }

  _applyVisibility(record) {
    record.group.visible = record.data.visible !== false && this._layerVisibility.get(record.layer) !== false;
  }

  _makeCollider(record) {
    if (record.collider) {
      record.group.remove(record.collider);
      record.collider.geometry.dispose();
      record.collider.material.dispose();
      record.collider = null;
    }
    const spec = record.data.collider;
    if (!spec || spec.enabled === false) return;
    const edges = new THREE.EdgesGeometry(record.geometry, 16);
    const material = new THREE.LineBasicMaterial({ color: '#36c6de', transparent: true, opacity: 0.85, depthTest: true });
    const lines = new THREE.LineSegments(edges, material);
    lines.name = `${record.id} collision display`;
    lines.userData.editorOnly = true;
    lines.visible = this.showColliders && (!this._runtimeColliders || record.data.class === 'terrain');
    lines.renderOrder = 4;
    record.group.add(lines);
    record.collider = lines;
  }

  _makeRobot() {
    const group = new THREE.Group();
    group.name = 'Demo robot visualization';
    const materials = [
      new THREE.MeshStandardMaterial({ color: '#e9ede9', roughness: 0.43, metalness: 0.2 }),
      new THREE.MeshStandardMaterial({ color: '#243d47', roughness: 0.5, metalness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: '#232b30', roughness: 0.96 }),
      new THREE.MeshStandardMaterial({ color: '#4ce2ca', emissive: '#1a8c80', emissiveIntensity: 0.5, roughness: 0.35 }),
    ];
    const add = (geometry, material, position) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.fromArray(position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.44, 0.2, 0.58), materials[0], [0, 0.25, 0]);
    add(new THREE.BoxGeometry(0.46, 0.09, 0.59), materials[1], [0, 0.15, 0]);
    add(new THREE.BoxGeometry(0.36, 0.025, 0.055), materials[3], [0, 0.34, 0.27]);
    for (const x of [-0.228, 0.228]) {
      for (const z of [-0.18, 0.18]) {
        const wheel = add(new THREE.CylinderGeometry(0.11, 0.11, 0.065, 16), materials[2], [x, 0.115, z]);
        wheel.rotation.z = Math.PI / 2;
      }
    }
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 10), materials[1], [0, 0.45, -0.1]);
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.055, 16), materials[1], [0, 0.575, -0.1]);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.435, 48), new THREE.MeshBasicMaterial({ color: '#62d8c4', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.018;
    ring.visible = false;
    group.add(ring);
    this._robotRing = ring;
    this.robot = group;
    this.robot.visible = false;
    this.effects.add(group);
  }

  _makeRoute() {
    this.route = new THREE.Group();
    this.route.name = 'Navigation preview';
    this.effects.add(this.route);
  }

  _makeTransformControls() {
    this.transformControls = new TransformControls(this.camera, this.canvas);
    this.transformControls.setMode('translate');
    this.transformControls.setSpace('world');
    this.transformControls.setSize(this._coarsePointer ? 1.05 : 0.8);
    this.transformControls.showY = false;
    this.effects.add(this.transformControls.getHelper());
    this._gizmoDragListener = (event) => {
      this._gizmoDragging = event.value;
      this.orbit.enabled = this.mode !== 'firstPerson' && !event.value;
      if (!event.value && this._transformRecord) this._notifyTransform(true);
    };
    this._gizmoChangeListener = () => {
      if (!this._gizmoDragging || !this._transformRecord) return;
      this._notifyTransform(false);
    };
    this.transformControls.addEventListener('dragging-changed', this._gizmoDragListener);
    this.transformControls.addEventListener('objectChange', this._gizmoChangeListener);
  }

  _notifyTransform(final) {
    const record = this._transformRecord;
    if (!record) return;
    const transform = {
      position: record.group.position.toArray(),
      rotation: [record.group.rotation.x, record.group.rotation.y, record.group.rotation.z],
      scale: record.group.scale.toArray(),
    };
    record.data.transform = transform;
    this._updateSelection();
    this.onObjectChange?.(record.id, { transform: jsonCopy(transform) }, { final });
  }

  _syncGizmo() {
    this.transformControls.detach();
    this._transformRecord = null;
    const record = this.records.get(this.selectedId);
    const editable = record && (record.data.class === 'barrier' || record.data.editable === true || record.data.metadata?.editable === true || /barrier/i.test(record.id));
    if (!editable || this.mode === 'firstPerson' || this._transformMode === 'none' || !record.group.visible) return;
    this.transformControls.setMode(this._transformMode);
    this.transformControls.showX = this._transformMode === 'translate';
    this.transformControls.showY = this._transformMode === 'rotate';
    this.transformControls.showZ = this._transformMode === 'translate';
    this.transformControls.attach(record.group);
    this._transformRecord = record;
  }

  _visibleInTree(mesh) {
    let current = mesh;
    while (current) { if (!current.visible) return false; current = current.parent; }
    return true;
  }

  _pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this._pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this._pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this._pickMeshes.filter((mesh) => this._visibleInTree(mesh)), false)[0];
    return hit ? this.records.get(hit.object.userData.id) : null;
  }

  _installInput() {
    this._activePointers = new Map();
    this._listen(this.canvas, 'pointerdown', (event) => {
      this.canvas.focus({ preventScroll: true });
      this._activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this._press = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, multi: this._activePointers.size > 1, gizmo: !!this.transformControls.axis };
      if (this._activePointers.size > 1) this._press.multi = true;
      if (this.mode === 'firstPerson') this.canvas.setPointerCapture(event.pointerId);
    });
    this._listen(this.canvas, 'pointermove', (event) => {
      const press = this._press;
      if (press && press.id === event.pointerId && this._activePointers.has(event.pointerId)) {
        const dx = event.clientX - press.lastX, dy = event.clientY - press.lastY;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press.moved = true;
        if (this._activePointers.size > 1) press.multi = true;
        if (this.mode === 'firstPerson' && !press.multi) {
          this._player.yaw -= dx * 0.004;
          this._player.pitch = THREE.MathUtils.clamp(this._player.pitch - dy * 0.0035, -1.3, 1.3);
          this._applyPlayerCamera();
          this.onLook?.({ yaw: this._player.yaw, pitch: this._player.pitch });
        }
        press.lastX = event.clientX; press.lastY = event.clientY;
      } else if (!this._coarsePointer && !this._gizmoDragging && performance.now() - (this._lastHover || 0) > 60) {
        this._lastHover = performance.now();
        const hit = this._pick(event.clientX, event.clientY);
        this.canvas.style.cursor = hit ? 'pointer' : this.mode === 'firstPerson' ? 'crosshair' : 'grab';
      }
    });
    this._listen(this.canvas, 'pointerup', (event) => {
      const press = this._press;
      this._activePointers.delete(event.pointerId);
      if (press && press.id === event.pointerId && !press.moved && !press.multi && !press.gizmo && !this._gizmoDragging && event.button !== 2) {
        const record = this._pick(event.clientX, event.clientY);
        this.select(record?.id || null);
        this.onSelect?.(record?.id || null, record ? jsonCopy(record.data) : null);
      }
      if (press?.id === event.pointerId) this._press = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    });
    this._listen(this.canvas, 'pointercancel', (event) => {
      this._activePointers.delete(event.pointerId); this._press = null;
    });
    this._listen(this.canvas, 'dblclick', (event) => {
      if (this.mode === 'firstPerson' || this._gizmoDragging) return;
      const record = this._pick(event.clientX, event.clientY);
      if (record) this.focusObject(record.id);
    });
    this._listen(this.canvas, 'contextmenu', (event) => event.preventDefault());
  }

  _initialCamera() {
    const configured = this.sceneData.camera;
    const frontage = this.sceneData.frontage;
    if (frontage?.a && frontage?.b && frontage?.tangent && frontage?.outward) {
      // Look across the street from above the opposing roofline. Derive the
      // direction from the real frontage, rather than shifting any buildings.
      const center = [(frontage.a[0] + frontage.b[0]) / 2, (frontage.a[1] + frontage.b[1]) / 2];
      const tangent = frontage.tangent, outward = frontage.outward;
      const base = number(this.records.get(this.sceneData.mainBuildingId)?.data.metadata?.baseY);
      this.orbit.target.set(center[0] + outward[0] * 4, base + 3, center[1] + outward[1] * 4);
      this.camera.position.set(center[0] + tangent[0] * 10 + outward[0] * 46, base + 44, center[1] + tangent[1] * 10 + outward[1] * 46);
      const rect = this.container.getBoundingClientRect();
      const aspect = rect.width / Math.max(1, rect.height);
      const fit = Math.max(1, 0.98 / Math.max(0.3, aspect));
      this.camera.position.sub(this.orbit.target).multiplyScalar(fit).add(this.orbit.target);
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
    } else if (configured?.position && configured?.target) {
      this.camera.position.fromArray(xyz(configured.position));
      this.orbit.target.fromArray(xyz(configured.target));
    } else {
      const preferred = this.sceneData.mainBuildingId || 'bldg-130159';
      const record = this.records.get(preferred) || [...this.records.values()].find((r) => r.layer === 'detail' && r.data.class === 'building');
      const bounds = record ? new THREE.Box3().setFromObject(record.group) : new THREE.Box3().setFromObject(this.objects);
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 8, 10));
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const distance = THREE.MathUtils.clamp(Math.max(size.x, size.z, size.y) * 2.6, 28, 65);
      const start = this.sceneData.start;
      const s = xyz(start?.position || start, [center.x + 1, center.y, center.z + 1]);
      const direction = new THREE.Vector3(s[0] - center.x, 0, s[2] - center.z);
      if (direction.lengthSq() < 1) direction.set(0.8, 0, 1);
      direction.normalize();
      this.orbit.target.copy(center).add(new THREE.Vector3(0, -size.y * 0.14, 0));
      this.camera.position.copy(this.orbit.target).add(new THREE.Vector3(direction.x * distance, distance * 0.55, direction.z * distance));
    }
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
    this._positionSun(this.orbit.target);
  }

  _positionSun(target) {
    this.sun.position.copy(target).add(new THREE.Vector3(-28, 65, 38));
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }

  select(id) {
    this.selectedId = id && this.records.has(id) ? id : null;
    this._updateSelection();
    this._syncGizmo();
    return this.selectedId ? jsonCopy(this.records.get(this.selectedId).data) : null;
  }

  _updateSelection() {
    if (this.selectionHelper) {
      this.effects.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      this.selectionHelper.material.dispose();
      this.selectionHelper = null;
    }
    const record = this.records.get(this.selectedId);
    if (!record || !record.group.visible) return;
    record.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(record.mesh).expandByScalar(0.035);
    if (box.isEmpty()) return;
    const helper = new THREE.Box3Helper(box, '#ffc876');
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.94;
    helper.renderOrder = 100;
    this.effects.add(helper);
    this.selectionHelper = helper;
  }

  updateObject(id, patch = {}) {
    const record = this.records.get(id);
    if (!record) return false;
    record.data = mergedObject(record.data, jsonCopy(patch));
    if (patch.geometry) {
      const geometry = makeGeometry(record.data.geometry);
      applyMetricUV(geometry, record.kind);
      record.geometry.dispose(); record.geometry = geometry; record.mesh.geometry = geometry;
    }
    if (patch.material) {
      const next = this._makeMaterial(record.data);
      record.material.dispose(); record.material = next.material; record.kind = next.kind;
      applyMetricUV(record.geometry, record.kind);
    }
    if (patch.sourceStatus) record.sourceMaterial.color.set(SOURCE_COLORS[record.data.sourceStatus] || SOURCE_COLORS.unknown);
    record.mesh.material = this.sourceView ? record.sourceMaterial : record.material;
    this._applyTransform(record);
    this._applyVisibility(record);
    if (patch.geometry || patch.collider) this._makeCollider(record);
    const extras = { ...record.mesh.userData, sourceStatus: record.data.sourceStatus, metadata: jsonCopy(record.data.metadata), collider: jsonCopy(record.data.collider, null) };
    record.mesh.userData = extras; record.group.userData = { ...extras };
    if (this.selectedId === id) { this._updateSelection(); if (!this._gizmoDragging) this._syncGizmo(); }
    return true;
  }

  setCameraMode(mode) {
    const next = ['firstPerson', 'first-person', 'walk', 'walking'].includes(mode) ? 'firstPerson' : mode === 'top' ? 'top' : 'orbit';
    if (next === this.mode) return;
    if (this.mode === 'orbit') this._savedOrbit = { position: this.camera.position.toArray(), target: this.orbit.target.toArray() };
    this.mode = next;
    this.orbit.enabled = next !== 'firstPerson';
    this.orbit.enableRotate = next !== 'top';
    this.camera.up.copy(next === 'top' ? new THREE.Vector3(0, 0, -1) : Y_AXIS);
    if (next === 'firstPerson') this._applyPlayerCamera();
    else if (next === 'top') {
      const center = this.orbit.target.clone();
      const altitude = Math.max(25, this.camera.position.distanceTo(center));
      this.camera.position.set(center.x, center.y + altitude, center.z + 0.001);
      this.camera.lookAt(center); this.orbit.update();
    } else {
      this.camera.position.fromArray(this._savedOrbit.position);
      this.orbit.target.fromArray(this._savedOrbit.target);
      this.camera.lookAt(this.orbit.target); this.orbit.update();
    }
    this.canvas.style.cursor = next === 'firstPerson' ? 'crosshair' : 'grab';
    this._syncGizmo();
  }

  setPlayerPose(pose = {}) {
    const p = xyz(pose.position || pose, xyz(this._player.position));
    this._player.position = { x: p[0], y: p[1], z: p[2] };
    this._player.yaw = number(pose.yaw, this._player.yaw);
    this._player.pitch = number(pose.pitch, this._player.pitch);
    this._player.eyeHeight = number(pose.eyeHeight, this._player.eyeHeight);
    if (this.mode === 'firstPerson') this._applyPlayerCamera();
  }

  _applyPlayerCamera() {
    const p = this._player.position;
    this.camera.position.set(p.x, p.y + this._player.eyeHeight, p.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this._player.pitch, this._player.yaw + Math.PI, 0);
    this.camera.updateMatrixWorld();
  }

  getViewPose() { return jsonCopy(this._player); }

  setRobotPose(pose) {
    if (!pose) { this.robot.visible = false; return; }
    const position = xyz(pose.position || pose);
    // The authored lane is slightly above the terrain to avoid coplanar faces.
    // Keep wheels on that visible surface without changing the simulation pose.
    this._supportRaycaster ||= new THREE.Raycaster();
    this._supportMeshes ||= [...this.records.values()].filter((record) => ['road', 'sidewalk'].includes(record.data.class)).map((record) => record.mesh);
    this._supportRaycaster.set(new THREE.Vector3(position[0], position[1] + 1, position[2]), new THREE.Vector3(0, -1, 0));
    this._supportRaycaster.far = 1.35;
    const support = this._supportRaycaster.intersectObjects(this._supportMeshes, false)[0];
    const displayY = support && support.point.y >= position[1] && support.point.y - position[1] < 0.3 ? support.point.y : position[1];
    this.robot.position.set(position[0], displayY, position[2]);
    this.robot.userData = { physicsFeetY: position[1], displaySupportY: displayY, presentationCorrectionOnly: true };
    this.robot.rotation.y = number(pose.yaw);
    this.robot.visible = pose.visible !== false;
  }

  setPath(points = []) {
    while (this.route.children.length) {
      const child = this.route.children[0];
      this.route.remove(child); child.geometry?.dispose(); child.material?.dispose();
    }
    if (!points.length) return;
    const vertices = points.map((p) => new THREE.Vector3(...xyz(p.position || p))).map((p) => p.add(new THREE.Vector3(0, 0.055, 0)));
    if (vertices.length > 1) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), new THREE.LineBasicMaterial({ color: '#26a995', transparent: true, opacity: 0.95, depthTest: false }));
      line.renderOrder = 3;
      this.route.add(line);
    }
    for (const [i, point] of [vertices[0], vertices[vertices.length - 1]].entries()) {
      const marker = new THREE.Mesh(new THREE.RingGeometry(i ? 0.28 : 0.19, i ? 0.39 : 0.27, 40), new THREE.MeshBasicMaterial({ color: i ? '#f6be68' : '#40c3ae', side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
      marker.rotation.x = -Math.PI / 2; marker.position.copy(point); this.route.add(marker);
    }
  }

  setNavigationPath(points) { this.setPath(points); }

  /** Draw the actual browser kinematic proxies supplied by sim.colliders().
   * This replaces object-mesh outlines (terrain retains its grid outline).
   */
  setColliders(snapshot) {
    if (this._runtimeColliders) {
      this.effects.remove(this._runtimeColliders);
      this._runtimeColliders.traverse((child) => {
        child.geometry?.dispose(); child.material?.dispose();
      });
    }
    this._runtimeColliders = null;
    if (!snapshot) { this.setShowColliders(this.showColliders); return; }
    const group = new THREE.Group();
    group.name = 'Actual browser collision proxies';
    group.userData = { editorOnly: true, revision: snapshot.revision };
    const segment = (vertices, a, b) => vertices.push(...a, ...b);
    const addLines = (id, vertices) => {
      if (!vertices.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#31c8df', opacity: 0.88, transparent: true, depthTest: true }));
      lines.name = `Kinematic collider ${id}`;
      lines.userData = { editorOnly: true, colliderId: id };
      lines.renderOrder = 4;
      group.add(lines);
    };
    for (const building of snapshot.buildings || []) {
      const vertices = [];
      const minY = number(building.baseY, number(building.minY));
      const maxY = number(building.maxY, minY + number(building.height, 8));
      for (const polygon of building.polygons || []) {
        for (const ring of [polygon.outer, ...(polygon.holes || [])]) {
          if (!ring || ring.length < 3) continue;
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            segment(vertices, [a[0], minY, a[1]], [b[0], minY, b[1]]);
            segment(vertices, [a[0], maxY, a[1]], [b[0], maxY, b[1]]);
            segment(vertices, [a[0], minY, a[1]], [a[0], maxY, a[1]]);
          }
        }
      }
      addLines(building.id, vertices);
    }
    for (const box of [...(snapshot.barriers || []), ...(snapshot.obstacles || [])]) {
      const vertices = [];
      const halfW = number(box.width, 1) / 2, halfD = number(box.depth, 1) / 2;
      const yaw = number(box.yaw, number(box.yawDegrees) * Math.PI / 180);
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const minY = number(box.baseY, number(box.minY));
      const maxY = number(box.maxY, minY + number(box.height, 1));
      const corners = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]].map(([x, z]) => [number(box.x) + x * cos + z * sin, number(box.z) - x * sin + z * cos]);
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        segment(vertices, [a[0], minY, a[1]], [b[0], minY, b[1]]);
        segment(vertices, [a[0], maxY, a[1]], [b[0], maxY, b[1]]);
        segment(vertices, [a[0], minY, a[1]], [a[0], maxY, a[1]]);
      }
      addLines(box.id, vertices);
    }
    group.visible = this.showColliders;
    this._runtimeColliders = group;
    this.effects.add(group);
    this.setShowColliders(this.showColliders);
  }

  setShowColliders(visible) {
    this.showColliders = !!visible;
    for (const record of this.records.values()) if (record.collider) record.collider.visible = this.showColliders && (!this._runtimeColliders || record.data.class === 'terrain');
    if (this._runtimeColliders) this._runtimeColliders.visible = this.showColliders;
    this._robotRing.visible = this.showColliders;
  }

  setSourceView(enabled) {
    this.sourceView = !!enabled;
    for (const record of this.records.values()) record.mesh.material = this.sourceView ? record.sourceMaterial : record.material;
  }

  setLayerVisible(name, visible) {
    this._layerVisibility.set(name, !!visible);
    for (const record of this.records.values()) if (record.layer === name) this._applyVisibility(record);
    this._updateSelection(); this._syncGizmo();
  }

  setTransformMode(mode) {
    this._transformMode = ['translate', 'rotate'].includes(mode) ? mode : 'none';
    this._syncGizmo();
  }

  focusObject(id) {
    const record = this.records.get(id);
    if (!record) return false;
    if (this.mode === 'firstPerson') this.setCameraMode('orbit');
    const box = new THREE.Box3().setFromObject(record.mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const distance = Math.max(3, Math.max(size.x, size.y, size.z) * 2.1);
    let direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    if (!Number.isFinite(direction.x) || direction.lengthSq() < 0.5) direction.set(0.7, 0.5, 0.7).normalize();
    if (this.mode === 'top') direction.set(0, 1, 0.0001).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.lookAt(center); this.orbit.update(); this._positionSun(center);
    return true;
  }

  resetCamera() {
    this.mode = 'orbit'; this.orbit.enabled = true; this.orbit.enableRotate = true;
    this.camera.up.copy(Y_AXIS);
    this.camera.position.fromArray(this._home.position);
    this.orbit.target.fromArray(this._home.target);
    this._savedOrbit = jsonCopy(this._home);
    this.camera.lookAt(this.orbit.target); this.orbit.update();
    this._positionSun(this.orbit.target); this._syncGizmo();
  }

  async exportGLB() {
    const group = new THREE.Group();
    group.name = 'BrainSNN_Street_Asset';
    group.userData = {
      schema: 'brainsnn.street-asset.export.v1',
      origin: jsonCopy(this.sceneData.origin),
      provenance: jsonCopy(this.sceneData.provenance),
      units: 'metres', axes: { x: 'east', y: 'up', z: 'minus north' },
      appearanceSourceStatus: 'authored-assumed',
      note: 'Current stable scene objects, excluding individually hidden objects. View-layer filters do not remove asset data. Procedural appearances are authored. Editor overlays and preview robot are excluded.',
    };
    const exported = new Map();
    for (const record of this.records.values()) {
      if (record.data.visible === false) continue;
      const object = new THREE.Group();
      object.name = record.id;
      object.position.copy(record.group.position); object.quaternion.copy(record.group.quaternion); object.scale.copy(record.group.scale);
      object.userData = jsonCopy(record.group.userData);
      const mesh = new THREE.Mesh(record.geometry, record.material);
      mesh.name = record.data.label || record.id;
      mesh.userData = jsonCopy(record.mesh.userData);
      object.add(mesh); group.add(object);
      exported.set(record.id, object);
    }
    // Input transforms are explicitly in scene coordinates. attach() preserves
    // world transforms while producing the genuine semantic parent hierarchy.
    group.updateMatrixWorld(true);
    for (const record of this.records.values()) {
      const object = exported.get(record.id);
      const parent = exported.get(record.data.parentId);
      if (object && parent && object !== parent) parent.attach(object);
    }
    group.updateMatrixWorld(true);
    const data = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true, maxTextureSize: 1024 });
    return new Blob([data], { type: 'model/gltf-binary' });
  }

  resize() {
    if (this._disposed || !this._active) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.container.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || this.container.clientHeight || 1));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }

  setActive(active) {
    if (this._disposed) return;
    const next=!!active;
    if(next===this._active)return;
    this._active=next;
    cancelAnimationFrame(this._raf);
    this._raf=0;
    this.orbit.enabled=next&&this.mode!=='firstPerson';
    this.transformControls.enabled=next;
    this._activePointers.clear();this._press=null;
    if(next){this.resize();this._raf=requestAnimationFrame(this._render);}
  }

  _render() {
    if (this._disposed || !this._active) return;
    this._raf = requestAnimationFrame(this._render);
    if (this.mode !== 'firstPerson') this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._resizeObserver?.disconnect();
    for (const [target, type, fn, options] of this._listeners) target.removeEventListener(type, fn, options);
    this.orbit.dispose();
    this.transformControls.removeEventListener('dragging-changed', this._gizmoDragListener);
    this.transformControls.removeEventListener('objectChange', this._gizmoChangeListener);
    this.transformControls.dispose();
    const geometries = new Set(), materials = new Set();
    this.scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
    });
    for (const record of this.records.values()) { materials.add(record.material); materials.add(record.sourceMaterial); }
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    Object.values(this._textures).forEach((texture) => texture.dispose());
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    if (this._ownsCanvas) this.canvas.remove();
  }
}

export default SceneView;
