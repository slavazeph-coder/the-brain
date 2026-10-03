import { describe, expect, it } from '../../../test/tinyVitest.js';
import { SHELL } from './brainShell.js';
import {
  chopNormal,
  clampPlaneToShell,
  CUT,
  cutConfig,
  cutSpringStep,
  dot,
  dropletAt,
  DROPLETS,
  floorAt,
  makeCutFrame,
  placeOnCut,
  placeOnHalf,
  planeCenterOffset,
  planeCutsShell,
  planeThroughEye,
  planeThroughPoint,
  sideOf,
  spawnDroplets,
} from './jellySlice.js';

const MIDLINE = planeThroughPoint(SHELL.center, [1, 0, 0]);

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('cut planes', () => {
  it('slice: a slash plane contains the eye and both pointer rays', () => {
    const eye = [0.4, 1.4, 20];
    const a = [-0.3, 0.1, -1];
    const b = [0.25, -0.2, -1];
    const plane = planeThroughEye(eye, a, b);
    const onPlane = (point) => Math.abs(dot(plane.normal, point) - plane.d);
    expect(onPlane(eye)).toBeLessThan(1e-9);
    expect(onPlane([eye[0] + a[0] * 7, eye[1] + a[1] * 7, eye[2] + a[2] * 7])).toBeLessThan(1e-9);
    expect(onPlane([eye[0] + b[0] * 3, eye[1] + b[1] * 3, eye[2] + b[2] * 3])).toBeLessThan(1e-9);
  });

  it('slice: a zero-length stroke makes no plane instead of NaN', () => {
    expect(planeThroughEye([0, 0, 10], [0, 0, -1], [0, 0, -1])).toBe(null);
  });

  it('slice: a plane through the middle cuts, one past the rim only shaves air', () => {
    expect(planeCenterOffset(MIDLINE)).toBeLessThan(1e-9);
    expect(planeCutsShell(MIDLINE)).toBe(true);
    expect(planeCutsShell(planeThroughPoint([SHELL.center[0] + SHELL.radii[0] * 0.95, 0, 0], [1, 0, 0]))).toBe(false);
    expect(planeCutsShell(null)).toBe(false);
  });

  it('slice: a rim tap is pulled in until it takes off a real piece', () => {
    const rim = planeThroughPoint([SHELL.center[0] + SHELL.radii[0] * 0.99, 0, 0], [1, 0, 0]);
    const clamped = clampPlaneToShell(rim);
    expect(planeCutsShell(clamped)).toBe(true);
    expect(clampPlaneToShell(MIDLINE)).toBe(MIDLINE);
  });

  it('slice: points either side of the plane land in different pieces', () => {
    expect(sideOf(MIDLINE, [SHELL.center[0] + 1, 0, 0])).toBe(1);
    expect(sideOf(MIDLINE, [SHELL.center[0] - 1, 0, 0])).toBe(-1);
  });

  it('slice: the chop plane is vertical and turned towards the viewer', () => {
    const n = chopNormal([1, 0, 0], [0, 0, 1]);
    expect(Math.abs(n[1])).toBeLessThan(1e-9);
    expect(n[0]).toBeCloseTo(Math.cos(CUT.chopTurn), 6);
    expect(n[2]).toBeCloseTo(Math.sin(CUT.chopTurn), 6);
  });
});

describe('cut frame and halves', () => {
  const frame = makeCutFrame(planeThroughPoint(SHELL.center, chopNormal([1, 0, 0], [0, 0, 1])));

  it('slice: the cap basis is orthonormal and lies in the cut plane', () => {
    expect(Math.abs(dot(frame.t1, frame.normal))).toBeLessThan(1e-9);
    expect(Math.abs(dot(frame.t2, frame.normal))).toBeLessThan(1e-9);
    expect(Math.abs(dot(frame.t1, frame.t2))).toBeLessThan(1e-9);
    expect(Math.abs(dot(frame.origin, frame.normal) - frame.d)).toBeLessThan(1e-9);
  });

  it('slice: the hinge sits on the plane, below the cut centre', () => {
    expect(Math.abs(dot(frame.hinge, frame.normal) - frame.d)).toBeLessThan(1e-9);
    expect(frame.hinge[1]).toBeLessThan(frame.origin[1] - 2);
  });

  it('slice: shut means untouched', () => {
    const point = [1, 2, 0.5];
    expect(placeOnHalf(frame, 1, 0, point)).toBe(point);
    expect(placeOnCut(null, 1, point)).toBe(point);
  });

  it('slice: opening moves each piece away from the cut, never towards it', () => {
    const plus = [SHELL.center[0] + 1.5, 1.5, SHELL.center[2]];
    const minus = [SHELL.center[0] - 1.5, 1.5, SHELL.center[2]];
    const signed = (point) => dot(frame.normal, point) - frame.d;
    expect(signed(placeOnCut(frame, 1, plus))).toBeGreaterThan(signed(plus) + CUT.gap * 0.5);
    expect(signed(placeOnCut(frame, 1, minus))).toBeLessThan(signed(minus) - CUT.gap * 0.5);
  });

  it('slice: each piece moves rigidly — distances inside a half are kept', () => {
    const a = [SHELL.center[0] + 1, 2, -1];
    const b = [SHELL.center[0] + 3, -1, 1.5];
    const moved = [placeOnHalf(frame, 1, 1, a), placeOnHalf(frame, 1, 1, b)];
    expect(Math.abs(distance(...moved) - distance(a, b))).toBeLessThan(1e-9);
  });

  it('slice: no piece is ever pushed down into the tray', () => {
    const flat = makeCutFrame(planeThroughPoint(SHELL.center, [0, 1, 0]));
    expect(flat.slideNeg[1]).toBeGreaterThan(-1e-9);
    expect(flat.slidePos[1]).toBeGreaterThan(0.5);
    // A horizontal cut lifts like a lid: nothing to tip about.
    expect(flat.tilt).toBe(0);
  });
});

describe('cut spring', () => {
  it('slice: opens to fully open with a bounded overshoot, and settles', () => {
    let state = { open: 0, velocity: 0 };
    let peak = 0;
    for (let i = 0; i < 180; i += 1) {
      state = cutSpringStep(state, 1, 1 / 60);
      peak = Math.max(peak, state.open);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.25);
    expect(Math.abs(state.open - 1)).toBeLessThan(0.01);
  });

  it('slice: closing never passes through shut', () => {
    let state = { open: 1, velocity: 0 };
    for (let i = 0; i < 120; i += 1) {
      state = cutSpringStep(state, 0, 1 / 60);
      expect(state.open).toBeGreaterThan(-1e-12);
    }
    expect(state.open).toBeLessThan(CUT.shutEpsilon);
  });

  it('slice: reduced motion opens without overshoot', () => {
    const calm = cutConfig(true);
    let state = { open: 0, velocity: 0 };
    for (let i = 0; i < 240; i += 1) {
      state = cutSpringStep(state, 1, 1 / 60, calm);
      expect(state.open).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(state.open).toBeGreaterThan(0.98);
    expect(cutConfig(false)).toBe(CUT);
  });

  it('slice: a stalled frame cannot fling the halves', () => {
    const state = cutSpringStep({ open: 0, velocity: 0 }, 1, 5);
    expect(state.open).toBeLessThan(0.5);
  });
});

describe('droplets', () => {
  const frame = makeCutFrame(MIDLINE);

  it('slice: the splash is deterministic per seed and the right size', () => {
    const a = spawnDroplets(frame, 'cut-1');
    const b = spawnDroplets(frame, 'cut-1');
    expect(a.length).toBe(DROPLETS.count);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('slice: droplets start on the cut face and fly off their own side, upward', () => {
    for (const droplet of spawnDroplets(frame, 'cut-2')) {
      expect(Math.abs(dot(frame.normal, droplet.origin) - frame.d)).toBeLessThan(1e-9);
      expect(dot(frame.normal, droplet.velocity) * droplet.side).toBeGreaterThan(0);
      expect(droplet.velocity[1]).toBeGreaterThan(0);
    }
  });

  it('slice: a droplet lands and stays on the floor, never under it', () => {
    const origin = [SHELL.center[0], 1, SHELL.center[2]];
    const velocity = [1.5, 4, 0];
    let landed = false;
    for (let t = 0; t <= DROPLETS.life; t += 0.02) {
      const { position, splat } = dropletAt(origin, velocity, t);
      expect(position[1]).toBeGreaterThan(floorAt(position[0], position[2]) - 1e-9);
      if (splat) landed = true;
    }
    expect(landed).toBe(true);
    expect(dropletAt(origin, velocity, DROPLETS.life).size).toBe(0);
  });

  it('slice: a droplet thrown past the tray falls to the bench', () => {
    const { position, splat } = dropletAt([SHELL.center[0] + 5.5, 0, SHELL.center[2]], [6, 2, 0], 1.2);
    expect(splat).toBe(1);
    expect(position[1]).toBeLessThan(DROPLETS.trayY - 0.2);
  });
});
