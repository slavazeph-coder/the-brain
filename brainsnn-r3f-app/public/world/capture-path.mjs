// Capture path: where the camera actually was. A reconstruction's cameras (camera_to_world_y_up, 4×4, from the adapter's
// reconstruction.json) become eye positions and forward directions the viewer can look from. An interior only reads from
// inside; from outside it is a shell. Views between two cameras are interpolated (position linear, forward slerp-ish).
const finite = (v) => Number.isFinite(v);

/** Eye and forward (unit) of one camera_to_world_y_up matrix. OpenCV cameras look down their local +z; after the
 *  adapter's diag(1,-1,-1) conjugation the local forward is -z. Returns null for anything that is not a rigid pose. */
export function cameraPose(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 4 || matrix.some(r => !Array.isArray(r) || r.length !== 4 || r.some(v => !finite(v)))) return null;
  const eye = [matrix[0][3], matrix[1][3], matrix[2][3]];
  const f = [-matrix[0][2], -matrix[1][2], -matrix[2][2]], n = Math.hypot(...f);
  if (!(n > 1e-6) || Math.abs(matrix[3][0]) + Math.abs(matrix[3][1]) + Math.abs(matrix[3][2]) > 1e-4 || Math.abs(matrix[3][3] - 1) > 1e-4) return null;
  return { eye, forward: f.map(v => v / n) };
}

/** The ordered, valid poses of a reconstruction evidence object (cameras[].camera_to_world_y_up). */
export function capturePath(reconstruction) {
  const cameras = Array.isArray(reconstruction?.cameras) ? reconstruction.cameras : [];
  return cameras.map(c => cameraPose(c?.camera_to_world_y_up)).filter(Boolean).slice(0, 4096);
}

/** The view at a fractional index t ∈ [0, n-1]: positions interpolated, forward normalised between neighbours. */
export function viewAt(path, t) {
  if (!path.length) return null;
  const u = Math.max(0, Math.min(path.length - 1, finite(t) ? t : 0)), i = Math.floor(u), k = u - i, a = path[i], b = path[Math.min(path.length - 1, i + 1)];
  const eye = a.eye.map((v, j) => v + (b.eye[j] - v) * k);
  const f = a.forward.map((v, j) => v + (b.forward[j] - v) * k), n = Math.hypot(...f);
  return { eye, forward: n > 1e-6 ? f.map(v => v / n) : a.forward, index: i, fraction: k };
}

/** Yaw/pitch of a forward vector in the viewer's orbit convention (eye = target + d·[sin yaw cos pitch, sin pitch, cos yaw cos pitch]). */
export function orbitAngles(forward) {
  const back = forward.map(v => -v);
  return { yaw: Math.atan2(back[0], back[2]), pitch: Math.asin(Math.max(-1, Math.min(1, back[1]))) };
}

/** The walk's length in metres (or units) along the camera path. */
export function pathLength(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(...path[i].eye.map((v, j) => v - path[i - 1].eye[j]));
  return d;
}
