/** Standalone, deferred Arena renderer. Imported scans are visual references,
 * never silently promoted to collision geometry or policy sensor observations. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { USDAParser } from 'three/addons/loaders/usd/USDAParser.js';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

const MAX_FILE = 50 * 1024 * 1024;
const MAX_EXPANDED = 150 * 1024 * 1024;
const CYAN = 0x68eaff, VIOLET = 0x947cff;
const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const point = p => Array.isArray(p) ? [finite(p[0]), finite(p[1])] :
  p?.position ? point(p.position) : [finite(p?.x), finite(p?.z)];

function imagePixels(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(12) === 0x49484452) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    const type = view.getUint32(12);
    if (type === 0x56503858) { // VP8X
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (type === 0x5650384c && bytes[20] === 0x2f) { // VP8L
      width = 1 + ((bytes[22] & 0x3f) << 8 | bytes[21]);
      height = 1 + ((bytes[24] & 0x0f) << 10 | bytes[23] << 2 | bytes[22] >> 6);
    } else if (type === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    }
  }
  if (!width || !height || width > 8192 || height > 8192)
    throw new Error('Scan images must be PNG, JPEG or WebP with dimensions no larger than 8192 pixels.');
  return width * height;
}

function decodeEmbedded(uri) {
  const encoded = uri.slice(uri.indexOf(',') + 1);
  if (encoded.length > MAX_FILE * 1.4) throw new Error('An embedded scan resource is too large.');
  return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
}

function release(object) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    const list = Array.isArray(child.material) ? child.material : [child.material];
    list.filter(Boolean).forEach(material => {
      materials.add(material);
      Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
    });
  });
  textures.forEach(texture => { texture.source?.data?.close?.(); texture.dispose(); });
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
  object.clear();
}

function validateGLB(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength ||
      view.getUint32(16, true) !== 0x4e4f534a) throw new Error('This is not a valid GLB 2.0 file.');
  const length = view.getUint32(12, true);
  if (length > 8 * 1024 * 1024 || length + 20 > buffer.byteLength) throw new Error('The GLB metadata is too large or incomplete.');
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  if ((data.nodes?.length || 0) > 5000 || (data.images?.length || 0) > 64 ||
      (data.accessors?.length || 0) > 10000) throw new Error('This scan is too complex. Export a simplified GLB.');
  for (const accessor of data.accessors || []) {
    if (!Number.isInteger(accessor.count) || accessor.count < 0 || accessor.count > 3000000)
      throw new Error('This scan has too many vertices. Export a simplified GLB.');
  }
  function check(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'uri' && (typeof entry !== 'string' || !/^data:(?:image\/(?:png|jpeg|webp)|application\/(?:octet-stream|gltf-buffer));base64,/i.test(entry)))
        throw new Error('Use a self-contained GLB with embedded images and buffers. External files are blocked.');
      if (typeof entry === 'object') check(entry);
    }
  }
  check(data);
  if ((data.extensionsRequired || []).some(name => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name)))
    throw new Error('Export this GLB without Draco, Meshopt or KTX compression.');
  let binary = null, offset = 20 + length, pixels = 0;
  while (offset + 8 <= buffer.byteLength) {
    const size = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (offset + 8 + size > buffer.byteLength) throw new Error('The GLB has an incomplete binary section.');
    if (type === 0x004e4942 && !binary) binary = new Uint8Array(buffer, offset + 8, size);
    offset += 8 + size;
  }
  const buffers = new Map();
  for (const image of data.images || []) {
    let bytes;
    if (image.uri) bytes = decodeEmbedded(image.uri);
    else {
      const descriptor = data.bufferViews?.[image.bufferView], index = descriptor?.buffer;
      if (!descriptor || !Number.isInteger(index) || index < 0 || !data.buffers?.[index]) throw new Error('A GLB image buffer is missing.');
      if (!buffers.has(index)) buffers.set(index, data.buffers[index].uri ? decodeEmbedded(data.buffers[index].uri) : index === 0 ? binary : null);
      const source = buffers.get(index), start = descriptor.byteOffset || 0, size = descriptor.byteLength;
      if (!source || !Number.isInteger(start) || start < 0 || !Number.isInteger(size) || size < 1 || start + size > source.length)
        throw new Error('A GLB image buffer is incomplete.');
      bytes = source.subarray(start, start + size);
    }
    pixels += imagePixels(bytes);
    if (pixels > 64000000) throw new Error('This scan has too many texture pixels. Export smaller embedded images.');
  }
  return data;
}

// Check the central directory before fflate allocates expanded ZIP contents.
function validateUSDZ(buffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This USDZ archive is incomplete.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true), total = 0;
  if (!count || count > 512 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0)
    throw new Error('This USDZ archive is too complex. Export a simplified GLB.');
  for (let n = 0; n < count; n++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid USDZ directory.');
    const packed = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
    total += expanded;
    if (expanded > MAX_FILE || total > MAX_EXPANDED || expanded > Math.max(1, packed) * 200)
      throw new Error('The expanded scan exceeds the browser preview limit. Export a simplified GLB.');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset > end) throw new Error('Invalid USDZ directory size.');
}

function parseUSDZ(buffer, urls) {
  validateUSDZ(buffer);
  const files = unzipSync(new Uint8Array(buffer));
  const names = Object.keys(files), assets = Object.create(null), texts = Object.create(null);
  if (!names.length || !/\.usd[ac]?$/i.test(names[0])) throw new Error('The USDZ has no supported root scene. Export a GLB.');
  const parser = new USDAParser();
  let total = 0;
  for (const name of names) {
    total += files[name].length;
    if (total > MAX_EXPANDED || name.length > 500 || name.includes('..') || /^[\\/]|:/.test(name))
      throw new Error('This USDZ has unsupported paths or exceeds the preview limit.');
    if (/\.usd[ac]?$/i.test(name)) {
      const text = strFromU8(files[name]);
      if (text.startsWith('PXR-USDC')) throw new Error('This USDZ uses binary USD. Convert it to a self-contained GLB for this preview.');
      if (!text.startsWith('#usda')) throw new Error('Unsupported USD scene. Export a self-contained GLB.');
      // Three's lightweight USDA parser builds plain objects. Reject inherited
      // keys before it can resolve a user-controlled group against a prototype.
      if (text.length > 8 * 1024 * 1024 || /\b(?:__proto__|prototype|constructor|__defineGetter__|__defineSetter__|hasOwnProperty|__lookupGetter__|__lookupSetter__|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf)\b/.test(text))
        throw new Error('This USD text uses unsupported keys or exceeds the preview limit. Export a simplified GLB.');
      let nesting = 0, objects = 0;
      for (const character of text) {
        if (character === '{') { nesting++; objects++; }
        else if (character === '}') nesting--;
        if (nesting > 48 || nesting < 0 || objects > 5000)
          throw new Error('This USD hierarchy is too complex or malformed. Export a simplified GLB.');
      }
      if (nesting !== 0) throw new Error('This USD hierarchy is incomplete. Export a GLB.');
      texts[name] = text.replace(/@\.\//g, '@');
    }
  }
  for (const [name, text] of Object.entries(texts)) {
    for (const match of text.matchAll(/@([^@]+)@/g)) {
      const path = match[1];
      if (!Object.hasOwn(files, path) || !/\.(?:usd[ac]?|png|jpe?g|webp)$/i.test(path))
        throw new Error('The USDZ references missing or external files. Export a self-contained GLB.');
    }
    assets[name] = parser.parseText(text);
  }
  let pixels = 0;
  for (const name of names) {
    if (/\.(png|jpe?g|webp)$/i.test(name)) {
      pixels += imagePixels(files[name]);
      if (pixels > 64000000) throw new Error('This scan has too many texture pixels. Export smaller embedded images.');
      const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
      const url = URL.createObjectURL(new Blob([files[name]], { type }));
      urls.push(url); assets[name] = url;
    }
  }
  return parser.parse(texts[names[0]], assets);
}

function inspectAsset(object) {
  let meshes = 0, vertices = 0;
  object.traverse(child => {
    if (!child.isMesh) return;
    meshes++;
    vertices += child.geometry?.attributes?.position?.count || 0;
    if (meshes > 5000 || vertices > 3000000) throw new Error('This scan is too complex. Export a simplified GLB.');
    child.castShadow = false; child.receiveShadow = true;
  });
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  if (!meshes || bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) ||
      Math.max(size.x, size.y, size.z) > 100000 || Math.max(size.x, size.y, size.z) < 0.00001)
    throw new Error('The scan contains no usable, finite 3D geometry. Export a GLB with meshes.');
  return { meshes, vertices, bounds, size };
}

async function waitForUSDTextures(object) {
  const textures = new Set();
  object.traverse(child => {
    (Array.isArray(child.material) ? child.material : [child.material]).filter(Boolean).forEach(material => {
      Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
    });
  });
  if (!textures.size) return;
  const started = performance.now();
  while ([...textures].some(texture => !texture.image)) {
    if (performance.now() - started > 5000) throw new Error('A scan texture could not be decoded. Export a GLB with embedded PNG or JPEG images.');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  let pixels = 0;
  for (const texture of textures) {
    const width = texture.image.width || 0, height = texture.image.height || 0;
    pixels += width * height;
    if (width > 8192 || height > 8192 || pixels > 64000000)
      throw new Error('The scan textures are too large for this preview. Export smaller embedded images.');
  }
}

export function create(container, options = {}) {
  if (!container?.appendChild) throw new Error('A canvas container is required.');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true });
  } catch (_) {
    options.onError?.('3D preview needs WebGL. Your map and planning tools are still available.');
    const noop = () => {};
    return { setScene: noop, setRobot: noop, setTrace: noop, setMode: noop, setCamera: noop,
      importAsset: () => Promise.reject(new Error('3D preview is unavailable on this device.')),
      clearAsset: noop, setAssetTransform: noop, setPointCloud: () => { throw new Error('3D preview is unavailable on this device.'); },
      setCoverage: noop, frameAsset: noop, resize: noop, dispose: noop, capture: () => null, available: false };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x080d16, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.domElement.setAttribute('aria-label', 'Interactive site preview. Drag to orbit, scroll to zoom, or select a point on the floor.');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  container.appendChild(renderer.domElement);

  const world = new THREE.Scene();
  world.fog = new THREE.FogExp2(0x080d16, 0.015);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.03, 1500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 0.7; controls.maxDistance = 180;
  controls.enablePan = true;
  const groups = { geometry: new THREE.Group(), reference: new THREE.Group(), route: new THREE.Group(), coverage: new THREE.Group(), robot: new THREE.Group() };
  Object.values(groups).forEach(group => world.add(group));
  world.add(new THREE.HemisphereLight(0xdbeeff, 0x25304d, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 3.0);
  sun.position.set(6, 13, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.normalBias = 0.025;
  world.add(sun); world.add(sun.target);
  const accent = new THREE.PointLight(VIOLET, 35, 30, 2); accent.position.set(-2, 5, -2); world.add(accent);
  const fill = new THREE.PointLight(CYAN, 20, 25, 2); fill.position.set(10, 4, 8); world.add(fill);
  let disposed = false, raf = 0, inView = true, floor, walls, asset = null, assetUrls = [], importGeneration = 0;
  let scene = { width: 12, depth: 8, start: [1, 1], goal: [10, 6], obstacles: [] };
  let currentRobot = { id: 'g1' }, cameraMode = 'orbit', viewMode = 'geometry';
  let trace = [], traceSource = null, traveledLine = null, cursor = 0, heading = 0, pickStart = null;
  const pickables = [], raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.64, metalness: 0.15, ...extra });
  const addBox = (group, size, at, color, extra) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, extra));
    mesh.position.set(...at); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  function ring(at, color, radius = 0.36) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.7, radius, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(at[0], 0.035, at[1]); groups.geometry.add(mesh); return mesh;
  }
  function visible() { return !disposed && !document.hidden && inView && container.getClientRects().length > 0; }
  function draw() {
    raf = 0;
    if (!visible()) return;
    controls.update(); renderer.render(world, camera);
  }
  function requestDraw() { if (!disposed && !raf && visible()) raf = requestAnimationFrame(draw); }
  controls.addEventListener('change', requestDraw);
  function resize() {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight || 440);
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); requestDraw();
  }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  const intersectionObserver = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
    inView = entries[0]?.isIntersecting !== false; if (inView) resize(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }) : null;
  intersectionObserver?.observe(container);
  function visibility() { if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; } else requestDraw(); }
  document.addEventListener('visibilitychange', visibility);

  function setCamera(mode) {
    if (disposed) return;
    cameraMode = ['orbit', 'top', 'robot'].includes(mode) ? mode : 'orbit';
    const w = scene.width, d = scene.depth, span = Math.max(w, d);
    camera.far = 1500; camera.updateProjectionMatrix(); controls.maxDistance = Math.max(180, span * 5);
    controls.enabled = cameraMode !== 'robot';
    if (cameraMode === 'robot') { updateRobotCamera(); return; }
    controls.target.set(w / 2, 0, d / 2);
    camera.up.set(0, 1, 0);
    if (cameraMode === 'top') camera.position.set(w / 2, span * 1.48, d / 2 + 0.001);
    else camera.position.set(w / 2 + span * 0.7, span * 0.9, d / 2 + span * 0.95);
    camera.lookAt(controls.target); controls.update(); requestDraw();
  }
  function updateRobotCamera() {
    if (cameraMode !== 'robot') return;
    const at = groups.robot.position;
    const eye = currentRobot.id === 'g1' ? 1.25 : 0.75;
    camera.position.set(at.x - Math.sin(heading) * 0.08, eye, at.z - Math.cos(heading) * 0.08);
    camera.lookAt(at.x + Math.sin(heading) * 3, eye - 0.15, at.z + Math.cos(heading) * 3);
    requestDraw();
  }
  function applyMode() {
    groups.reference.visible = Boolean(asset) && viewMode !== 'geometry';
    walls.visible = !groups.reference.visible;
    // Collision proxies remain inspectable over imported visual references.
    groups.geometry.traverse(child => {
      if (child.userData.obstacle && child.material) {
        child.material.transparent = groups.reference.visible;
        child.material.opacity = groups.reference.visible ? 0.3 : 1;
        child.material.depthWrite = !groups.reference.visible;
      }
    });
    groups.robot.visible = cameraMode !== 'robot';
    requestDraw();
  }
  function setMode(mode) { viewMode = ['geometry', 'reality', 'robot'].includes(mode) ? mode : 'geometry'; if (mode === 'robot') setCamera('robot'); else if (cameraMode === 'robot') setCamera('orbit'); applyMode(); }
  function setScene(next) {
    if (disposed) return;
    scene = { ...next, width: clamp(finite(next.width, 12), 1, 200), depth: clamp(finite(next.depth, 8), 1, 200) };
    release(groups.geometry); pickables.length = 0;
    const polygon = (next.floor || next.floorpolygon || next.floorPolygon || [[0, 0], [scene.width, 0], [scene.width, scene.depth], [0, scene.depth]]).map(point);
    const shape = new THREE.Shape(); polygon.forEach((p, i) => i ? shape.lineTo(p[0], -p[1]) : shape.moveTo(p[0], -p[1])); shape.closePath();
    floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), material(0x1e2d3b, { roughness: 0.94, metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.floor = true; groups.geometry.add(floor); pickables.push(floor);
    const perimeter = new THREE.BufferGeometry().setFromPoints([...polygon, polygon[0]].map(p => new THREE.Vector3(p[0], 0.012, p[1])));
    groups.geometry.add(new THREE.Line(perimeter, new THREE.LineBasicMaterial({ color: 0x658897 })));
    const gridPoints = [];
    // Clip grid lines to the reviewed polygon, including concave floor plans.
    function intersections(value, axis) {
      const across = 1 - axis, hits = [];
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        if ((a[axis] <= value && b[axis] > value) || (b[axis] <= value && a[axis] > value))
          hits.push(a[across] + (value - a[axis]) / (b[axis] - a[axis]) * (b[across] - a[across]));
      });
      return hits.sort((a, b) => a - b);
    }
    for (let x = 0; x <= scene.width; x++) {
      const hits = intersections(x, 0);
      for (let i = 0; i + 1 < hits.length; i += 2) gridPoints.push(x, 0.015, hits[i], x, 0.015, hits[i + 1]);
    }
    for (let z = 0; z <= scene.depth; z++) {
      const hits = intersections(z, 1);
      for (let i = 0; i + 1 < hits.length; i += 2) gridPoints.push(hits[i], 0.015, z, hits[i + 1], 0.015, z);
    }
    const grid = new THREE.BufferGeometry(); grid.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
    groups.geometry.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: 0x476574, transparent: true, opacity: 0.23 })));
    walls = new THREE.Group(); groups.geometry.add(walls);
    // Low cutaway walls make floor layout legible without hiding the robot.
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const wall = addBox(walls, [length, 0.16, 0.07], [(a[0] + b[0]) / 2, 0.08, (a[1] + b[1]) / 2], 0x364452);
      wall.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    for (const obstacle of (next.obstacles || []).slice(0, 250)) {
      const h = clamp(finite(obstacle.height, 0.85), 0.04, 15);
      const mesh = addBox(groups.geometry,
        [clamp(finite(obstacle.width, 1), 0.02, 200), h, clamp(finite(obstacle.depth, 1), 0.02, 200)],
        [finite(obstacle.x), h / 2 + 0.025, finite(obstacle.z)], obstacle.dynamic ? 0x8070b0 : 0x526b7a);
      mesh.rotation.y = finite(obstacle.rotation); mesh.userData.obstacle = String(obstacle.id || 'obstacle'); pickables.push(mesh);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: obstacle.dynamic ? VIOLET : 0x91abba, transparent: true, opacity: 0.5 }));
      mesh.add(edge);
    }
    if (next.start) ring(point(next.start), CYAN, 0.36);
    if (next.goal) { ring(point(next.goal), VIOLET, 0.42); ring(point(next.goal), VIOLET, 0.16); }
    const span = Math.max(scene.width, scene.depth);
    sun.position.set(scene.width * 0.25, span * 1.1, scene.depth * 0.5);
    sun.target.position.set(scene.width / 2, 0, scene.depth / 2);
    sun.shadow.camera.left = -span; sun.shadow.camera.right = span;
    sun.shadow.camera.top = span; sun.shadow.camera.bottom = -span; sun.shadow.camera.far = span * 4 + 10;
    sun.shadow.camera.updateProjectionMatrix();
    setTrace([], 0); setCoverage(null); setCamera(cameraMode); applyMode();
  }
  function setRobot(robot = {}) {
    if (disposed) return;
    currentRobot = typeof robot === 'string' ? { id: robot } : robot;
    release(groups.robot);
    const humanoid = ['g1', 'h1', 'humanoid'].includes(currentRobot.id) || currentRobot.type === 'humanoid' || currentRobot.kind === 'humanoid';
    if (humanoid) {
      addBox(groups.robot, [0.36, 0.46, 0.24], [0, 0.94, 0], 0xe1e7ee, { metalness: 0.45 });
      addBox(groups.robot, [0.24, 0.2, 0.22], [0, 1.32, 0], 0xe1e7ee);
      addBox(groups.robot, [0.2, 0.065, 0.025], [0, 1.34, 0.12], 0x152435, { emissive: CYAN, emissiveIntensity: 0.36 });
      for (const sign of [-1, 1]) {
        addBox(groups.robot, [0.11, 0.56, 0.13], [sign * 0.28, 0.82, 0], 0x7993a5);
        addBox(groups.robot, [0.14, 0.59, 0.16], [sign * 0.12, 0.37, 0], 0xb6c6d1);
        addBox(groups.robot, [0.17, 0.085, 0.3], [sign * 0.12, 0.055, 0.05], 0x263848);
      }
      addBox(groups.robot, [0.19, 0.08, 0.02], [0, 1.04, 0.13], CYAN, { emissive: CYAN, emissiveIntensity: 0.5 });
      const width = clamp(finite(currentRobot.width, 0.62), 0.2, 3), depth = clamp(finite(currentRobot.depth, 0.35), 0.2, 3);
      const height = clamp(finite(currentRobot.height, 1.42), 0.2, 3);
      const body = new THREE.Group();
      [...groups.robot.children].forEach(child => body.add(child));
      body.scale.set(width / 0.67, height / 1.42, depth / 0.3); groups.robot.add(body);
    } else {
      const w = clamp(finite(currentRobot.width, finite(currentRobot.radius, 0.3) * 2), 0.2, 3);
      const d = clamp(finite(currentRobot.depth, w * 1.25), 0.2, 3);
      const h = clamp(finite(currentRobot.height, 0.7), 0.2, 2);
      addBox(groups.robot, [w, h * 0.8, d], [0, h * 0.48, 0], 0xd4e0e8, { metalness: 0.3 });
      addBox(groups.robot, [w * 0.82, 0.05, d * 0.94], [0, h * 0.87, 0], 0x14293c);
      addBox(groups.robot, [w * 0.66, 0.065, 0.03], [0, h * 0.66, d / 2 + 0.018], CYAN, { emissive: CYAN, emissiveIntensity: 0.7 });
      const lidar = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.17, w * 0.17, 0.09, 24), material(0x273c4c));
      lidar.position.set(0, h * 0.95, 0); groups.robot.add(lidar);
      for (const sign of [-1, 1]) addBox(groups.robot, [0.075, 0.16, d * 0.55], [sign * w * 0.49, 0.12, 0], 0x152231);
    }
    // Same conservative circular envelope as site-core planning, plus its 5 cm clearance.
    const envelope = Math.hypot(finite(currentRobot.width, 0.62), finite(currentRobot.depth, 0.35)) / 2 + 0.05;
    const footprint = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.03, envelope - 0.018), envelope, 64),
      new THREE.MeshBasicMaterial({ color: CYAN, side: THREE.DoubleSide, transparent: true, opacity: 0.64 }));
    footprint.rotation.x = -Math.PI / 2; footprint.position.y = 0.015; groups.robot.add(footprint);
    positionRobot(); requestDraw();
  }
  function positionRobot() {
    const at = trace[cursor] || point(scene.start || [1, 1]);
    const next = trace[cursor + 1] || trace[cursor - 1];
    if (next) heading = cursor + 1 < trace.length ? Math.atan2(next[0] - at[0], next[1] - at[1]) : Math.atan2(at[0] - next[0], at[1] - next[1]);
    groups.robot.position.set(at[0], 0.035, at[1]); groups.robot.rotation.y = heading;
    updateRobotCamera();
  }
  function setTrace(points = [], index = 0) {
    if (disposed) return;
    if (points !== traceSource) {
      traceSource = points; trace = points.slice(0, 20000).map(point); release(groups.route); traveledLine = null;
      if (trace.length > 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints(trace.map(p => new THREE.Vector3(p[0], 0.055, p[1])));
        groups.route.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.34 })));
        const traveled = new THREE.BufferGeometry().setFromPoints(trace.map(p => new THREE.Vector3(p[0], 0.06, p[1])));
        traveledLine = new THREE.Line(traveled, new THREE.LineBasicMaterial({ color: 0xb8fbff }));
        groups.route.add(traveledLine);
      }
    }
    cursor = clamp(Math.floor(finite(index)), 0, Math.max(0, trace.length - 1));
    if (traveledLine) traveledLine.geometry.setDrawRange(0, cursor + 1);
    positionRobot(); requestDraw();
  }
  function clearAsset() {
    importGeneration++;
    release(groups.reference); asset = null; assetUrls.forEach(url => URL.revokeObjectURL(url)); assetUrls = [];
    if (!disposed) applyMode();
  }
  function setCoverage(grid) {
    if (disposed) return;
    release(groups.coverage);
    if (!grid?.covered?.length) { requestDraw(); return; }
    const covered = grid.covered.slice(0, 4096), w = clamp(finite(grid.cellWidth, grid.resolution || 0.25), 0.02, 10);
    const d = clamp(finite(grid.cellDepth, grid.resolution || 0.25), 0.02, 10);
    const geometry = new THREE.PlaneGeometry(w * 0.94, d * 0.94);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.15, depthWrite: false }), covered.length);
    const matrix = new THREE.Matrix4();
    covered.forEach((entry, i) => { const p = point(entry); matrix.makeTranslation(p[0], 0.028, p[1]); mesh.setMatrixAt(i, matrix); });
    mesh.instanceMatrix.needsUpdate = true; groups.coverage.add(mesh); requestDraw();
  }
  function setPointCloud(data) {
    if (disposed) throw new Error('This preview has closed.');
    if (data?.version !== 1 || data?.kind !== 'colmap-sparse-point-cloud' || !Array.isArray(data.points) ||
        !data.points.length || data.points.length > 50000) throw new Error('Unsupported or oversized point cloud.');
    const positions = [], colors = [];
    for (const p of data.points) {
      if (!Array.isArray(p) || p.length !== 6 || !p.every(n => typeof n === 'number' && Number.isFinite(n)) ||
          p.slice(0, 3).some(n => Math.abs(n) > 100000) || p.slice(3).some(n => n < 0 || n > 255))
        throw new Error('The point cloud contains invalid coordinates or colours.');
      positions.push(p[0], p[1], p[2]);
      const color = new THREE.Color(p[3] / 255, p[4] / 255, p[5] / 255).convertSRGBToLinear();
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox, size = bounds.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) < 0.00001) { geometry.dispose(); throw new Error('The point cloud has no spatial extent.'); }
    const dots = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, sizeAttenuation: true }));
    // Arbitrary COLMAP units/orientation remain explicit. Human alignment is required.
    dots.position.sub(bounds.min);
    clearAsset(); asset = new THREE.Group(); asset.add(dots); groups.reference.add(asset); viewMode = 'reality'; applyMode();
    frameAsset();
    return { name: 'Reconstructed sparse cloud', format: 'point-cloud', points: data.points.length,
      dimensions: { width: size.x, height: size.y, depth: size.z }, units: data.units || 'arbitrary',
      coordinateFrame: data.coordinateFrame || 'colmap', visualOnly: true, requiresReview: true,
      alignedBy: 'bounding-box-origin', transform: { scale: 1, x: 0, y: 0, z: 0, rotation: 0 } };
  }
  async function importAsset(file) {
    if (disposed) throw new Error('This preview has closed.');
    if (!file || file.size <= 0 || file.size > MAX_FILE) throw new Error('Choose a GLB or supported USDZ under 50 MB.');
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (!['glb', 'usdz'].includes(extension)) throw new Error('Choose a self-contained GLB or supported USDZ file.');
    const generation = ++importGeneration, urls = [];
    let imported;
    try {
      const data = await file.arrayBuffer();
      if (data.byteLength > MAX_FILE) throw new Error('The scan exceeds 50 MB.');
      if (disposed || generation !== importGeneration) throw new Error('Import cancelled.');
      if (extension === 'glb') {
        validateGLB(data);
        const manager = new THREE.LoadingManager();
        manager.setURLModifier(url => {
          if (/^(blob:|data:(?:image\/(?:png|jpeg|webp)|application\/(?:octet-stream|gltf-buffer));base64,)/i.test(url)) return url;
          throw new Error('External scan resources are blocked. Export a self-contained GLB.');
        });
        const result = await new GLTFLoader(manager).parseAsync(data, '');
        imported = result.scene;
      } else { imported = parseUSDZ(data, urls); await waitForUSDTextures(imported); }
      const inspected = inspectAsset(imported);
      if (disposed || generation !== importGeneration) throw new Error('Import cancelled.');
      // Preserve source orientation and units; only place its lower corner at the map origin.
      imported.position.sub(inspected.bounds.min);
      const wrapper = new THREE.Group(); wrapper.add(imported);
      release(groups.reference); assetUrls.forEach(url => URL.revokeObjectURL(url));
      assetUrls = urls; asset = wrapper; groups.reference.add(wrapper);
      viewMode = 'reality'; applyMode(); frameAsset(); requestDraw();
      return { name: file.name, format: extension, sizeBytes: file.size, meshes: inspected.meshes,
        vertices: inspected.vertices, dimensions: { width: inspected.size.x, height: inspected.size.y, depth: inspected.size.z },
        alignedBy: 'bounding-box-origin', visualOnly: true, transform: { scale: 1, x: 0, y: 0, z: 0, rotation: 0 } };
    } catch (error) {
      if (imported && !groups.reference.getObjectById(imported.id)) release(imported);
      urls.forEach(url => URL.revokeObjectURL(url));
      throw new Error(error?.message || 'Could not read this scan. Export a simplified GLB.');
    }
  }
  function setAssetTransform(transform = {}) {
    if (!asset || disposed) return;
    asset.scale.setScalar(clamp(finite(transform.scale, 1), 0.001, 1000));
    asset.position.set(clamp(finite(transform.x), -1000, 1000), clamp(finite(transform.y), -1000, 1000), clamp(finite(transform.z), -1000, 1000));
    // Radians, matching Three and the UI's explicit degree-to-radian conversion.
    asset.rotation.set(finite(transform.pitch ?? transform.rotationX), finite(transform.rotation), finite(transform.roll ?? transform.rotationZ)); requestDraw();
  }
  function frameAsset() {
    if (!asset || disposed) return;
    const bounds = new THREE.Box3().setFromObject(asset);
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 0.1);
    cameraMode = 'orbit'; controls.enabled = true; controls.target.copy(center);
    camera.far = Math.max(1500, span * 10); camera.updateProjectionMatrix(); controls.maxDistance = Math.max(180, span * 10);
    camera.position.copy(center).add(new THREE.Vector3(span * 0.8, span * 0.65, span * 1.05));
    camera.lookAt(center); controls.update(); applyMode(); requestDraw();
  }
  function pointerDown(event) { pickStart = { x: event.clientX, y: event.clientY, time: performance.now() }; }
  function pointerUp(event) {
    if (!pickStart || event.button !== 0 || performance.now() - pickStart.time > 600 || Math.hypot(event.clientX - pickStart.x, event.clientY - pickStart.y) > 5) { pickStart = null; return; }
    pickStart = null;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return;
    const hit = hits[0];
    if (hit.object.userData.obstacle) options.onSelect?.(hit.object.userData.obstacle);
    // Picking always returns the floor intersection, not an obstacle's top surface.
    const ground = raycaster.intersectObject(floor, false)[0];
    if (ground) options.onPick?.([Math.round(ground.point.x * 100) / 100, Math.round(ground.point.z * 100) / 100]);
  }
  function contextLost(event) { event.preventDefault(); options.onError?.('3D preview paused because the graphics context was lost. Reopen Test your space to restore it.'); }
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  function dispose() {
    if (disposed) return;
    disposed = true; importGeneration++;
    if (raf) cancelAnimationFrame(raf);
    resizeObserver?.disconnect(); intersectionObserver?.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    renderer.domElement.removeEventListener('pointerdown', pointerDown);
    renderer.domElement.removeEventListener('pointerup', pointerUp);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    controls.removeEventListener('change', requestDraw); controls.dispose();
    Object.values(groups).forEach(release); assetUrls.forEach(url => URL.revokeObjectURL(url));
    sun.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  setScene(scene); setRobot(currentRobot); resize();
  return { setScene, setRobot, setTrace, setMode, setCamera: mode => { setCamera(mode); applyMode(); }, importAsset,
    clearAsset, setAssetTransform, setPointCloud, setCoverage, frameAsset, resize, dispose, available: true,
    capture: () => { if (disposed) return null; renderer.render(world, camera); return renderer.domElement.toDataURL('image/png'); } };
}

export const version = 'site-preview-1';

// Loaded by the standalone site's deferred script loader, outside the Vite graph.
if (typeof window !== 'undefined') window.BrainSNNSiteRenderer = Object.freeze({ create, version });
