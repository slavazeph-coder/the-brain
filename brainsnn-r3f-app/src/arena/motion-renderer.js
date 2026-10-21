/** Play Reachy Mini recorded moves (SDK format) on the open-source 3D model. Kinematic display only:
 * each frame's head pose, antennas and body yaw become the six Stewart motor angles through the SDK's
 * analytical IK, and the passive linkage follows. No physics, policy or robot connection runs here. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import URDFLoader from 'urdf-loader';
import { calculatePassiveJoints } from './reachy/Kinematics.js';
import { headJoints } from './reachy/StewartIK.js';

const HEAD_JOINTS = ['yaw_body', 'stewart_1', 'stewart_2', 'stewart_3', 'stewart_4', 'stewart_5', 'stewart_6'];
const PASSIVE_JOINTS = [];
for (let i = 1; i <= 7; i += 1) PASSIVE_JOINTS.push(`passive_${i}_x`, `passive_${i}_y`, `passive_${i}_z`);
const LOOP_REST_S = 0.6;
const VIEWS = {
  orbit: { position: [0.46, 0.27, 0.5], target: [0, 0.19, 0] },
  front: { position: [0.64, 0.23, 0], target: [0, 0.19, 0] },
  side: { position: [0, 0.23, 0.64], target: [0, 0.19, 0] },
};

// URDF visual colours by mesh filename, as in the upstream viewer (8bitkick/reachy_mini_3d_web_viz).
function meshColors(urdfText) {
  const doc = new DOMParser().parseFromString(urdfText, 'application/xml'), colors = {};
  doc.querySelectorAll('visual').forEach((visual) => {
    const mesh = visual.querySelector('geometry mesh'), color = visual.querySelector('material color');
    const filename = mesh?.getAttribute('filename'), rgba = color?.getAttribute('rgba');
    if (!filename || !rgba) return;
    const [r, g, b, a] = rgba.split(/\s+/).map(Number);
    colors[filename.split('/').pop()] = { color: new THREE.Color(r, g, b), opacity: a, name: visual.querySelector('material')?.getAttribute('name') };
  });
  return colors;
}

function material(filename, data) {
  const opacity = data?.opacity ?? 1, glass = opacity < 0.4;
  const antenna = filename.includes('antenna_V2') || data?.name === 'antenna_material';
  const result = new THREE.MeshPhysicalMaterial({
    color: antenna || glass ? 0x202020 : (data?.color ?? 0xd9dde3), metalness: 0, roughness: antenna || glass ? 0.05 : 0.7,
    transparent: glass, opacity, side: glass ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (filename.includes('link')) { result.color.setHex(0xffffff); result.metalness = 1; result.roughness = 0.3; }
  if (antenna) { result.clearcoat = 1; result.clearcoatRoughness = 0; }
  return result;
}

async function loadRobot(base) {
  const response = await fetch(base + 'reachy-mini.urdf');
  if (!response.ok) throw new Error('robot_model_unavailable');
  const urdf = await response.text(), colors = meshColors(urdf);
  const draco = new DRACOLoader().setDecoderPath(base + 'draco/');
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  const pending = [];
  const loader = new URDFLoader();
  loader.packages = { assets: base, reachy_mini_description: base };
  loader.workingPath = base;
  loader.loadMeshCb = (path, _manager, done) => {
    const filename = path.split('/').pop();
    pending.push(new Promise((resolve) => {
      gltf.load(base + 'meshes_optimized/' + filename, (asset) => {
        let geometry = null;
        asset.scene.traverse((child) => { if (child.isMesh && !geometry) geometry = child.geometry; });
        const mesh = geometry ? new THREE.Mesh(geometry, material(filename, colors[filename])) : asset.scene;
        mesh.castShadow = true; mesh.receiveShadow = true;
        done(mesh); resolve(true);
      }, undefined, (error) => { done(null, error); resolve(false); });
    }));
  };
  const robot = loader.parse(urdf);
  const loaded = await Promise.all(pending);
  draco.dispose();
  if (!loaded.length || loaded.some((ok) => !ok)) throw new Error('robot_meshes_unavailable');
  robot.rotation.x = -Math.PI / 2;
  const joints = {};
  robot.traverse((child) => { if (child.isURDFJoint) joints[child.name] = child; });
  return { robot, joints };
}

/** Precompute every frame once (IK is the expensive part), holding the last reachable pose like the daemon does. */
export function prepareMove(move) {
  const times = move.time.map((t) => t - move.time[0]);
  let unreachable = 0;
  const frames = move.set_target_data.map((frame) => ({
    pose: frame.head.flat(), joints: headJoints(frame.head, frame.body_yaw ?? 0), antennas: frame.antennas,
  }));
  for (let i = 0; i < frames.length; i += 1) {
    if (!frames[i].joints.some(Number.isNaN)) continue;
    unreachable += 1;
    if (i > 0) frames[i] = frames[i - 1];
  }
  return { times, frames, unreachable, duration: times[times.length - 1] };
}

export async function create(container, { assetBase = './robot/' } = {}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true }); }
  catch { return { available: false }; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x0b1520); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Simulated Reachy Mini playing the selected motion. Drag to orbit and scroll to zoom.');
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x0b1520, 1.1, 2.4);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.22; controls.maxDistance = 1.6; controls.maxPolarAngle = Math.PI * 0.55;
  scene.add(new THREE.HemisphereLight(0xd6f3ff, 0x223044, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1.2, 1.4, 0.9); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -0.4, right: 0.4, top: 0.4, bottom: -0.4, near: 0.1, far: 5 }); key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x947cff, 1.1); rim.position.set(-1.2, 0.8, -1); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x68eaff, 0.45); fill.position.set(-0.6, 0.3, 1.2); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), new THREE.MeshStandardMaterial({ color: 0x101c28, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(1.2, 24, 0x2b4a5c, 0x182a38); grid.position.y = 0.001; scene.add(grid);

  let dirty = true;
  function view(name) {
    const preset = VIEWS[name] || VIEWS.orbit;
    camera.position.set(...preset.position); controls.target.set(...preset.target); controls.update();
    dirty = true;
  }
  view('orbit');
  function resize() {
    const width = container.clientWidth || 640, height = container.clientHeight || 420;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    canvas.style.width = '100%'; canvas.style.height = '100%';
    dirty = true;
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();

  let robot, joints;
  try { ({ robot, joints } = await loadRobot(assetBase)); }
  catch (error) { observer.disconnect(); controls.dispose(); renderer.dispose(); canvas.remove(); throw error; }
  scene.add(robot);

  let clip = null, t0 = performance.now(), pausedAt = null, speed = 1, loop = true, frameIndex = 0, tick = null, raf = 0, disposed = false;
  function apply(frame) {
    frame.joints.forEach((value, index) => joints[HEAD_JOINTS[index]]?.setJointValue(value));
    const passive = calculatePassiveJoints(frame.joints, frame.pose);
    passive.forEach((value, index) => joints[PASSIVE_JOINTS[index]]?.setJointValue(value));
    // The model's antenna joints are mirrored relative to the SDK's [right, left] order.
    joints.right_antenna?.setJointValue(-frame.antennas[0]);
    joints.left_antenna?.setJointValue(-frame.antennas[1]);
  }
  function elapsed() {
    if (!clip) return 0;
    if (pausedAt !== null) return pausedAt;
    let value = (performance.now() - t0) / 1000 * speed;
    if (value > clip.duration) value = loop ? Math.min(value % (clip.duration + LOOP_REST_S), clip.duration) : clip.duration;
    return value;
  }
  function render() {
    if (disposed) return;
    if (clip) {
      const time = elapsed();
      let index = clip.times.findIndex((value) => value > time);
      index = Math.max(0, (index < 0 ? clip.times.length : index) - 1);
      if (index !== frameIndex) { frameIndex = index; apply(clip.frames[index]); dirty = true; }
      tick?.(time, clip.duration, index);
    }
    // Moves are 25 Hz: redraw only when the pose, camera or canvas size changed.
    if (controls.update()) dirty = true;
    if (dirty) { renderer.render(scene, camera); dirty = false; }
    raf = requestAnimationFrame(render);
  }
  controls.addEventListener('change', () => { dirty = true; });
  // Rest pose until a move is loaded; with every joint at zero the Stewart linkage would look broken.
  const rest = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  apply({ pose: rest.flat(), joints: headJoints(rest, 0), antennas: [0, 0] });
  raf = requestAnimationFrame(render);

  return {
    available: true,
    load(move) {
      clip = prepareMove(move); frameIndex = -1; t0 = performance.now(); pausedAt = null;
      return { duration: clip.duration, frames: clip.frames.length, unreachable: clip.unreachable };
    },
    playing: () => Boolean(clip) && pausedAt === null,
    toggle() {
      if (!clip) return;
      if (pausedAt === null) pausedAt = elapsed();
      else { t0 = performance.now() - pausedAt * 1000 / speed; pausedAt = null; }
    },
    restart() { t0 = performance.now(); pausedAt = null; },
    seek(fraction) {
      if (!clip) return;
      const value = Math.max(0, Math.min(1, fraction)) * clip.duration;
      if (pausedAt !== null) pausedAt = value; else t0 = performance.now() - value * 1000 / speed;
    },
    setSpeed(next) { const value = elapsed(); speed = next; if (pausedAt === null) t0 = performance.now() - value * 1000 / speed; },
    setLoop(next) { loop = Boolean(next); },
    setCamera: view,
    onTick(callback) { tick = callback; },
    frame: () => frameIndex,
    dispose() { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); renderer.dispose(); canvas.remove(); },
  };
}

if (typeof window !== 'undefined') window.BrainSNNMotionRenderer = Object.freeze({ create, prepareMove });
