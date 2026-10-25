import * as THREE from "three";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export function softPulse(value, floor = 0.02, ceiling = 1) {
  return clamp(value, floor, ceiling);
}

export function getQuadraticPoint(start, control, end, t) {
  const point = new THREE.Vector3();
  point.set(
    (1 - t) ** 2 * start.x +
      2 * (1 - t) * t * control.x +
      t ** 2 * end.x,
    (1 - t) ** 2 * start.y +
      2 * (1 - t) * t * control.y +
      t ** 2 * end.y,
    (1 - t) ** 2 * start.z +
      2 * (1 - t) * t * control.z +
      t ** 2 * end.z
  );
  return point;
}

export function pathwayCenter(start, end, offset = [0, 0, 0]) {
  return new THREE.Vector3(
    (start[0] + end[0]) / 2 + offset[0],
    (start[1] + end[1]) / 2 + offset[1],
    (start[2] + end[2]) / 2 + offset[2]
  );
}
