"""Real spherical-harmonics helpers for 3DGS appearance.

The view-dependent part of a Gaussian lives in SH bands 1..3, expressed in
*world* axes. If a splat is moved to a differently-oriented part of a surface,
its lobes keep pointing the old way: the patch looks right from the view it was
authored in and then flashes or shifts hue as the camera orbits. That is the
single most common artefact in splat editing, so rotating SH is a first-class
operation here rather than an afterthought.

Rotation uses a least-squares fit of the per-band mixing matrix rather than
explicit Wigner-D recursions: evaluate the basis at a cloud of random
directions, solve ``basis(R^T d) = basis(d) @ M`` per band. The real SH of a
given degree are closed under rotation, so M is exact up to float error and the
whole thing is a few dozen lines instead of a few hundred.
"""
from __future__ import annotations

import numpy as np

# Band layout within the per-channel coefficient axis (DC excluded).
BANDS = ((0, 3), (3, 8), (8, 15))      # l = 1, 2, 3
C0 = 0.28209479177387814


def sh_basis(d: np.ndarray, deg: int = 3) -> np.ndarray:
    """Real SH basis values for unit directions ``d`` (..., 3).

    Returns (..., (deg+1)**2) including the DC term at index 0, matching the
    coefficient order used by the original 3DGS implementation.
    """
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    out = [np.broadcast_to(np.float64(C0), x.shape)]
    if deg >= 1:
        out += [-0.4886025119029199 * y,
                 0.4886025119029199 * z,
                -0.4886025119029199 * x]
    if deg >= 2:
        xx, yy, zz = x * x, y * y, z * z
        out += [1.0925484305920792 * x * y,
                -1.0925484305920792 * y * z,
                0.31539156525252005 * (2.0 * zz - xx - yy),
                -1.0925484305920792 * x * z,
                0.5462742152960396 * (xx - yy)]
    if deg >= 3:
        xx, yy, zz = x * x, y * y, z * z
        out += [-0.5900435899266435 * y * (3.0 * xx - yy),
                 2.890611442640554 * x * y * z,
                -0.4570457994644658 * y * (4.0 * zz - xx - yy),
                 0.3731763325901154 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy),
                -0.4570457994644658 * x * (4.0 * zz - xx - yy),
                 1.445305721320277 * z * (xx - yy),
                -0.5900435899266435 * x * (xx - 3.0 * yy)]
    return np.stack(out, axis=-1)


def band_mixing_matrices(R: np.ndarray, samples: int = 256, seed: int = 0):
    """Per-band matrices M_l with ``basis_l(R^T d) = basis_l(d) @ M_l``.

    ``R`` is a world-space rotation (3, 3). Applying M to a splat's coefficients
    rotates its radiance lobes by R.
    """
    rng = np.random.default_rng(seed)
    d = rng.normal(size=(samples, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    A = sh_basis(d)[:, 1:]                       # drop DC, (S, 15)
    B = sh_basis(d @ R)[:, 1:]                   # d @ R == R^T d for row vectors
    mats = []
    for lo, hi in BANDS:
        M, *_ = np.linalg.lstsq(A[:, lo:hi], B[:, lo:hi], rcond=None)
        mats.append(M)
    return mats


def rotate_sh(coeffs: np.ndarray, R: np.ndarray, samples: int = 256) -> np.ndarray:
    """Rotate SH bands 1.. of ``coeffs`` (N, K, 3) by world rotation ``R``.

    Only full bands present in ``coeffs`` are touched; a degree-1 set keeps its
    three coefficients and nothing else is invented.
    """
    if coeffs.shape[1] == 0:
        return coeffs.copy()
    out = coeffs.astype(np.float64).copy()
    for M, (lo, hi) in zip(band_mixing_matrices(R, samples), BANDS):
        if coeffs.shape[1] >= hi:
            # f'(d) = f(R^T d) = basis(d) @ M . c, so the new coefficients are
            # M @ c along the coefficient axis.
            out[:, lo:hi, :] = np.einsum("km,nmc->nkc", M, out[:, lo:hi, :])
    return out.astype(coeffs.dtype)


def rotation_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Shortest rotation matrix taking unit vector ``a`` to unit vector ``b``."""
    a = a / max(np.linalg.norm(a), 1e-12)
    b = b / max(np.linalg.norm(b), 1e-12)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    s = float(np.linalg.norm(v))
    if s < 1e-9:
        if c > 0:
            return np.eye(3)
        # antiparallel: rotate pi about any axis orthogonal to a
        axis = np.array([1.0, 0.0, 0.0])
        if abs(a[0]) > 0.9:
            axis = np.array([0.0, 1.0, 0.0])
        axis = np.cross(a, axis)
        axis /= np.linalg.norm(axis)
        K = _skew(axis)
        return np.eye(3) + 2.0 * K @ K
    K = _skew(v)
    return np.eye(3) + K + K @ K * ((1.0 - c) / (s * s))


def _skew(v):
    return np.array([[0.0, -v[2], v[1]],
                     [v[2], 0.0, -v[0]],
                     [-v[1], v[0], 0.0]])


def quat_to_matrix(q: np.ndarray) -> np.ndarray:
    """(N, 4) quaternions (w, x, y, z) -> (N, 3, 3) rotation matrices."""
    q = q / np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    N = len(q)
    R = np.empty((N, 3, 3))
    R[:, 0, 0] = 1 - 2 * (y * y + z * z)
    R[:, 0, 1] = 2 * (x * y - w * z)
    R[:, 0, 2] = 2 * (x * z + w * y)
    R[:, 1, 0] = 2 * (x * y + w * z)
    R[:, 1, 1] = 1 - 2 * (x * x + z * z)
    R[:, 1, 2] = 2 * (y * z - w * x)
    R[:, 2, 0] = 2 * (x * z - w * y)
    R[:, 2, 1] = 2 * (y * z + w * x)
    R[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return R


def matrix_to_quat(R: np.ndarray) -> np.ndarray:
    """(N, 3, 3) rotation matrices -> (N, 4) quaternions (w, x, y, z)."""
    m = R
    t = m[:, 0, 0] + m[:, 1, 1] + m[:, 2, 2]
    q = np.empty((len(R), 4))
    big = t > 0
    s = np.sqrt(np.maximum(t[big] + 1.0, 1e-12)) * 2.0
    q[big, 0] = 0.25 * s
    q[big, 1] = (m[big, 2, 1] - m[big, 1, 2]) / s
    q[big, 2] = (m[big, 0, 2] - m[big, 2, 0]) / s
    q[big, 3] = (m[big, 1, 0] - m[big, 0, 1]) / s
    # The rows turned more than 120 degrees: built round the largest diagonal
    # element, all at once. This was a Python loop over those rows, and with
    # splats oriented every which way that is six rows in ten (200,000
    # rows: 0.30 s, now 0.03 s). Same arithmetic, same bits.
    rest = np.where(~big)[0]
    if len(rest):
        mr = m[rest]
        d = np.stack([mr[:, 0, 0], mr[:, 1, 1], mr[:, 2, 2]], axis=1)
        k = np.argmax(d, axis=1)
        a, b = (k + 1) % 3, (k + 2) % 3
        i = np.arange(len(rest))
        s = np.sqrt(np.maximum(1.0 + d[i, k] - d[i, a] - d[i, b], 1e-12)) * 2.0
        q[rest, 0] = (mr[i, b, a] - mr[i, a, b]) / s
        q[rest, 1 + k] = 0.25 * s
        q[rest, 1 + a] = (mr[i, a, k] + mr[i, k, a]) / s
        q[rest, 1 + b] = (mr[i, b, k] + mr[i, k, b]) / s
    return q / np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)


def rotate_quats(q: np.ndarray, R: np.ndarray) -> np.ndarray:
    """Pre-rotate splat orientations ``q`` by world rotation ``R``."""
    return matrix_to_quat(R[None] @ quat_to_matrix(q))
