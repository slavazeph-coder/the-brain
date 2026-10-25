// The knife for Poke the Brain: cut planes, the two halves' rigid poses, the
// spring that opens and closes a cut, and the jelly droplets a cut throws.
//
// A cut is a plane in the shell's own (rest) space. Each side of it renders as
// its own piece: the shell is clipped against the plane, a cross-section cap
// closes the open face, and both are moved by the same rigid pose — slid
// apart along the plane normal and tipped open about a hinge line at the
// bottom of the cut, like two halves of a jelly falling away from the blade.
//
// Pure and three-free like jellyPhysics.js, so the maths is unit-tested in
// bare Node. PokeBrainScene.jsx mirrors placeOnHalf() in GLSL — keep the two
// in step.
import { createRng } from '../../../lib/rng.js';
import { SHELL } from './brainShell.js';

export const CUT = Object.freeze({
  // World units each half slides away from the cut when fully open.
  gap: 0.8,
  // Radians each half tips open about the hinge. Weighted down to nothing for
  // a near-horizontal cut, which lifts like a lid instead.
  tilt: 0.16,
  // The hinge sits this fraction of the way down to the shell's lower edge.
  hingeReach: 0.92,
  // The open/close spring: a little overshoot, so the halves bounce apart.
  stiffness: 70,
  damping: 10,
  // Below this the halves count as shut and render as one body again.
  shutEpsilon: 0.004,
  // A cut must pass this close to the centre (1 = the shell's surface, in
  // ellipsoid-normalised distance) or it would only shave the skin.
  maxCenterOffset: 0.82,
  // Pointer strokes shorter than this (CSS px) are taps, not slashes.
  minStrokePx: 14,
  // A chop from the button or a tap: a vertical plane turned this far from
  // facing the screen edge-on, so the blade reads as a blade and the split
  // opens left/right.
  chopTurn: (Math.PI * 2) / 9,
});

// The lab set, world space: the steel tray the jelly rests in and the bench
// under it. The scene builds the set from these and droplets land on them.
export const STAGE = Object.freeze({
  trayTop: -3.4,
  trayRadius: 6.05,
  benchTop: -3.9,
});

export const DROPLETS = Object.freeze({
  count: 34,
  life: 1.7,
  gravity: 16,
  minRadius: 0.06,
  maxRadius: 0.16,
  // Landing surfaces in world space: the tray's dish, else the bench.
  trayY: STAGE.trayTop + 0.02,
  trayRadius: STAGE.trayRadius,
  benchY: STAGE.benchTop + 0.02,
  // A landed droplet flattens into a splat and shrinks away by end of life.
  splatSpread: 1.9,
  splatFlat: 0.32,
});

const UP = Object.freeze([0, 1, 0]);

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a) {
  const l = length(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null;
}

/** Rodrigues rotation of `v` about the unit `axis` by `angle` radians. */
export function rotateAbout(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}

/**
 * The plane a screen-space slash sweeps out: it contains the eye and both
 * pointer rays, so it projects onto the screen as exactly the line drawn.
 * All three inputs in the same space. Null for a degenerate stroke.
 */
export function planeThroughEye(eye, dirA, dirB) {
  const normal = normalize(cross(dirA, dirB));
  if (!normal) return null;
  return { normal, d: dot(normal, eye) };
}

/** A plane through `point` with the given normal. */
export function planeThroughPoint(point, normal) {
  const n = normalize(normal);
  if (!n) return null;
  return { normal: n, d: dot(n, point) };
}

/** +1 or -1: which piece a rest-space point belongs to. On the plane counts as +1. */
export function sideOf(plane, point) {
  return dot(plane.normal, point) - plane.d >= 0 ? 1 : -1;
}

/**
 * How far the plane passes from the shell's centre, normalised so that 1
 * means it only grazes the smooth ellipsoid. Under CUT.maxCenterOffset it
 * cuts the brain into two real pieces.
 */
export function planeCenterOffset(plane) {
  const [rx, ry, rz] = SHELL.radii;
  const [nx, ny, nz] = plane.normal;
  const reach = Math.hypot(nx * rx, ny * ry, nz * rz);
  return Math.abs(dot(plane.normal, SHELL.center) - plane.d) / reach;
}

export function planeCutsShell(plane, cfg = CUT) {
  return Boolean(plane) && planeCenterOffset(plane) < cfg.maxCenterOffset;
}

/**
 * Slide a plane along its normal until it passes no further from the centre
 * than `limit` — a tap near the rim still takes a decent chunk off.
 */
export function clampPlaneToShell(plane, limit = CUT.maxCenterOffset * 0.92) {
  const [rx, ry, rz] = SHELL.radii;
  const [nx, ny, nz] = plane.normal;
  const reach = Math.hypot(nx * rx, ny * ry, nz * rz);
  const centre = dot(plane.normal, SHELL.center);
  const offset = plane.d - centre;
  const max = limit * reach;
  if (Math.abs(offset) <= max) return plane;
  return { normal: plane.normal, d: centre + Math.sign(offset) * max };
}

/** Distance along unit `dir` from `origin` to the smooth ellipsoid's surface. */
function reachToSurface(origin, dir) {
  const [cx, cy, cz] = SHELL.center;
  const [rx, ry, rz] = SHELL.radii;
  const o = [(origin[0] - cx) / rx, (origin[1] - cy) / ry, (origin[2] - cz) / rz];
  const v = [dir[0] / rx, dir[1] / ry, dir[2] / rz];
  const a = dot(v, v);
  const b = 2 * dot(o, v);
  const c = dot(o, o) - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return 0;
  return Math.max(0, (-b + Math.sqrt(disc)) / (2 * a));
}

/**
 * Everything the renderer needs about one cut, derived once when it is made:
 * an in-plane basis for the cap, the cap's centre, the hinge the halves tip
 * about, and each half's unit slide (never downward — nothing sinks into
 * the tray).
 */
export function makeCutFrame(plane, cfg = CUT) {
  const n = plane.normal;
  const origin = sub(SHELL.center, scale(n, dot(n, SHELL.center) - plane.d));
  // The in-plane direction closest to straight down. A near-horizontal cut
  // has none worth tipping about: it lifts like a lid instead.
  const vertical = Math.abs(n[1]);
  const down = normalize(sub(scale(UP, -1), scale(n, -n[1]))) || normalize(cross(n, [1, 0, 0])) || [0, 0, 1];
  const axis = normalize(cross(n, down));
  const t1 = axis;
  const t2 = cross(n, t1);
  const hinge = add(origin, scale(down, reachToSurface(origin, down) * cfg.hingeReach));
  const tiltWeight = 1 - smoothstep(0.55, 0.9, vertical);
  const slide = (side) => {
    const offset = scale(n, side * cfg.gap);
    if (offset[1] < 0) offset[1] = 0;
    return offset;
  };
  return {
    normal: n,
    d: plane.d,
    origin,
    t1,
    t2,
    hinge,
    axis,
    tilt: cfg.tilt * tiltWeight,
    slidePos: slide(1),
    slideNeg: slide(-1),
  };
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Where a rest-space point on the given side ends up with the cut `open`
 * (0 shut .. 1 fully open, may overshoot slightly). Mirrors placeHalf() in
 * the scene's vertex shader: tip about the hinge, then slide.
 */
export function placeOnHalf(frame, side, open, point) {
  if (!frame || open <= 0) return point;
  const angle = side * frame.tilt * open;
  const slide = side > 0 ? frame.slidePos : frame.slideNeg;
  const turned = add(frame.hinge, rotateAbout(sub(point, frame.hinge), frame.axis, angle));
  return add(turned, scale(slide, open));
}

/** Same as placeOnHalf, choosing the side from the point itself. */
export function placeOnCut(frame, open, point) {
  if (!frame || open <= 0) return point;
  return placeOnHalf(frame, sideOf(frame, point), open, point);
}

/** Reduced motion: the cut opens and closes without the bounce. */
export function cutConfig(reducedMotion, base = CUT) {
  if (!reducedMotion) return base;
  return Object.freeze({ ...base, damping: 2 * Math.sqrt(base.stiffness) });
}

/**
 * One step of the open/close spring. Semi-implicit Euler with a little
 * overshoot opening; closing clamps at shut so the halves never pass
 * through each other.
 */
export function cutSpringStep(state, target, dt, cfg = CUT) {
  const step = Math.min(Math.max(dt, 0), 1 / 20);
  let velocity = state.velocity + ((target - state.open) * cfg.stiffness - state.velocity * cfg.damping) * step;
  let open = state.open + velocity * step;
  if (open < 0) {
    open = 0;
    velocity = 0;
  }
  return { open, velocity };
}

/**
 * The plane for a chop from the Slice button or a knife tap: vertical,
 * through `point`, turned CUT.chopTurn off the screen's right-hand axis
 * towards the viewer. `right` and `toViewer` are world-space camera axes.
 */
export function chopNormal(right, toViewer, cfg = CUT) {
  const r = normalize([right[0], 0, right[2]]) || [1, 0, 0];
  const f = normalize([toViewer[0], 0, toViewer[2]]) || [0, 0, 1];
  const c = Math.cos(cfg.chopTurn);
  const s = Math.sin(cfg.chopTurn);
  return normalize([r[0] * c + f[0] * s, 0, r[2] * c + f[2] * s]);
}

/**
 * The droplets a cut throws, spawned on the cut face in rest space. Each
 * flies off the side it came from. Deterministic per seed so recorded clips
 * replay the same splash.
 */
export function spawnDroplets(frame, seed, cfg = DROPLETS) {
  const rng = createRng(seed);
  const [cx, cy, cz] = SHELL.center;
  const [rx, ry, rz] = SHELL.radii;
  const droplets = [];
  let guard = 0;
  while (droplets.length < cfg.count && guard < cfg.count * 20) {
    guard += 1;
    const a = (rng() * 2 - 1) * 5;
    const b = (rng() * 2 - 1) * 4;
    const point = add(frame.origin, add(scale(frame.t1, a), scale(frame.t2, b)));
    const inside = Math.hypot((point[0] - cx) / rx, (point[1] - cy) / ry, (point[2] - cz) / rz);
    if (inside > 0.86) continue;
    const side = droplets.length % 2 === 0 ? 1 : -1;
    const out = 2.2 + rng() * 2.8;
    const lift = 2.6 + rng() * 4.2;
    const drift = (rng() * 2 - 1) * 1.6;
    droplets.push({
      origin: point,
      velocity: add(add(scale(frame.normal, side * out), scale(UP, lift)), scale(frame.t1, drift)),
      radius: cfg.minRadius + rng() * (cfg.maxRadius - cfg.minRadius),
      tint: rng(),
      side,
    });
  }
  return droplets;
}

/** Height of the landing surface under a world-space x/z. */
export function floorAt(x, z, cfg = DROPLETS) {
  const r = Math.hypot(x - SHELL.center[0], z - SHELL.center[2]);
  return r < cfg.trayRadius ? cfg.trayY : cfg.benchY;
}

/**
 * Closed-form flight of one droplet launched from world `origin` with world
 * `velocity`: ballistic until it meets the floor, then a splat that sits
 * where it landed. Returns position, the splat amount (0 flying, 1 flat)
 * and a 0..1 size that shrinks to nothing by end of life.
 */
export function dropletAt(origin, velocity, t, cfg = DROPLETS) {
  const g = cfg.gravity;
  const landingTime = (floorY) => {
    // origin.y + vy t - g t^2 / 2 = floorY, the later root.
    const a = -0.5 * g;
    const b = velocity[1];
    const c = origin[1] - floorY;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return 0;
    return (-b - Math.sqrt(disc)) / (2 * a);
  };
  let land = landingTime(cfg.trayY);
  const atTray = [origin[0] + velocity[0] * land, origin[2] + velocity[2] * land];
  if (floorAt(atTray[0], atTray[1], cfg) !== cfg.trayY) land = landingTime(cfg.benchY);
  const flying = Math.min(Math.max(t, 0), land);
  const position = [
    origin[0] + velocity[0] * flying,
    origin[1] + velocity[1] * flying - 0.5 * g * flying * flying,
    origin[2] + velocity[2] * flying,
  ];
  const landed = t >= land;
  if (landed) position[1] = floorAt(position[0], position[2], cfg) + 0.02;
  const size = t >= cfg.life ? 0 : 1 - smoothstep(cfg.life * 0.55, cfg.life, t);
  return { position, splat: landed ? 1 : 0, size };
}
