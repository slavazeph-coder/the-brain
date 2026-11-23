import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const Z_UP = new THREE.Vector3(0, 0, 1);
const INITIAL_VIEW = new THREE.Vector3(.60, -1.65, 1.35).normalize();
const VIEW_RIGHT = new THREE.Vector3().crossVectors(Z_UP, INITIAL_VIEW).normalize();
const VIEW_UP = new THREE.Vector3().crossVectors(INITIAL_VIEW, VIEW_RIGHT);
const TABLE_THICKNESS = .05;
const GOAL_HALF_HEIGHT = .003;

function sceneColor(r, g, b) {
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

/** Draw observed poses of the built-in Z-up MuJoCo scene. */
export function createRobotTask3D(canvas, episode) {
  if (episode?.schema !== 'brainsnn.robot-task.episode.v1' || !episode.frames?.length) {
    throw Error('Run a tabletop task to open the 3D replay.');
  }
  const {scene: model, frames} = episode;
  const [left, right] = model.bounds.x;
  const [near, far] = model.bounds.y;
  const width = right - left, depth = far - near;
  const extent = Math.hypot(width, depth) / 2;
  const center = new THREE.Vector3((left + right) / 2, (near + far) / 2, .01);
  const highestPose = model.pusherStart[2] + model.pusherRadius;
  const projectedCorners = [left, right].flatMap(x => [near, far].flatMap(y => [-TABLE_THICKNESS, highestPose].map(z => {
    const point = new THREE.Vector3(x, y, z).sub(center);
    return [Math.abs(point.dot(VIEW_RIGHT)), Math.abs(point.dot(VIEW_UP)), point.dot(INITIAL_VIEW)];
  })));

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'low-power'});
  } catch {
    throw Error('The 3D view needs WebGL 2. The tabletop replay is still available.');
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101927);
  scene.fog = new THREE.Fog(0x101927, 3, 12);
  const camera = new THREE.PerspectiveCamera(38, 1, .015, 30);
  camera.up.copy(Z_UP);
  camera.position.copy(center).addScaledVector(INITIAL_VIEW, 2.5);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = extent * .72;
  controls.minPolarAngle = .08;
  controls.maxPolarAngle = Math.PI / 2 - .12;

  scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x7b7585, 1.7));
  const light = new THREE.DirectionalLight(0xffebd5, 2.7);
  light.position.set(-1.8, -.9, 2.6);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  Object.assign(light.shadow.camera, {left: -1.1, right: 1.1, top: 1.1, bottom: -1.1, near: .2, far: 7});
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.normalBias = .004;
  scene.add(light);

  function solid(geometry, color, {castShadow = true, receiveShadow = true} = {}) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color, roughness: .72}));
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    scene.add(mesh);
    return mesh;
  }
  const floor = solid(new THREE.PlaneGeometry(40, 40), 0x141c28, {castShadow: false});
  floor.position.z = -TABLE_THICKNESS - .002;
  const table = solid(new THREE.BoxGeometry(width, depth, TABLE_THICKNESS), sceneColor(.21, .27, .34));
  table.position.set(center.x, center.y, -TABLE_THICKNESS / 2);

  const tool = solid(model.pusherHalfLength
    ? new THREE.CapsuleGeometry(model.pusherRadius, model.pusherHalfLength * 2, 8, 24)
    : new THREE.SphereGeometry(model.pusherRadius, 24, 16), sceneColor(.18, .78, .76));
  let puck = null;
  if (model.puckStart) {
    puck = solid(new THREE.CylinderGeometry(model.puckRadius, model.puckRadius, model.puckHalfHeight * 2, 32), sceneColor(.94, .60, .24));
    puck.geometry.rotateX(Math.PI / 2); // CylinderGeometry starts along Y; MuJoCo's puck starts along Z.
  }

  const goalColor = sceneColor(.3, .9, .43);
  const goal = new THREE.Mesh(
    new THREE.CylinderGeometry(model.goalRadius, model.goalRadius, GOAL_HALF_HEIGHT * 2, 48),
    new THREE.MeshBasicMaterial({color: goalColor, transparent: true, opacity: .38, depthWrite: false}),
  );
  goal.position.fromArray(model.goal);
  goal.rotation.x = Math.PI / 2;
  scene.add(goal);
  // The table outline shows the score's horizontal boundary even when the puck covers the goal site.
  const goalOutline = new THREE.Mesh(
    new THREE.RingGeometry(model.goalRadius * .92, model.goalRadius, 48),
    new THREE.MeshBasicMaterial({color: goalColor}),
  );
  goalOutline.position.set(model.goal[0], model.goal[1], .001);
  scene.add(goalOutline);

  const pathGeometry = new THREE.BufferGeometry().setFromPoints(frames.map(frame => {
    const [x, y] = frame.puck ?? frame.pusher;
    return new THREE.Vector3(x, y, .002);
  }));
  const path = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({color: puck ? 0xc69b5a : 0x70baba}));
  scene.add(path);

  const offset = new THREE.Vector3();
  const addTabStop = !canvas.hasAttribute('tabindex');
  if (addTabStop) canvas.tabIndex = 0;
  let disposed = false, pendingDraw = 0, fitDistance = 0, lastWidth = 0, lastHeight = 0, lastPixelRatio = 0;
  function draw() {
    if (disposed || pendingDraw || !canvas.clientWidth || !canvas.clientHeight) return;
    pendingDraw = requestAnimationFrame(() => {
      pendingDraw = 0;
      renderer.render(scene, camera);
    });
  }
  function resetView() {
    if (disposed || !fitDistance) return;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(INITIAL_VIEW, fitDistance);
    controls.update();
    draw();
  }
  function resize() {
    const {clientWidth, clientHeight} = canvas;
    if (disposed || !clientWidth || !clientHeight) return;
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 1.75);
    if (clientWidth === lastWidth && clientHeight === lastHeight && pixelRatio === lastPixelRatio) return;
    lastWidth = clientWidth;
    lastHeight = clientHeight;
    lastPixelRatio = pixelRatio;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(clientWidth, clientHeight, false);
    // Fit the scene at its actual viewing angle. Account for each corner's depth in perspective.
    const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * .88;
    const horizontal = vertical * camera.aspect;
    const oldFit = fitDistance;
    fitDistance = Math.max(...projectedCorners.map(([x, y, z]) => z + Math.max(x / horizontal, y / vertical)));
    controls.maxDistance = Math.max(fitDistance * 1.65, extent * 5);
    if (!oldFit) {
      resetView();
      return;
    }
    offset.subVectors(camera.position, controls.target).multiplyScalar(fitDistance / oldFit);
    camera.position.copy(controls.target).add(offset);
    controls.update();
    draw();
  }
  function showFrame(index) {
    if (disposed || !Number.isInteger(index) || index < 0 || index >= frames.length) return;
    const frame = frames[index];
    tool.position.fromArray(frame.pusher);
    pathGeometry.setDrawRange(0, index + 1);
    if (puck) {
      puck.visible = Boolean(frame.puck);
      if (frame.puck) {
        puck.position.fromArray(frame.puck);
        const [w, x, y, z] = frame.puckQuaternion;
        puck.quaternion.set(x, y, z, w);
      }
    }
    draw();
  }
  function rotate(direction) {
    if (disposed || !direction) return;
    offset.subVectors(camera.position, controls.target).applyAxisAngle(Z_UP, .22 * direction);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }
  function zoom(direction) {
    if (disposed || !direction) return;
    offset.subVectors(camera.position, controls.target).multiplyScalar(direction < 0 ? .84 : 1 / .84);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }
  function keydown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowLeft': rotate(-1); break;
      case 'ArrowRight': rotate(1); break;
      case '+': case '=': zoom(-1); break;
      case '-': zoom(1); break;
      case 'Home': resetView(); break;
      default: return;
    }
    event.preventDefault();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('webglcontextrestored', draw);
  controls.addEventListener('change', draw);
  resize();
  showFrame(0);

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(pendingDraw);
    observer.disconnect();
    canvas.removeEventListener('keydown', keydown);
    canvas.removeEventListener('webglcontextrestored', draw);
    if (addTabStop) canvas.removeAttribute('tabindex');
    controls.removeEventListener('change', draw);
    controls.dispose();
    scene.traverse(child => {
      child.geometry?.dispose();
      child.material?.dispose();
    });
    light.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return {showFrame, rotate, zoom, resetView, resize, dispose};
}
