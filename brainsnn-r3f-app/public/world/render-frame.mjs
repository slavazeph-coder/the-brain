/** Display-only source-frame conversion. Never rewrite source coordinates or hashes. */
const vector = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw Error(`Use three finite ${name} coordinates.`);
  return [...value];
};

export function rebasePoint(point, origin) { return point.slice(0, 3).map((n, i) => n - origin[i]); }
export function sourcePoint(point, origin) { return point.slice(0, 3).map((n, i) => n + origin[i]); }

/** Translate a source-world rest matrix into the local render frame. Column-major. */
export function rebaseRestMatrix(matrix, origin) {
  const result = [...matrix];
  for (let i = 0; i < 3; i++) result[12 + i] -= origin[i];
  return result;
}

/** T(-origin) * sourceWorldTransform * T(origin), including rotated pivot poses. */
export function rebaseWorldTransform(matrix, origin) {
  const result = [...matrix];
  for (let row = 0; row < 3; row++) result[12 + row] += matrix[row] * origin[0] + matrix[4 + row] * origin[1] + matrix[8 + row] * origin[2] - origin[row];
  return result;
}

export function checkedClip(value) {
  if (value === null || value === undefined) return null;
  const min = vector(value.min, 'section minimum'), max = vector(value.max, 'section maximum');
  if (max.some((n, i) => n < min[i])) throw Error('Section maxima must not be below their minima.');
  return {min, max};
}

export function insideClip(point, clip, epsilon = 1e-7) {
  return !clip || point.slice(0, 3).every((n, i) => n >= clip.min[i] - epsilon && n <= clip.max[i] + epsilon);
}

/** Shared scan/model frame; source positions stay Float64 until after this origin is subtracted. */
export function renderFrame(parts, pointCloud = [], shared = null) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const include = point => point.slice(0, 3).forEach((n, i) => { if (!Number.isFinite(n)) throw Error('Use finite source geometry.'); min[i] = Math.min(min[i], n); max[i] = Math.max(max[i], n); });
  const bounded = parts.filter(p => p.centre && p.size), models = bounded.some(p => !p.floor) ? bounded.filter(p => !p.floor) : bounded;
  for (const part of models) {
    const angle = (part.yaw ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      const px = x * part.size[0], pz = z * part.size[2];
      include([part.centre[0] + c * px + s * pz, part.centre[1] + y * part.size[1], part.centre[2] - s * px + c * pz]);
    }
  }
  for (const point of pointCloud) include(point);
  const empty = min[0] === Infinity, centre = empty ? [0, 0, 0] : min.map((n, i) => (n + max[i]) / 2);
  const origin = shared ? vector(shared.centre, 'shared frame') : centre;
  const span = shared ? shared.span : empty ? 5 : Math.max(...max.map((n, i) => n - min[i]), 1);
  if (!Number.isFinite(span) || span <= 0) throw Error('Use a positive finite shared frame span.');
  return {origin, span, min: empty ? [...origin] : min, max: empty ? [...origin] : max};
}
