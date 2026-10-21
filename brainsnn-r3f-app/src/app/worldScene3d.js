// three.js view of a real World Engine reconstruction: coloured COLMAP points,
// the recorded camera path and a walk along it. Loaded only by WorldView.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CYAN = 0x68eaff, VIOLET = 0x947cff;

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

/**
 * COLMAP's frame is arbitrary. People hold cameras roughly upright, so the
 * average image "down" axis points at the floor; rotate that to -Y, centre on
 * the robust median and scale the bulk of the scene to a few units.
 */
export function normaliseWorld(points, cameras = []) {
  let up = new THREE.Vector3(0, -1, 0);
  if (cameras.length) {
    const down = cameras.reduce((sum, camera) => sum.add(new THREE.Vector3(...camera.down)), new THREE.Vector3());
    if (down.lengthSq() > 1e-9) up = down.normalize().negate();
  }
  const rotation = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
  const rotated = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyQuaternion(rotation));
  const centre = new THREE.Vector3(
    percentile(rotated.map((v) => v.x), 0.5), percentile(rotated.map((v) => v.y), 0.5), percentile(rotated.map((v) => v.z), 0.5));
  const distances = rotated.map((v) => v.distanceTo(centre));
  const keep = percentile(distances, 0.98) * 1.15 || 1;
  const scale = 2.2 / (percentile(distances, 0.9) || 1);
  const transform = (v) => v.sub(centre).multiplyScalar(scale);
  const kept = [], colours = [];
  rotated.forEach((v, index) => {
    if (distances[index] > keep) return;
    kept.push(transform(v));
    colours.push(points[index][3] / 255, points[index][4] / 255, points[index][5] / 255);
  });
  const path = cameras.map((camera) => ({
    position: transform(new THREE.Vector3(...camera.centre).applyQuaternion(rotation)),
    forward: new THREE.Vector3(...camera.forward).applyQuaternion(rotation).normalize(),
  }));
  return { points: kept, colours, path, dropped: points.length - kept.length };
}

function roundSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createWorldScene(container, { points, cameras }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }); }
  catch { return null; }
  const world = normaliseWorld(points, cameras);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05070b);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Reconstructed 3D points of the captured space (${world.points.length.toLocaleString()} points) with the recorded camera path. Drag to orbit, scroll to zoom.`);
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05070b, 6, 14);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.3; controls.maxDistance = 12;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(world.points.flatMap((v) => [v.x, v.y, v.z]), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(world.colours, 3));
  const sprite = roundSprite();
  const material = new THREE.PointsMaterial({ size: 0.055, vertexColors: true, map: sprite, alphaTest: 0.35, transparent: true, sizeAttenuation: true });
  material.color.setScalar(1.15);
  scene.add(new THREE.Points(geometry, material));

  const pathGroup = new THREE.Group();
  if (world.path.length > 1) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(world.path.map((step) => step.position)),
      new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.85 }));
    pathGroup.add(line);
    const cone = new THREE.ConeGeometry(0.045, 0.11, 4, 1, true);
    cone.rotateX(Math.PI / 2);
    const coneMaterial = new THREE.MeshBasicMaterial({ color: VIOLET, wireframe: true, transparent: true, opacity: 0.7 });
    const every = Math.max(1, Math.round(world.path.length / 24));
    world.path.forEach((step, index) => {
      if (index % every) return;
      const marker = new THREE.Mesh(cone, coneMaterial);
      marker.position.copy(step.position);
      marker.lookAt(step.position.clone().add(step.forward));
      pathGroup.add(marker);
    });
  }
  scene.add(pathGroup);
  const grid = new THREE.GridHelper(8, 32, 0x24425a, 0x14222f);
  grid.position.y = percentile(world.points.map((v) => v.y), 0.03) - 0.02;
  scene.add(grid);

  // Frame the bulk of the scene from above one corner, far enough to fit its bounds.
  const framed = [...world.points, ...world.path.map((step) => step.position)];
  const bounds = new THREE.Box3().setFromPoints(framed.length ? framed : [new THREE.Vector3()]);
  const middle = bounds.getCenter(new THREE.Vector3()), radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length() / 2);
  function overview() {
    walk = null;
    pathGroup.visible = showPath;
    controls.enabled = true;
    controls.target.copy(middle);
    camera.position.copy(middle).add(new THREE.Vector3(0.62, 0.55, 0.62).normalize().multiplyScalar(radius * 1.55));
    controls.update();
    dirty = true;
  }
  let showPath = true;
  let walk = null, dirty = true, raf = 0, disposed = false;
  overview();

  function resize() {
    const width = container.clientWidth || 800, height = container.clientHeight || 500;
    renderer.setSize(width, height, false);
    canvas.style.width = '100%'; canvas.style.height = '100%';
    camera.aspect = width / height; camera.updateProjectionMatrix();
    dirty = true;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  controls.addEventListener('change', () => { dirty = true; });

  // Walk the recorded route: position along the path, looking where the camera looked.
  function stepWalk(time) {
    const span = world.path.length - 1, t = Math.min(span, ((time - walk.start) / 1000) * walk.speed);
    const index = Math.floor(t), mix = t - index, next = Math.min(span, index + 1);
    const a = world.path[index], b = world.path[next];
    camera.position.copy(a.position).lerp(b.position, mix);
    const look = a.forward.clone().lerp(b.forward, mix).normalize();
    camera.lookAt(camera.position.clone().add(look));
    walk.onProgress?.(t / span);
    if (t >= span) {
      const done = walk.onDone;
      walk = null;
      pathGroup.visible = showPath;
      controls.target.copy(camera.position.clone().add(look.multiplyScalar(1.5)));
      controls.enabled = true;
      done?.();
    }
    dirty = true;
  }
  function frame(time) {
    if (disposed) return;
    if (walk) stepWalk(time);
    else if (controls.update()) dirty = true;
    if (dirty) { renderer.render(scene, camera); dirty = false; }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    pointCount: world.points.length,
    dropped: world.dropped,
    canWalk: world.path.length > 1,
    walk({ onProgress, onDone } = {}) {
      if (world.path.length < 2) return;
      controls.enabled = false;
      // First person: the path markers would sit right in front of the lens.
      pathGroup.visible = false;
      // About three recorded frames a second: a slow walk, like the capture itself.
      walk = { start: performance.now(), speed: 3, onProgress, onDone };
    },
    overview,
    showPath(visible) { showPath = visible; if (!walk) pathGroup.visible = visible; dirty = true; },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose();
      geometry.dispose(); material.dispose(); sprite.dispose(); renderer.dispose(); canvas.remove();
    },
  };
}
