"""The selection as a painted volume, not only as a list of splats.

Where a hole has no splats, a selection made of splat indices has nothing to
say about it: the masks built from the selected centres miss exactly the part
that most needs filling. So the viewport sends, with every command that uses
the selection, the volume the user painted. It is defined in world (= file)
coordinates and can be projected into any camera, whether or not splats lie
inside it.

This module is the reference implementation of that volume. The app
(``app/src/engine/volume.ts`` + ``selection.ts``) computes the same membership
test; ``tests/test_volume.py`` pins both down.

Wire format
-----------
Sent as the header key ``"volume"`` (absent or ``null`` when the selection
was not painted, e.g. debris, invert, a transform result)::

    "volume": {
      "version": 1,
      "view": [dx, dy, dz],                 # view of the newest op, unit, world
      "capsules": [[x0, y0, z0, x1, y1, z1, r, depth, seq, vx, vy, vz], ...],
      "subtract": [[... same shape ...], ...],
      "regions":  [{...}, ...],             # lasso and box, see below
      "exact": true                          # the selection is exactly the
                                             # splats inside (false: the
                                             # volume was added on top of an
                                             # unpainted selection)
    }

Capsule rows. The first eight numbers are the agreed minimum; ``seq`` and
the view are optional (``seq`` defaults to 0, the view to the top-level
``view``):

- ``(x0, y0, z0) - (x1, y1, z1)``: the segment between two consecutive
  brush dabs, each anchored on the surface under the cursor (a single dab
  is a degenerate segment).
- ``r``: brush radius in world units at that depth (pixels x world/pixel).
- ``depth``: the half-extent along the paint view ray ``v``.
- The shape is the segment swept by an ellipsoid with semi-axes
  ``(r, r, depth)``, the short one along ``v``. Formally, with
  ``T(y) = y + v (y.v) (r/depth - 1)`` (a linear squash along ``v``), a point
  ``x`` is inside iff ``dist(T(x - a), T([0, b - a])) <= r``.
- Subtract rows are the same shape. The app sends them with twice the add
  window (``depth``), so that un-painting a spot from the view it was painted
  from removes all of it, not all but a thin sliver.

Regions (lasso and box) are the screen polygon extruded over a depth window
around the visible surface, in the camera they were drawn in::

    {"mode": "add" | "subtract", "seq": int, "view": [3],
     "vp": [16 floats],          # view-projection, column-major (PlayCanvas):
                                 # clip = M @ [x, y, z, 1], M[row, col] = vp[col*4+row]
     "size": [W, H],             # viewport in CSS pixels (floats)
     "polygon": [[x, y], ...],   # pixels, y down
     "through": bool,            # true: every depth, no surface window
     "cell": 6,                  # depth-grid cell size in pixels
     "grid": [gx0, gy0, gw, gh], # the cells stored below, in cell units
     "depth": [gw*gh floats or null],  # surface depth per cell (camera w);
                                       # holes inside the polygon are filled
     "back_per_depth": float,    # window behind the surface = this * d0
     "front_scale": float,       # window in front = back * front_scale
     "near": float, "far": float # camera-depth range the region spans
    }

Membership of a point in a region (exactly as ``selectInRegion``): project
with ``vp``; the pixel ``(trunc(px), trunc(py))`` must be inside the polygon
(scanline fill, pixel centres); unless ``through``, the cell
``(trunc(px/6), trunc(py/6))`` must have a finite depth ``d0`` and the
point's depth ``w`` must lie in ``[d0 - back*front_scale, d0 + back]`` with
``back = max(back_per_depth * d0, 1e-6)``.

Order. Every op (one brush stroke, one lasso, one box) has one ``seq``,
increasing. A point is inside the volume iff the newest primitive containing
it is an add; on equal ``seq`` the subtract wins. So paint, un-paint, paint
again over the same spot ends selected, as in any paint program, and a
volume without ``seq`` reads as "union of capsules minus union of subtract".

API
---
- ``Volume.from_wire(d)`` / ``from_wire(d)``: parse (``None`` for no volume).
- ``Volume.inside(points) -> bool[N]``.
- ``Volume.mask_in_view(cam, W, H, grow=0) -> bool[H, W]``: pixels whose
  ray passes through the volume, in a ``gpu.Camera`` (OpenCV: ``view`` 4x4
  world->camera, +z forward, +y down; ``K`` 3x3; pixel centres at +0.5).
  Exact per ray (capsule intervals in closed form, regions sampled along the
  ray), works where no splat exists.
- ``Volume.surface_points(spacing=None) -> float[N, 3]``: points on the
  painted surface (the mid-surface of each capsule, the surface cells of each
  region, holes included), for filling where there are no splats.
- ``Volume.bounds() -> (lo[3], hi[3])``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

CELL = 6


# --------------------------------------------------------------- primitives

@dataclass
class Capsule:
    a: np.ndarray
    b: np.ndarray
    r: float
    depth: float
    seq: int
    view: np.ndarray
    add: bool

    def aabb(self):
        # Along v the reach is `depth`, across it `r`: pad by the larger.
        pad = max(self.r, self.depth)
        lo = np.minimum(self.a, self.b) - pad
        hi = np.maximum(self.a, self.b) + pad
        return lo, hi


@dataclass
class Region:
    add: bool
    seq: int
    view: np.ndarray
    M: np.ndarray                  # 4x4 row-major: clip = M @ [x, y, z, 1]
    W: float
    H: float
    polygon: np.ndarray            # (n, 2)
    through: bool
    cell: int
    grid: tuple                    # gx0, gy0, gw, gh
    depth: np.ndarray              # (gh, gw), inf where none
    back_per_depth: float
    front_scale: float
    near: float
    far: float
    _mask: Optional[np.ndarray] = field(default=None, repr=False)

    @property
    def mask_wh(self):
        return max(1, int(self.W)), max(1, int(self.H))

    def mask(self) -> np.ndarray:
        if self._mask is None:
            w, h = self.mask_wh
            self._mask = fill_polygon(self.polygon, w, h)
        return self._mask

    def unproject(self, px, py, w):
        """Pixel + camera depth (clip w) back to world points, (n, 3)."""
        px = np.asarray(px, np.float64)
        py = np.asarray(py, np.float64)
        w = np.asarray(w, np.float64)
        hw, hh = self.W * 0.5, self.H * 0.5
        nx = (px - hw) / hw
        ny = (hh - py) / hh
        M = self.M
        # rows: (M0 - nx M3) . X~ = 0, (M1 - ny M3) . X~ = 0, M3 . X~ = w
        r0 = M[0][None, :] - nx[:, None] * M[3][None, :]
        r1 = M[1][None, :] - ny[:, None] * M[3][None, :]
        r3 = np.broadcast_to(M[3], r0.shape)
        A = np.stack([r0[:, :3], r1[:, :3], r3[:, :3]], 1)
        rhs = np.stack([-r0[:, 3], -r1[:, 3], w - r3[:, 3]], 1)
        return np.linalg.solve(A, rhs[..., None])[..., 0]

    def corners(self):
        """World corners of the region's frustum between near and far."""
        poly = self.polygon
        x0, y0 = poly.min(0)
        x1, y1 = poly.max(0)
        px = np.array([x0, x1, x1, x0] * 2, float)
        py = np.array([y0, y0, y1, y1] * 2, float)
        w = np.array([self.near] * 4 + [self.far] * 4, float)
        return self.unproject(px, py, w)

    def inside(self, P: np.ndarray) -> np.ndarray:
        P = np.asarray(P, np.float64)
        M = self.M
        cw = P @ M[3, :3] + M[3, 3]
        cx = P @ M[0, :3] + M[0, 3]
        cy = P @ M[1, :3] + M[1, 3]
        ok = cw > 1e-6
        inv = np.where(ok, 1.0 / np.where(ok, cw, 1.0), 0.0)
        hw, hh = self.W * 0.5, self.H * 0.5
        # float32, as the app stores the projected positions
        px = ((cx * inv) * hw + hw).astype(np.float32).astype(np.float64)
        py = (hh - (cy * inv) * hh).astype(np.float32).astype(np.float64)
        dz = cw.astype(np.float32).astype(np.float64)
        w, h = self.mask_wh
        with np.errstate(invalid="ignore"):
            ix = np.trunc(px)
            iy = np.trunc(py)
        ok &= np.isfinite(ix) & np.isfinite(iy)
        ok &= (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
        out = np.zeros(len(P), bool)
        idx = np.where(ok)[0]
        if not len(idx):
            return out
        m = self.mask()
        hit = m[iy[idx].astype(np.int64), ix[idx].astype(np.int64)]
        idx = idx[hit]
        if self.through:
            out[idx] = True
            return out
        gx0, gy0, gw, gh = self.grid
        cxi = np.trunc(px[idx] / self.cell).astype(np.int64) - gx0
        cyi = np.trunc(py[idx] / self.cell).astype(np.int64) - gy0
        inb = (cxi >= 0) & (cxi < gw) & (cyi >= 0) & (cyi < gh)
        idx, cxi, cyi = idx[inb], cxi[inb], cyi[inb]
        d0 = self.depth[cyi, cxi]
        fin = np.isfinite(d0)
        idx, d0 = idx[fin], d0[fin]
        back = np.maximum(self.back_per_depth * d0, 1e-6)
        d = dz[idx]
        keep = (d >= d0 - back * self.front_scale) & (d <= d0 + back)
        out[idx[keep]] = True
        return out


def fill_polygon(points, width: int, height: int) -> np.ndarray:
    """Scanline fill at pixel centres; the app's ``fillPolygon``, exactly."""
    mask = np.zeros((height, width), bool)
    pts = np.asarray(points, np.float64)
    n = len(pts)
    if n < 3:
        return mask
    y0 = max(0, int(np.floor(pts[:, 1].min())))
    y1 = min(height - 1, int(np.ceil(pts[:, 1].max())))
    ax, ay = pts[np.arange(n) - 1, 0], pts[np.arange(n) - 1, 1]
    bx, by = pts[:, 0], pts[:, 1]
    for y in range(y0, y1 + 1):
        sy = y + 0.5
        cross = ((ay <= sy) & (by > sy)) | ((by <= sy) & (ay > sy))
        if not cross.any():
            continue
        xs = np.sort(ax[cross] + (sy - ay[cross]) / (by[cross] - ay[cross])
                     * (bx[cross] - ax[cross]))
        for k in range(0, len(xs) - 1, 2):
            xa = max(0, int(np.ceil(xs[k] - 0.5)))
            xb = min(width - 1, int(np.floor(xs[k + 1] - 0.5)))
            if xb >= xa:
                mask[y, xa:xb + 1] = True
    return mask


def _squash(y: np.ndarray, v: np.ndarray, k: float) -> np.ndarray:
    """T(y) = y + v (y.v)(k - 1): scale the component along v by k."""
    return y + np.outer(y @ v, v) * (k - 1.0) if y.ndim == 2 else y + v * (y @ v) * (k - 1.0)


def capsule_inside(c: Capsule, P: np.ndarray) -> np.ndarray:
    P = np.asarray(P, np.float64)
    k = c.r / max(c.depth, 1e-12)
    w = _squash(P - c.a, c.view, k)
    u = _squash(c.b - c.a, c.view, k)
    uu = float(u @ u)
    t = np.clip((w @ u) / uu, 0.0, 1.0) if uu > 1e-12 else np.zeros(len(P))
    d = w - np.outer(t, u)
    return np.einsum("ij,ij->i", d, d) <= c.r * c.r


def _quad_interval(A, B, C):
    """z with A z^2 + 2 B z + C <= 0, A >= 0: (lo, hi), empty as lo > hi."""
    disc = B * B - A * C
    with np.errstate(invalid="ignore", divide="ignore"):
        s = np.sqrt(np.maximum(disc, 0.0))
        lo = np.where(A > 1e-18, (-B - s) / A, -np.inf)
        hi = np.where(A > 1e-18, (-B + s) / A, np.inf)
    flat = A <= 1e-18          # constant along the ray: all or nothing
    lo = np.where(flat, np.where(C <= 0, -np.inf, np.inf), lo)
    hi = np.where(flat, np.where(C <= 0, np.inf, -np.inf), hi)
    empty = (~flat) & (disc < 0)
    lo = np.where(empty, np.inf, lo)
    hi = np.where(empty, -np.inf, hi)
    return lo, hi


def capsule_ray_interval(c: Capsule, eye: np.ndarray, D: np.ndarray):
    """Ray parameters z (X = eye + z D) inside the capsule, exact."""
    k = c.r / max(c.depth, 1e-12)
    q0 = _squash(eye - c.a, c.view, k)                # (3,)
    q1 = _squash(D, c.view, k)                        # (n, 3)
    u = _squash(c.b - c.a, c.view, k)
    r2 = c.r * c.r
    A = np.einsum("ij,ij->i", q1, q1)
    los, his = [], []
    for q in (q0, q0 - u):
        B = q1 @ q
        C = float(q @ q) - r2
        lo, hi = _quad_interval(A, B, np.full_like(A, C))
        los.append(lo)
        his.append(hi)
    L = float(np.linalg.norm(u))
    if L > 1e-12:
        uh = u / L
        p0 = q0 - uh * float(q0 @ uh)
        s1 = q1 @ uh
        p1 = q1 - np.outer(s1, uh)
        A2 = np.einsum("ij,ij->i", p1, p1)
        B2 = p1 @ p0
        C2 = np.full_like(A2, float(p0 @ p0) - r2)
        lo, hi = _quad_interval(A2, B2, C2)
        s0 = float(q0 @ uh)
        with np.errstate(divide="ignore", invalid="ignore"):
            za = (0.0 - s0) / s1
            zb = (L - s0) / s1
        par = np.abs(s1) < 1e-15
        alo = np.where(par, np.where((s0 >= 0) & (s0 <= L), -np.inf, np.inf), np.minimum(za, zb))
        ahi = np.where(par, np.where((s0 >= 0) & (s0 <= L), np.inf, -np.inf), np.maximum(za, zb))
        los.append(np.maximum(lo, alo))
        his.append(np.minimum(hi, ahi))
    lo = np.full(len(D), np.inf)
    hi = np.full(len(D), -np.inf)
    for a, b in zip(los, his):
        ok = a < b
        lo = np.where(ok, np.minimum(lo, a), lo)
        hi = np.where(ok, np.maximum(hi, b), hi)
    return lo, hi


# ------------------------------------------------------------------- volume

def _vec(x, default=None):
    if x is None:
        return default
    v = np.asarray(x, np.float64).reshape(3)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else default


class Volume:
    def __init__(self, capsules: Sequence[Capsule] = (), regions: Sequence[Region] = (),
                 view=None, exact: bool = True):
        self.capsules = list(capsules)
        self.regions = list(regions)
        self.view = _vec(view, np.array([0.0, 0.0, 1.0]))
        self.exact = bool(exact)

    # ------------------------------------------------------------- parsing
    @classmethod
    def from_wire(cls, d) -> Optional["Volume"]:
        if not d:
            return None
        view = _vec(d.get("view"), np.array([0.0, 0.0, 1.0]))
        caps: list[Capsule] = []
        for key, add in (("capsules", True), ("subtract", False)):
            for row in d.get(key) or []:
                row = [float(x) for x in row]
                if len(row) < 8:
                    raise ValueError(f"volume.{key}: a row needs 8 numbers, got {len(row)}")
                seq = int(row[8]) if len(row) > 8 else 0
                v = _vec(row[9:12], view) if len(row) >= 12 else view
                caps.append(Capsule(np.array(row[0:3]), np.array(row[3:6]),
                                    max(row[6], 1e-12), max(row[7], 1e-12), seq, v, add))
        regs: list[Region] = []
        for g in d.get("regions") or []:
            vp = np.asarray(g["vp"], np.float64).reshape(16)
            M = vp.reshape(4, 4).T                      # column-major -> rows
            gx0, gy0, gw, gh = (int(x) for x in g.get("grid", [0, 0, 0, 0]))
            dep = np.array([np.inf if x is None else float(x) for x in (g.get("depth") or [])],
                           np.float64)
            dep = dep.reshape(gh, gw) if gw * gh == len(dep) and len(dep) else np.full((max(gh, 0), max(gw, 0)), np.inf)
            dep[~np.isfinite(dep)] = np.inf
            W, H = (float(x) for x in g["size"])
            regs.append(Region(
                add=g.get("mode", "add") != "subtract", seq=int(g.get("seq", 0)),
                view=_vec(g.get("view"), view), M=M, W=W, H=H,
                polygon=np.asarray(g["polygon"], np.float64).reshape(-1, 2),
                through=bool(g.get("through", False)), cell=int(g.get("cell", CELL)),
                grid=(gx0, gy0, gw, gh), depth=dep,
                back_per_depth=float(g.get("back_per_depth", 0.0)),
                front_scale=float(g.get("front_scale", 1.2)),
                near=float(g.get("near", 0.0)), far=float(g.get("far", 0.0))))
        return cls(caps, regs, view, bool(d.get("exact", True)))

    def to_wire(self) -> dict:
        def row(c: Capsule):
            return [*map(float, c.a), *map(float, c.b), float(c.r), float(c.depth),
                    int(c.seq), *map(float, c.view)]
        return {
            "version": 1,
            "view": [float(x) for x in self.view],
            "capsules": [row(c) for c in self.capsules if c.add],
            "subtract": [row(c) for c in self.capsules if not c.add],
            "regions": [{
                "mode": "add" if g.add else "subtract", "seq": g.seq,
                "view": [float(x) for x in g.view],
                "vp": [float(x) for x in g.M.T.reshape(16)],
                "size": [g.W, g.H], "polygon": g.polygon.tolist(),
                "through": g.through, "cell": g.cell, "grid": list(g.grid),
                "depth": [None if not np.isfinite(x) else float(x) for x in g.depth.ravel()],
                "back_per_depth": g.back_per_depth, "front_scale": g.front_scale,
                "near": g.near, "far": g.far} for g in self.regions],
            "exact": self.exact,
        }

    @property
    def empty(self) -> bool:
        return not any(c.add for c in self.capsules) and not any(g.add for g in self.regions)

    def _ordered(self):
        """Primitives oldest first; on equal seq adds before subtracts."""
        prims = [(c.seq, 0 if c.add else 1, i, c) for i, c in enumerate(self.capsules)]
        prims += [(g.seq, 0 if g.add else 1, len(self.capsules) + i, g)
                  for i, g in enumerate(self.regions)]
        prims.sort(key=lambda t: (t[0], t[1], t[2]))
        return [p[3] for p in prims]

    # ---------------------------------------------------------- membership
    def inside(self, points) -> np.ndarray:
        """Which points lie inside the volume (newest primitive wins)."""
        P = np.asarray(points, np.float64).reshape(-1, 3)
        state = np.zeros(len(P), bool)
        if not len(P) or self.empty:
            return state
        tree = None
        for prim in self._ordered():
            if isinstance(prim, Capsule):
                if tree is None:
                    from scipy.spatial import cKDTree
                    tree = cKDTree(P)
                mid = 0.5 * (prim.a + prim.b)
                rad = 0.5 * float(np.linalg.norm(prim.b - prim.a)) + max(prim.r, prim.depth)
                idx = np.asarray(tree.query_ball_point(mid, rad * 1.0000001), np.int64)
                if not len(idx):
                    continue
                hit = idx[capsule_inside(prim, P[idx])]
            else:
                hit = np.where(prim.inside(P))[0]
            state[hit] = prim.add
        return state

    def bounds(self):
        pts = []
        for c in self.capsules:
            if c.add:
                lo, hi = c.aabb()
                pts += [lo, hi]
        for g in self.regions:
            if g.add:
                pts.append(g.corners())
        if not pts:
            return None
        P = np.vstack([np.atleast_2d(p) for p in pts])
        return P.min(0), P.max(0)

    # ---------------------------------------------------------- projection
    def mask_in_view(self, cam, W: int, H: int, grow: int = 0,
                     region_steps: int = 192) -> np.ndarray:
        """Pixels of ``cam`` whose ray passes through the volume.

        Per pixel, every primitive the ray meets gives an interval of the ray
        (closed form for capsules, sampled for regions); the intervals are
        combined in order, newest wins, exactly like ``inside``. Nothing here
        looks at splats, so a hole with none in it is covered all the same.
        """
        W, H = int(W), int(H)
        mask = np.zeros((H, W), bool)
        if self.empty:
            return mask
        R = np.asarray(cam.view, np.float64)[:3, :3]
        t = np.asarray(cam.view, np.float64)[:3, 3]
        K = np.asarray(cam.K, np.float64)
        eye = -R.T @ t
        tuples = []        # (pixel ids, z0, z1, seq, add)

        def project_box(lo, hi):
            c = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1])
                          for z in (lo[2], hi[2])])
            X = c @ R.T + t
            if (X[:, 2] <= 1e-6).any():
                return 0, W, 0, H
            x = K[0, 0] * X[:, 0] / X[:, 2] + K[0, 2]
            y = K[1, 1] * X[:, 1] / X[:, 2] + K[1, 2]
            x0 = int(np.clip(np.floor(x.min()) - 1, 0, W))
            x1 = int(np.clip(np.ceil(x.max()) + 1, 0, W))
            y0 = int(np.clip(np.floor(y.min()) - 1, 0, H))
            y1 = int(np.clip(np.ceil(y.max()) + 1, 0, H))
            return x0, x1, y0, y1

        def rays(x0, x1, y0, y1):
            yy, xx = np.mgrid[y0:y1, x0:x1]
            xx = xx.ravel()
            yy = yy.ravel()
            dc = np.stack([(xx + 0.5 - K[0, 2]) / K[0, 0],
                           (yy + 0.5 - K[1, 2]) / K[1, 1], np.ones(len(xx))], 1)
            return yy * W + xx, dc @ R          # camera -> world (R orthonormal)

        for prim in self._ordered():
            if isinstance(prim, Capsule):
                lo, hi = prim.aabb()
                box = project_box(lo, hi)
                if box[0] >= box[1] or box[2] >= box[3]:
                    continue
                pid, D = rays(*box)
                z0, z1 = capsule_ray_interval(prim, eye, D)
                z0 = np.maximum(z0, 1e-6)
                ok = z0 < z1
                if ok.any():
                    tuples.append((pid[ok], z0[ok], z1[ok], prim.seq, prim.add))
            else:
                C = prim.corners()
                box = project_box(C.min(0), C.max(0))
                if box[0] >= box[1] or box[2] >= box[3]:
                    continue
                pid, D = rays(*box)
                self._region_tuples(prim, eye, D, pid, C.min(0), C.max(0),
                                    region_steps, tuples)
        if not tuples:
            return mask
        pid = np.concatenate([tp[0] for tp in tuples])
        z0 = np.concatenate([tp[1] for tp in tuples])
        z1 = np.concatenate([tp[2] for tp in tuples])
        seq = np.concatenate([np.full(len(tp[0]), tp[3], np.int64) for tp in tuples])
        add = np.concatenate([np.full(len(tp[0]), tp[4], bool) for tp in tuples])
        on = np.zeros(H * W, bool)
        has_sub = np.zeros(H * W, bool)
        has_sub[pid[~add]] = True
        # Pixels no subtract touches: on as soon as any add reaches them.
        simple = ~has_sub[pid]
        on[pid[simple & add]] = True
        hard = ~simple
        if hard.any():
            on |= _csg_pixels(pid[hard], z0[hard], z1[hard], seq[hard], add[hard], H * W)
        mask = on.reshape(H, W)
        if grow > 0:
            from scipy import ndimage
            mask = ndimage.binary_dilation(mask, np.ones((3, 3)), iterations=int(grow))
        return mask

    @staticmethod
    def _region_tuples(g: Region, eye, D, pid, lo, hi, steps, tuples):
        # ray against the region's frustum box, then sample along it
        with np.errstate(divide="ignore", invalid="ignore"):
            inv = 1.0 / D
            ta = (lo[None, :] - eye[None, :]) * inv
            tb = (hi[None, :] - eye[None, :]) * inv
        tmin = np.nanmax(np.minimum(ta, tb), 1)
        tmax = np.nanmin(np.maximum(ta, tb), 1)
        tmin = np.maximum(tmin, 1e-6)
        ok = tmin < tmax
        if not ok.any():
            return
        pid, D, tmin, tmax = pid[ok], D[ok], tmin[ok], tmax[ok]
        n = int(steps)
        chunk = max(1, 2_000_000 // n)
        for s in range(0, len(pid), chunk):
            p = pid[s:s + chunk]
            d = D[s:s + chunk]
            a = tmin[s:s + chunk]
            b = tmax[s:s + chunk]
            frac = (np.arange(n) + 0.5) / n
            z = a[:, None] + (b - a)[:, None] * frac[None, :]
            X = eye[None, None, :] + z[..., None] * d[:, None, :]
            ins = g.inside(X.reshape(-1, 3)).reshape(len(p), n)
            if not ins.any():
                continue
            step = (b - a) / n
            # runs of inside samples -> intervals
            pad = np.zeros((len(p), 1), bool)
            e = np.diff(np.concatenate([pad, ins, pad], 1).astype(np.int8), axis=1)
            rs, cs = np.where(e == 1)
            re, ce = np.where(e == -1)
            # starts and ends pair up row by row in order
            z0 = z[rs, cs] - 0.5 * step[rs]
            z1 = z[re, ce - 1] + 0.5 * step[re]
            tuples.append((p[rs], z0, z1, g.seq, g.add))

    # ------------------------------------------------------------- surface
    def surface_points(self, spacing: Optional[float] = None) -> np.ndarray:
        """Points on the painted surface, holes included, inside the volume."""
        pts = []
        for c in self.capsules:
            if not c.add:
                continue
            h = spacing or c.r / 4
            v = c.view
            e1 = np.cross(v, [1.0, 0.0, 0.0])
            if np.linalg.norm(e1) < 1e-6:
                e1 = np.cross(v, [0.0, 1.0, 0.0])
            e1 /= np.linalg.norm(e1)
            e2 = np.cross(v, e1)
            seg = c.b - c.a
            L = float(np.linalg.norm(seg - v * (seg @ v)))
            n = max(1, int(np.ceil(L / h)))
            g = np.arange(-c.r, c.r + 1e-9, h)
            gx, gy = np.meshgrid(g, g)
            disc = (gx * gx + gy * gy) <= c.r * c.r
            off = gx[disc][:, None] * e1 + gy[disc][:, None] * e2
            for k in range(n + 1):
                pts.append(c.a + seg * (k / n) + off)
        for g in self.regions:
            if not g.add or g.through:
                continue
            gx0, gy0, gw, gh = g.grid
            cy, cx = np.where(np.isfinite(g.depth))
            if not len(cy):
                continue
            px = (gx0 + cx + 0.5) * g.cell
            py = (gy0 + cy + 0.5) * g.cell
            w, hh = g.mask_wh
            ix = np.clip(px.astype(np.int64), 0, w - 1)
            iy = np.clip(py.astype(np.int64), 0, hh - 1)
            keep = g.mask()[iy, ix]
            if keep.any():
                pts.append(g.unproject(px[keep], py[keep], g.depth[cy[keep], cx[keep]]))
        if not pts:
            return np.zeros((0, 3))
        P = np.vstack(pts)
        return P[self.inside(P)]


def _csg_pixels(pid, z0, z1, seq, add, npix):
    """Per pixel: is there a ray point whose newest containing interval adds?

    Membership only changes at interval ends, so it is enough to test a
    point just past every start and every end of every interval of that
    pixel. Intervals are grouped by pixel; each candidate is checked against
    its group by walking offsets, which keeps everything vectorised.
    """
    order = np.lexsort((z0, pid))
    pid, z0, z1, seq, add = pid[order], z0[order], z1[order], seq[order], add[order]
    T = len(pid)
    starts = np.r_[0, np.where(np.diff(pid) != 0)[0] + 1]
    sizes = np.diff(np.r_[starts, T])
    G = int(sizes.max())
    on = np.zeros(npix, bool)
    span = np.maximum(np.abs(z1), np.abs(z0))
    eps = np.maximum(1e-9, span * 1e-7)
    for cand in (z0 + eps, z1 + eps):
        best_seq = np.full(T, -1, np.int64)
        best_add = np.zeros(T, bool)
        idx = np.arange(T)
        group_start = np.repeat(starts, sizes)
        group_end = group_start + np.repeat(sizes, sizes)
        for o in range(G):
            j = group_start + o
            valid = j < group_end
            jj = np.where(valid, j, 0)
            inside = valid & (z0[jj] <= cand) & (cand <= z1[jj])
            s = seq[jj]
            a = add[jj]
            newer = inside & ((s > best_seq) | ((s == best_seq) & ~a))
            best_seq = np.where(newer, s, best_seq)
            best_add = np.where(newer, a, best_add)
        on[pid[idx[best_add]]] = True
    return on


def from_wire(d) -> Optional[Volume]:
    return Volume.from_wire(d)


def inside(volume, points) -> np.ndarray:
    v = volume if isinstance(volume, Volume) else Volume.from_wire(volume)
    if v is None:
        return np.zeros(len(np.asarray(points).reshape(-1, 3)), bool)
    return v.inside(points)


def mask_in_view(volume, cam, W: int, H: int, grow: int = 0) -> np.ndarray:
    v = volume if isinstance(volume, Volume) else Volume.from_wire(volume)
    if v is None:
        return np.zeros((int(H), int(W)), bool)
    return v.mask_in_view(cam, W, H, grow)


def surface_points(volume, spacing: Optional[float] = None) -> np.ndarray:
    v = volume if isinstance(volume, Volume) else Volume.from_wire(volume)
    return np.zeros((0, 3)) if v is None else v.surface_points(spacing)
