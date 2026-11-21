import { ROBOTS, SCHEMA, routeWorld } from './core.mjs';
import { frames as exampleFrames, surfacePoints } from './assets/showroom-views.mjs';

export const MAX_SHOWROOM_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_CHARS = 1024 * 1024;
const MAX_TOTAL_IMAGE_CHARS = 25 * 1024 * 1024;

function check(condition, message) {
  if (!condition) throw new Error(message);
}
function list(value, min, max, name) {
  check(Array.isArray(value) && value.length >= min && value.length <= max, `Invalid ${name} list.`);
  return value;
}
function text(value, max, name) {
  check(typeof value === 'string' && value.trim() && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), `Invalid ${name}.`);
  return value;
}
function number(value, min, max, name) {
  check(Number.isFinite(value) && value >= min && value <= max, `Invalid ${name}.`);
  return value;
}
function uniqueId(value, ids, name) {
  check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(value) &&
    !ids.has(value), `Invalid or repeated ${name} ID.`);
  ids.add(value);
  return value;
}
function imageSize(data, format) {
  const byte = i => data.charCodeAt(i);
  const unsigned16 = i => byte(i) * 256 + byte(i + 1);
  const unsigned32 = i => unsigned16(i) * 65536 + unsigned16(i + 2);
  if (format === 'png') {
    if (data.startsWith('\x89PNG\r\n\x1a\n') && data.slice(12, 16) === 'IHDR') return [unsigned32(16), unsigned32(20)];
  } else if (format === 'webp') {
    if (data.startsWith('RIFF') && data.slice(8, 12) === 'WEBP') {
      const header = data.slice(12, 16);
      if (header === 'VP8X') return [
        1 + byte(24) + byte(25) * 256 + byte(26) * 65536,
        1 + byte(27) + byte(28) * 256 + byte(29) * 65536,
      ];
      if (header === 'VP8L' && byte(20) === 0x2f) return [
        1 + byte(21) + ((byte(22) & 63) << 8),
        1 + (byte(22) >> 6) + (byte(23) << 2) + ((byte(24) & 15) << 10),
      ];
      if (header === 'VP8 ' && data.slice(23, 26) === '\x9d\x01\x2a') return [
        (byte(26) + byte(27) * 256) & 0x3fff, (byte(28) + byte(29) * 256) & 0x3fff,
      ];
    }
  } else if (data.startsWith('\xff\xd8')) {
    // A JPEG's first start-of-frame marker carries its decoded dimensions.
    let i = 2;
    while (i + 8 < data.length && byte(i) === 0xff) {
      while (byte(i) === 0xff) i++;
      const marker = byte(i++);
      const length = unsigned16(i);
      if (length < 2 || i + length > data.length || marker === 0xda) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [unsigned16(i + 5), unsigned16(i + 3)];
      }
      i += length;
    }
  }
  throw new Error('Invalid frame image header.');
}
function frameImage(value, width, height) {
  check(typeof value === 'string' && value.length <= MAX_IMAGE_CHARS, 'Frame image is missing or too large.');
  // Restrict relative paths to packaged world image assets. Portable imports can embed their own images.
  if (/^(?:\.\/|\/world\/)?(?:assets|examples)\/(?:[\w-]+\/)*[\w.-]+\.(?:jpg|jpeg|png|webp)$/i.test(value)) {
    return '/world/' + value.replace(/^(?:\.\/|\/world\/)/, '');
  }
  const prefix = /^data:image\/(jpeg|png|webp);base64,/i.exec(value);
  check(prefix, 'Use an embedded JPEG, PNG or WebP image, or a packaged World image.');
  const payload = value.slice(prefix[0].length);
  check(payload.length >= 16 && payload.length % 4 === 0 && /^[a-zA-Z0-9+/]+=*$/u.test(payload) &&
    !payload.endsWith('==='), 'Invalid frame image encoding.');
  const [w, h] = imageSize(atob(payload), prefix[1].toLowerCase());
  check(w === width && h === height, 'Frame dimensions disagree with its image.');
  return value;
}

/** Validate untrusted offline evidence and copy only fields used by the viewer. Coordinates use floor X/Z in metres. */
export function parseShowroomBundle(value) {
  if (typeof value === 'string') {
    check(value.length <= MAX_SHOWROOM_BYTES && new TextEncoder().encode(value).length <= MAX_SHOWROOM_BYTES,
      'The showroom file exceeds 32 MiB.');
    value = JSON.parse(value);
  }
  check(value && typeof value === 'object' && !Array.isArray(value), 'Choose a showroom bundle.');
  check(value.units === 'm', 'Showroom floor coordinates must use metres.');
  const bounds = list(value.bounds, 4, 4, 'floor bounds').map(v => number(v, -1e6, 1e6, 'floor coordinate'));
  const [minX, minZ, maxX, maxZ] = bounds;
  check(maxX > minX && maxZ > minZ, 'The floor bounds are empty.');
  function floorPoint(pair) {
    list(pair, 2, 2, 'floor point');
    return [number(pair[0], minX - 1e-6, maxX + 1e-6, 'floor X'), number(pair[1], minZ - 1e-6, maxZ + 1e-6, 'floor Z')];
  }
  function polygon(input) {
    const vertices = list(input, 3, 128, 'footprint').map(floorPoint);
    const [cx, cz] = vertices[0];
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const [x, z] = vertices[i], [u, v] = vertices[(i + 1) % vertices.length];
      area += (x - cx) * (v - cz) - (u - cx) * (z - cz);
    }
    check(Math.abs(area) > 1e-10, 'A footprint must enclose some floor area.');
    return vertices;
  }
  const ids = new Set();
  const objects = list(value.objects, 1, 256, 'objects').map(o => ({
    id: uniqueId(o?.id, ids, 'object'),
    label: text(o.label, 128, 'object name'),
    polygon: polygon(o.polygon),
  }));
  const objectId = id => {
    check(ids.has(id), 'An observation, point or route has an unknown object ID.');
    return id;
  };
  const frameIds = new Set();
  let lastTime = -1, totalImageChars = 0;
  const frames = list(value.frames, 1, 256, 'frames').map(frame => {
    const id = uniqueId(frame?.id, frameIds, 'frame');
    const { width, height } = frame;
    check([width, height].every(v => Number.isInteger(v) && v > 0 && v <= 8192) && width * height <= 16_777_216,
      'Invalid frame size.');
    const timeSeconds = frame.timeSeconds == null ? null : number(frame.timeSeconds, 0, 1e8, 'frame time');
    if (timeSeconds !== null) {
      check(timeSeconds > lastTime, 'Timed frames must be in chronological order.');
      lastTime = timeSeconds;
    }
    totalImageChars += typeof frame.image === 'string' ? frame.image.length : 0;
    check(totalImageChars <= MAX_TOTAL_IMAGE_CHARS, 'The showroom includes too much image data.');
    const image = frameImage(frame.image, width, height);
    const observations = list(frame.observations, 0, 256, 'frame observations').map(obs => {
      const box = list(obs?.box, 4, 4, 'image box').map(v => number(v, 0, 1, 'image coordinate'));
      check(box[0] < box[2] && box[1] < box[3], 'An image box has no area.');
      return { objectId: objectId(obs.objectId), box };
    });
    const result = { id, timeSeconds, image, width, height, observations };
    if (frame.heading != null) {
      check(frame.camera != null, 'A camera heading needs a recorded position.');
      result.heading = number(frame.heading, -180, 180, 'camera heading');
    }
    if (frame.camera != null) result.camera = list(frame.camera, 2, 2, 'camera position').map(v => number(v, -1e6, 1e6, 'camera coordinate'));
    return result;
  });
  const points = list(value.points, 0, 40_000, 'cloud points').map(p => {
    list(p, 3, 4, 'cloud point');
    const point = [...floorPoint(p.slice(0, 2)), number(p[2], -1e5, 1e5, 'point height')];
    if (p.length === 4 && p[3] !== null) point.push(objectId(p[3]));
    return point;
  });
  function route(input) {
    const routePoints = list(input?.points, 2, 8192, 'route points').map(floorPoint);
    const meters = number(input.meters, 0, 1e7, 'route distance');
    let length = 0;
    for (let i = 1; i < routePoints.length; i++) {
      length += Math.hypot(routePoints[i][0] - routePoints[i - 1][0], routePoints[i][1] - routePoints[i - 1][1]);
    }
    check(Math.abs(length - meters) <= Math.max(.06, meters * .02), 'Route distance disagrees with its path.');
    return { points: routePoints, meters };
  }
  const comparedIds = new Set();
  function comparison(pair) {
    const id = objectId(pair?.objectId);
    check(!comparedIds.has(id), 'Each route comparison must refer to a different object.');
    comparedIds.add(id);
    const result = { objectId: id, before: route(pair.before), after: route(pair.after) };
    for (const index of [0, -1]) {
      const a = result.before.points.at(index), b = result.after.points.at(index);
      check(Math.hypot(a[0] - b[0], a[1] - b[1]) <= .1, 'Compare routes with the same start and destination.');
    }
    if (pair.label != null) result.label = text(pair.label, 256, 'comparison label');
    return result;
  }
  const routes = comparison(value.routes);
  const result = {
    title: text(value.title, 160, 'room title'), description: text(value.description, 1600, 'room description'),
    units: 'm', bounds, objects, frames, points, routes, unknown: list(value.unknown, 0, 2048, 'unknown areas').map(polygon),
  };
  if (value.comparisons != null) result.comparisons = list(value.comparisons, 0, 8, 'additional route comparisons').map(comparison);
  if (value.provenance != null) result.provenance = text(value.provenance, 3000, 'room provenance');
  if (value.sourceVideo != null) {
    check(typeof value.sourceVideo.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceVideo.sha256) &&
      lastTime >= 0, 'A source video needs a SHA-256 digest and timed frames.');
    result.sourceVideo = { sha256: value.sourceVideo.sha256 };
  }
  return result;
}

function rectangle({ x, z, w, d }) {
  return [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
}

/** Camera views and cloud samples come from one authored 3D scene. Both routes use the playground's ground planner. */
export function createShowroomExample() {
  const cart = { id: 'cart', name: 'Mint cart', x: 4.7, z: 3.24, w: 2.6, d: 1.52, h: 2.04 };
  const tires = { id: 'tires', name: 'Tire stack', x: 2.86, z: 5.76, w: .98, d: .98, h: 1 };
  const shelf = { id: 'shelf', name: 'Supply shelf', x: 8.5, z: 5.93, w: 2.3, d: .89, h: 2.24 };
  const unknown = { id: 'unknown', name: 'Unseen corner', x: .1, z: 6.55, w: 1.1, d: 1.35, h: .1, kind: 'unknown' };
  const world = { schema: SCHEMA, name: 'Practice showroom', provenance: 'authored', scaleReviewed: true, mapReviewed: true,
    width: 12, depth: 8, start: { x: 1, z: 4.05 }, objects: [cart, tires, shelf, unknown] };
  const goal = { x: 11, z: 4.05 };
  function plan(layout) {
    const { route, distance } = routeWorld(layout, ROBOTS.vacuum, goal);
    return { points: route.map(p => [p.x, p.z]), meters: distance };
  }
  const floor = [];
  for (let x = .25; x < world.width; x += .5) {
    for (let z = .25; z < world.depth; z += .5) {
      if (!world.objects.some(o => x >= o.x && x <= o.x + o.w && z >= o.z && z <= o.z + o.d)) floor.push([x, z, 0]);
    }
  }
  return parseShowroomBundle({
    title: 'Practice showroom', description: 'Find the mint cart, then take it out of a copy of the room to see how far a robot vacuum travels.',
    provenance: 'This practice room was drawn in 3D. All three camera views and the object points come from that scene. The World Builder planner calculated both simulated routes using the same robot, start and destination.',
    units: 'm', bounds: [0, 0, world.width, world.depth], unknown: [rectangle(unknown)],
    objects: [cart, tires, shelf].map(o => ({ id: o.id, label: o.name, polygon: rectangle(o) })),
    frames: exampleFrames, points: [...floor, ...surfacePoints],
    routes: { objectId: cart.id, before: plan(world), after: plan({ ...world, objects: world.objects.filter(o => o.id !== cart.id) }) },
  });
}
