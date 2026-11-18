"""The surface under a hole: its curved shape first, the thin plate on what is left.

`repair.fit_reference_surface` fits one height per grid cell -- the data
where there is some, a thin plate across the gap. On a flat sole that is all
it needs. On anything curved it is not: the plate's bending price is paid
on the grid's reflecting edges too, so a dome fitted with the stiffness the
fill uses (six cells) comes out flattened -- low in the middle, high at the
sides. Measured on the shoe against the scan itself, the surface under the
hole sat 8 splat spacings inside the collar, 5-6 inside the sole's rounded
edge and 3.5 inside the toe cap, and every copy laid on it sank with it.
Donors happened to cancel part of it (their relief is measured against the
same flattened surface), which is why it went unseen on the lattice.

So the curved part comes first: a low-order polynomial fitted, robustly, to
the surface in a ring around the hole -- the curvature the hole's own
neighbourhood has -- and the thin plate fits only what that leaves, which is
near zero round the hole and has no curvature for the plate to flatten.

API (also for the stamp, which needs the same surface under a stamp):

``trend(data, known, near, deg=2)``
    The polynomial, evaluated on the whole grid. ``data``: heights per cell
    (NaN where none), ``known``: cells that hold surface, ``near``: the cells
    the fit should listen to (a ring round the hole).

``complete(data, known, hole, smooth_cells=6.0, deg=2, ring=None, **kw)``
    The whole surface on the grid: trend plus a thin plate over the rest.
    ``hole``: the cells to complete; ``ring``: how many cells round the hole
    the trend is fitted on (default: the hole's own radius, at least 6).
    ``kw`` goes to `repair.fit_reference_surface` (``exact``, ``need``,
    ``fast``). ``deg=0`` is the plain thin plate.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage


def _design(x, y, deg):
    cols = []
    for i in range(deg + 1):
        for j in range(deg + 1 - i):
            cols.append((x ** i) * (y ** j))
    return np.stack(cols, -1)


def trend(data, known, near, deg=2, iters=3, k=3.0, w=None):
    """Robust polynomial of degree ``deg`` through ``data`` on ``known & near``."""
    nv, nu = data.shape
    m = known & near & np.isfinite(data)
    if m.sum() < 3 * (deg + 1) * (deg + 2) // 2 + 6:
        m = known & np.isfinite(data)
    if m.sum() < (deg + 1) * (deg + 2) // 2 + 3:
        return None
    yy, xx = np.mgrid[0:nv, 0:nu].astype(np.float64)
    cy, cx = yy[m].mean(), xx[m].mean()
    sc = max(float(np.sqrt(((yy[m] - cy) ** 2 + (xx[m] - cx) ** 2).mean())), 1.0)
    A = _design((xx[m] - cx) / sc, (yy[m] - cy) / sc, deg)
    b = data[m]
    ww = np.ones(len(b)) if w is None else np.asarray(w, float)[m]
    inl = np.ones(len(b), bool)
    coef = None
    for _ in range(iters):
        sw = np.sqrt(ww[inl])
        coef = np.linalg.lstsq(A[inl] * sw[:, None], b[inl] * sw, rcond=None)[0]
        res = b - A @ coef
        mad = 1.4826 * float(np.median(np.abs(res[inl] - np.median(res[inl]))))
        nxt = np.abs(res) < k * max(mad, 1e-12)
        if nxt.sum() < A.shape[1] + 3 or np.array_equal(nxt, inl):
            break
        inl = nxt
    G = _design((xx - cx) / sc, (yy - cy) / sc, deg)
    return G @ coef


def complete(data, known, hole, smooth_cells=6.0, deg=2, ring=None, **kw):
    """Trend plus thin plate: the surface on the whole grid (see the module doc)."""
    from .repair import fit_reference_surface
    T = None
    if deg > 0 and hole.any():
        if ring is None:
            ring = max(6.0, float(np.sqrt(hole.sum() / np.pi)))
        d = ndimage.distance_transform_edt(~hole)
        T = trend(data, known, (d > 0) & (d <= ring), deg)
    if T is None:
        return fit_reference_surface(data, known, smooth_cells=smooth_cells, **kw)
    return T + fit_reference_surface(data - T, known, smooth_cells=smooth_cells, **kw)
