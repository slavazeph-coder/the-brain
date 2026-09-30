// The jelly brain's surface, generated rather than downloaded.
//
// A procedural shell instead of a GLB for three reasons: it costs no bytes on
// the homepage beyond this file, it is deterministic (the same brain on every
// device and in every recorded clip), and it is built around the existing
// seven-region layout in brainRegions.js — the connectome that the rest of the
// site already renders sits inside it rather than being replaced.
//
// Three-free by design, so the geometry is unit-testable in bare Node and the
// only module that imports three stays PokeBrainScene.jsx.
import { BRAIN_REGIONS } from '../../brain3d/brainRegions.js';

// Sized so every region node sits comfortably inside the surface; the tests
// hold that line so a tweak to the proportions cannot leave a node poking out.
export const SHELL = Object.freeze({
  center: Object.freeze([0.15, 0.12, -0.2]),
  radii: Object.freeze([5.4, 3.75, 3.85]),
});

export const SHELL_DETAIL = Object.freeze({
  high: Object.freeze({ lat: 110, lon: 168, grooveWidth: 0.11, grooveDepth: 0.3 }),
  low: Object.freeze({ lat: 64, lon: 96, grooveWidth: 0.17, grooveDepth: 0.26 }),
  // Invisible, coarse and ungrooved: what pointer rays are tested against. A
  // ray against ~2k triangles costs nothing; against the visible 37k it would
  // cost a millisecond or two on every pointer move.
  proxy: Object.freeze({ lat: 28, lon: 42, grooveWidth: 0.2, grooveDepth: 0 }),
});

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Overall brain silhouette as a radial scale on the unit direction `d`.
 * +x is frontal, -x occipital, +y dorsal and ±z the two hemispheres.
 */
export function silhouette(x, y, z) {
  // The longitudinal fissure: a groove along the dorsal midline that splits
  // the hemispheres, fading out towards the base.
  const fissure = Math.exp(-(z * z) / 0.008) * smoothstep(-0.2, 0.45, y) * 0.24;
  // The lateral (Sylvian) fissure: a crease on each side separating the
  // temporal lobe, rising from the front towards the back.
  const sylvianLine = y + 0.14 - 0.42 * (x + 0.1);
  const sylvian = Math.exp(-(sylvianLine * sylvianLine) / 0.0035)
    * smoothstep(0.3, 0.72, Math.abs(z)) * smoothstep(-0.5, 0.05, x) * (1 - smoothstep(0.5, 0.85, x)) * 0.08;
  // A cerebellum-like swell, low at the back.
  const cerebellum = Math.exp(-((x + 0.7) ** 2) / 0.035 - ((y + 0.5) ** 2) / 0.05) * 0.1;
  // Temporal lobes: a low lateral bulge, slightly frontal.
  const temporal = Math.exp(-((y + 0.42) ** 2) / 0.05) * Math.exp(-((x - 0.1) ** 2) / 0.22) * Math.abs(z) * 0.14;
  // A flatter base than the dome.
  const base = y < -0.35 ? (y + 0.35) * 0.28 : 0;
  // Frontal pole slightly blunter, occipital pole slightly narrower.
  const poles = x > 0 ? -0.03 * x * x : -0.05 * x * x * Math.abs(z);
  return 1 - fissure - sylvian + temporal + base + poles + cerebellum;
}

/**
 * Sulci as the zero-crossings of a domain-warped trigonometric field.
 * Returns a groove weight in 0..1 — 1 in the bottom of a sulcus, 0 on a gyrus.
 */
export function grooveAt(x, y, z, width) {
  const wx = x + 0.34 * Math.sin(3.1 * y + 1.7) + 0.18 * Math.sin(5.3 * z + 0.3);
  const wy = y + 0.34 * Math.sin(3.7 * z + 0.4) + 0.18 * Math.sin(4.9 * x + 1.1);
  const wz = z + 0.34 * Math.sin(2.9 * x + 2.1) + 0.18 * Math.sin(6.1 * y + 2.6);
  const a = Math.sin(7.4 * wx + 2.0 * Math.sin(4.0 * wy));
  const b = Math.sin(7.8 * wy + 2.2 * Math.sin(3.6 * wz));
  const c = Math.sin(7.0 * wz + 2.4 * Math.sin(4.4 * wx));
  const v = (a + b + c) / 3;
  return Math.exp(-((v / width) ** 2));
}

/**
 * Build the shell as flat typed arrays ready for a BufferGeometry.
 * @param {'high'|'low'} detail
 */
export function buildBrainShell(detail = 'high') {
  const spec = SHELL_DETAIL[detail] || SHELL_DETAIL.high;
  const { lat, lon, grooveWidth, grooveDepth } = spec;
  const [cx, cy, cz] = SHELL.center;
  const [rx, ry, rz] = SHELL.radii;
  const rows = lat + 1;
  const cols = lon + 1;
  const vertexCount = rows * cols;
  const positions = new Float32Array(vertexCount * 3);
  const folds = new Float32Array(vertexCount);

  for (let i = 0; i < rows; i += 1) {
    const theta = (i / lat) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j < cols; j += 1) {
      const phi = (j / lon) * Math.PI * 2;
      const dx = sinT * Math.cos(phi);
      const dy = cosT;
      const dz = sinT * Math.sin(phi);
      const scale = silhouette(dx, dy, dz);
      const groove = grooveAt(dx, dy, dz, grooveWidth);
      // Carve along the ellipsoid normal so grooves read as grooves on every
      // side, not only on the side facing the axis the radii stretch.
      let nx = dx / rx;
      let ny = dy / ry;
      let nz = dz / rz;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen; ny /= nLen; nz /= nLen;
      const index = i * cols + j;
      positions[index * 3] = cx + rx * dx * scale - nx * grooveDepth * groove;
      positions[index * 3 + 1] = cy + ry * dy * scale - ny * grooveDepth * groove;
      positions[index * 3 + 2] = cz + rz * dz * scale - nz * grooveDepth * groove;
      folds[index] = 1 - groove;
    }
  }

  const triangleCount = lat * lon * 2;
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(triangleCount * 3);
  let cursor = 0;
  for (let i = 0; i < lat; i += 1) {
    for (let j = 0; j < lon; j += 1) {
      const a = i * cols + j;
      const b = a + cols;
      const c = b + 1;
      const d = a + 1;
      // Counter-clockwise seen from outside, so three's FrontSide is the
      // outside and computed normals point outward. Pole rows produce
      // degenerate triangles; they carry no area and are harmless to draw.
      indices[cursor++] = a; indices[cursor++] = d; indices[cursor++] = b;
      indices[cursor++] = b; indices[cursor++] = d; indices[cursor++] = c;
    }
  }

  const normals = computeNormals(positions, indices, rows, cols);
  return { positions, normals, folds, indices, vertexCount, triangleCount, detail: spec };
}

/**
 * Area-weighted vertex normals, welded across the longitude seam and at both
 * poles so the lighting has no crease where the grid wraps around.
 */
export function computeNormals(positions, indices, rows, cols) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }

  // Weld the seam: column 0 and column lon share a position.
  for (let i = 0; i < rows; i += 1) {
    const first = (i * cols) * 3;
    const last = (i * cols + cols - 1) * 3;
    for (let k = 0; k < 3; k += 1) {
      const sum = normals[first + k] + normals[last + k];
      normals[first + k] = sum;
      normals[last + k] = sum;
    }
  }
  // Weld each pole: every vertex in the first/last row is the same point.
  for (const row of [0, rows - 1]) {
    let sx = 0; let sy = 0; let sz = 0;
    for (let j = 0; j < cols; j += 1) {
      const v = (row * cols + j) * 3;
      sx += normals[v]; sy += normals[v + 1]; sz += normals[v + 2];
    }
    for (let j = 0; j < cols; j += 1) {
      const v = (row * cols + j) * 3;
      normals[v] = sx; normals[v + 1] = sy; normals[v + 2] = sz;
    }
  }

  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    normals[v] /= length;
    normals[v + 1] /= length;
    normals[v + 2] /= length;
  }
  return normals;
}

/**
 * Where a straight line from the shell centre through `point` meets the smooth
 * ellipsoid (grooves ignored). Used to place a surface flash above a region
 * when a signal arrives there from inside.
 */
export function surfacePointToward(point) {
  const [cx, cy, cz] = SHELL.center;
  const [rx, ry, rz] = SHELL.radii;
  let dx = point[0] - cx;
  let dy = point[1] - cy;
  let dz = point[2] - cz;
  if (Math.hypot(dx, dy, dz) < 1e-6) dy = 1;
  const k = 1 / Math.hypot(dx / rx, dy / ry, dz / rz);
  return [cx + dx * k, cy + dy * k, cz + dz * k];
}

/** 0 at the centre, 1 on the smooth ellipsoid. */
export function shellDepth(point) {
  const [cx, cy, cz] = SHELL.center;
  const [rx, ry, rz] = SHELL.radii;
  return Math.hypot((point[0] - cx) / rx, (point[1] - cy) / ry, (point[2] - cz) / rz);
}

export const REGION_DEPTHS = Object.freeze(Object.fromEntries(
  BRAIN_REGIONS.map((region) => [region.code, shellDepth(region.position)]),
));
