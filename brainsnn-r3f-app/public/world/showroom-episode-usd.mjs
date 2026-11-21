// Export the same floor proxies that take part in the MuJoCo run and animate its measured poses.
import {showroomEpisodeColliders} from './showroom-episode-physics.mjs';

function number(value) {
  if (!Number.isFinite(value)) throw new Error('The recorded run contains an invalid coordinate.');
  return String(value);
}
const tuple = values => '(' + values.map(number).join(', ') + ')';

function prism(geometry, index) {
  const {polygon, bottom, top, kind} = geometry;
  const n = polygon.length;
  // In a Y-up stage, positive signed area in the X/Z plane points towards the floor.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const base = Array.from({length:n}, (_,i) => area > 0 ? i : n - i - 1);
  const faces = [base, base.map(i => i+n).reverse()];
  for (let i = 0; i < n; i++) {
    const a = base[i], b = base[(i+1) % n];
    faces.push([b,a,a+n,b+n]);
  }
  const points = [bottom,top].flatMap(y => polygon.map(([x,z]) => tuple([x,y,z])));
  const color = {floor:[.3,.36,.4],wall:[.35,.42,.45],object:[.17,.52,.54],unknown:[.86,.56,.20]}[kind];
  if (!color) throw new Error('Unknown room collider kind.');
  return `    def Mesh "Collider_${index}" (
        prepend apiSchemas = ["PhysicsCollisionAPI", "PhysicsMeshCollisionAPI"]
    ) {
        custom string roomKind = "${kind}"
        custom string colliderName = ${JSON.stringify(geometry.name)}
        token physics:approximation = "convexHull"
        uniform token subdivisionScheme = "none"
        color3f[] primvars:displayColor = [${tuple(color)}]
        point3f[] points = [${points.join(', ')}]
        int[] faceVertexCounts = [${faces.map(face => face.length).join(', ')}]
        int[] faceVertexIndices = [${faces.flat().join(', ')}]
    }`;
}

/** The cart is a kinematic replay of recorded samples. The stage does not re-run the controller. */
export function makeShowroomEpisodeUSD(episode) {
  const {scene, frames, sceneSha256, sampleIntervalSeconds} = episode;
  if (!frames?.length || !/^[a-f0-9]{64}$/.test(sceneSha256) || !(sampleIntervalSeconds > 0)) {
    throw new Error('Record a complete showroom run before saving a replay.');
  }
  const rate = 1 / sampleIntervalSeconds;
  const height = scene.cartHeight;
  const colliders = showroomEpisodeColliders(scene);
  const sample = frame => tuple([frame.position[0], height / 2, frame.position[1]]);
  const keys = frames.map(frame => `            ${number(frame.time * rate)}: ${sample(frame)}`);
  return `#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Y"
    startTimeCode = 0
    endTimeCode = ${number(frames.at(-1).time * rate)}
    timeCodesPerSecond = ${number(rate)}
    framesPerSecond = ${number(rate)}
)
def Xform "World" {
    custom string roomSceneSha256 = "${sceneSha256}"
    custom string recording = "MuJoCo kinematic replay using reviewed floor proxies"
    def PhysicsScene "Physics" {
        vector3f physics:gravityDirection = (0, -1, 0)
        float physics:gravityMagnitude = 9.81
    }
${colliders.map(prism).join('\n')}
    def Cylinder "Cart" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsCollisionAPI"]
    ) {
        uniform token axis = "Y"
        double height = ${number(height)}
        double radius = ${number(scene.cartRadius)}
        bool physics:kinematicEnabled = true
        color3f[] primvars:displayColor = [(0.9, 0.4, 0.12)]
        double3 xformOp:translate = ${sample(frames[0])}
        double3 xformOp:translate.timeSamples = {
${keys.join(',\n')}
        }
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
`;
}
