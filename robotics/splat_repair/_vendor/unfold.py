"""Fill across a fold or an edge by unfolding it ("Abwicklung").

A stroke over a corner of a hut, or over the rounded border of a sole, covers
a surface that is the same all along the edge: two plank faces and a corner
board, or a pebbled band rolling over from the bottom to the side. Filling
such a hole face by face loses exactly that: the strip beside the corner has
no donor of its own and is seeded into a pale blob, and a fill in each face's
own chart breaks the band where the faces meet.

So the neighbourhood of the edge is unrolled into a flat strip: arc length
``s`` along the edge, times arc length ``a`` across it, round the fold, with
``h`` the height over that unrolled surface. In the strip the corner board is
a straight band along ``s``, the planks are straight lines across it, and the
sole's border is a band that repeats along ``s``. The hole is then filled one
cross-section at a time: every row of the strip that the hole touches copies
a whole row from further along the edge -- a shift along ``s`` and nothing
else -- so whatever runs along the edge runs on through the hole by
construction, without having to be detected.

Which row a row copies is decided like image quilting in one dimension
(`_choose_shifts`): rows next to the hole must agree with the rows next to
their source, consecutive rows should keep one shift, and where they change
it the two sources have to agree there. A wall that repeats sideways cannot
fool this, as it fooled the rim test of a rigid 3-D shift: shifts across the
edge are simply not on offer, and a shift into the balcony over the hut
brings rows that look nothing like the wall's.

The copy takes all of the layer under the stroke -- the face, the corner
board, the soft inner layer behind it -- and removes the same layer at the
target, so nothing pale shows through from behind.

Where the edge bends -- it turns by more than ten degrees between a row and
the place one shift for all rows would copy it from -- each half of the hole
copies from just past its own end instead, every copy turned with the
edge's frame and kept at its height over the surface (on the sole's outline
at the arch the edge's profile lay up to 0.8 units off the surface over the
hole). Past thirty degrees nothing is done.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from .io import SplatSet


def _unit(v):
    v = np.asarray(v, np.float64)
    return v / max(float(np.linalg.norm(v)), 1e-12)


# ----------------------------------------------------------------- the folds

def find_folds(s: SplatSet, sel_mask, params, band, min_angle=40.0, min_share=0.01, debug=None):
    """The folds the stroke crosses: pairs of touching faces under it.

    The stroke and its rim are cut in cubes a quarter and a seventh of the
    stroke's width, and their smoothed normals grouped in orientations (as
    `repair` does to split a stroke into faces, there with a quarter). Each
    orientation falls apart into connected pieces; two pieces of different
    orientation that touch, both holding a share of the stroke and rim of
    their own, meet at a fold. At a quarter the stroke over the sole found
    one of its two edges: on the other side it wraps over the rim by half a
    unit, less than a cube. A rounded edge then shows as several folds along
    one line (bottom to bevel, bevel to wall, bottom to wall); of folds that
    lie along one line the sharpest stays. Returns a list of dicts with the
    two pieces' points (indices) and normals, oriented outward.
    """
    xyz = s.xyz.astype(np.float64)
    _, _, width, spacing, cand_idx, rim_idx = band
    sel_idx = np.where(sel_mask)[0]
    folds = []
    for frac in (0.25, 0.15):
        L = float(np.clip(frac * width, 8 * spacing, 0.5 * width))
        folds += _folds_at(s, sel_mask, params, band, L, min_angle, min_share, debug)
    if debug is not None:
        debug['all'] = list(folds)
    # one fold per edge: the sharpest of those along one line
    centre = xyz[sel_idx].mean(0)
    lines = []
    near_d = max(0.25 * width, 20 * spacing)
    real = []
    for f in folds:
        t = _unit(np.cross(f["nA"], f["nB"]))
        M = np.stack([f["nA"], f["nB"], t])
        try:
            p = np.linalg.solve(M, np.array([f["nA"] @ f["cA"], f["nB"] @ f["cB"], t @ f["touch"]]))
        except np.linalg.LinAlgError:
            p = f["touch"]
        lines.append((p, t))
        # the line the two planes meet in must run where the pieces touch
        real.append(float(np.linalg.norm(p - f["touch"])) < 2.0 * near_d)
    order = [i for i in np.argsort([-f["angle"] for f in folds], kind="stable") if real[i]]
    kept = []
    for i in order:
        p, t = lines[i]
        same = False
        for j in kept:
            q, u = lines[j]
            if abs(float(t @ u)) <= np.cos(np.radians(35.0)):
                continue
            # along one line, or touching where the other one runs: at the
            # hut's corner the finer cubes paired the corner board with a wall
            for x, (r, v) in ((p, (q, u)), (folds[i]["touch"], (q, u)), (folds[j]["touch"], (p, t)),
                              (folds[i]["touch"], (folds[j]["touch"], u))):
                d = x - r
                if np.linalg.norm(d - (d @ v) * v) < near_d:
                    same = True
            if same:
                break
        if not same:
            kept.append(i)
    return [folds[i] for i in kept]


def _folds_at(s, sel_mask, params, band, L, min_angle, min_share, debug=None):
    """The folds `find_folds` finds with cubes of side ``L``, not yet merged."""
    from . import repair as rp
    xyz = s.xyz.astype(np.float64)
    alpha = s.alpha
    _, _, width, spacing, cand_idx, rim_idx = band
    sel_idx = np.where(sel_mask)[0]
    so = sel_idx[alpha[sel_idx] > 0.5]
    ro = rim_idx[alpha[rim_idx] > 0.5]
    if len(so) + len(ro) < 100:
        return []
    pts_idx = np.concatenate([so, ro])
    uk, inv, cnt, mean, nrm, flat = rp._cube_normals(xyz[pts_idx], L)
    sn, _ = rp._smoothed_normals(mean, nrm, cnt, flat, L, min_cnt=0)
    wt = cnt * (cnt >= 8)
    cos_m, cos_s = np.cos(np.radians(20.0)), np.cos(np.radians(35.0))
    G = np.abs(sn @ sn.T)
    free = wt > 0
    modes = []
    total = wt.sum()
    while free.any():
        sup = np.where(free, (G[:, free] >= cos_m) @ wt[free], -1)
        i = int(np.argmax(sup))
        if sup[i] < 0.05 * total:
            break
        near = free & (G[i] >= cos_m)
        M = (sn[near][:, :, None] * sn[near][:, None, :] * wt[near][:, None, None]).sum(0)
        modes.append(np.linalg.eigh(M)[1][:, 2])
        free &= np.abs(sn @ modes[-1]) < cos_s
    if len(modes) < 2:
        return []
    modes = np.array(modes)
    cube_mode = np.argmax(np.abs(sn @ modes.T), 1)
    sel_cube = inv[:len(so)]
    rim_cube = inv[len(so):]
    pieces = []
    for k in range(len(modes)):
        for mem in rp._cube_components(uk, list(np.where(cube_mode == k)[0])):
            inp = np.zeros(len(uk), bool)
            inp[mem] = True
            w = float(wt[mem].sum())
            n_sel = int(inp[sel_cube].sum())
            n_rim = int(inp[rim_cube].sum())
            # a face of its own goes on past the stroke: a box standing on
            # the sole has sides, but no rim lies on them
            if debug is not None:
                debug.setdefault("cand", []).append((k, round(w), n_sel, n_rim, np.round(mean[mem].mean(0), 2)))
            if w < 0.005 * total or n_sel < min_share * len(so) or n_rim < max(30, 0.01 * len(ro)):
                continue
            P = mean[mem]
            ww = wt[mem].astype(np.float64) + 1e-9
            c = (P * ww[:, None]).sum(0) / ww.sum()
            pieces.append(dict(k=k, n=_unit(modes[k]), mem=mem, cube=inp, c=c, w=w,
                               pts=pts_idx[inp[inv]]))
    folds = []
    view = getattr(params, "view", None)
    view = _unit(view) if view is not None and len(view) == 3 else None
    for i in range(len(pieces)):
        for j in range(i + 1, len(pieces)):
            A, B = pieces[i], pieces[j]
            if A["k"] == B["k"]:
                continue
            ang = np.degrees(np.arccos(min(abs(float(A["n"] @ B["n"])), 1.0)))
            if ang < min_angle:
                continue
            d, nn_ = cKDTree(mean[A["mem"]]).query(mean[B["mem"]])
            if int((d < 1.8 * L).sum()) < 3:
                continue
            touch = 0.5 * (mean[B["mem"]][d < 1.8 * L] + mean[A["mem"]][nn_[d < 1.8 * L]])
            # A faces the painting camera if it can be told; B follows from A
            if A["w"] < B["w"]:
                A, B = B, A
            # Outward: toward the painting camera where a face looks at it,
            # away from the material round the stroke where it is seen edge-on.
            # Convex where the normals turn the way one goes from face to
            # face: through the centroid of the sole's bottom, which bends at
            # the arch, the bevel on the far side lay above the bottom's plane
            # and the fold came out concave.
            def outward(n, c):
                if view is not None and abs(float(n @ view)) > 0.3:
                    return -n if n @ view > 0 else n
                return -n if (xyz[cand_idx].mean(0) - c) @ n > 0 else n
            cA, cB = A["c"], B["c"]
            nA, nB = outward(A["n"].copy(), cA), outward(B["n"].copy(), cB)
            convex = float((cB - cA) @ (nB - nA)) > 0
            folds.append(dict(nA=nA, nB=nB, cA=cA, cB=cB, ptsA=A["pts"], ptsB=B["pts"],
                              convex=convex, angle=float(ang), L=L, touch=touch.mean(0)))
    return folds


# ------------------------------------------------------------ the unrolling

class Strip:
    """The unrolled neighbourhood of one fold.

    ``gamma`` is the edge curve sampled at ``s_grid``, with a frame
    (``tt`` along it, ``bb`` the outward bisector, ``cc`` across) transported
    along it without twist. The cross-section's outer profile is held in
    polar form round a centre ``rho`` behind the edge, one per knot along the
    edge (`set_profiles`), with its arc length ``A``.
    """

    def __init__(self, s_grid, gamma, tt, bb, cc, sigma, rho):
        self.s_grid, self.gamma = s_grid, gamma
        self.tt, self.bb, self.cc = tt, bb, cc
        self.sigma, self.rho = sigma, rho
        self._tree = cKDTree(gamma)
        self._axis = None
        self.ds = float(s_grid[1] - s_grid[0])

    def frame_at(self, s):
        """Point and frame (rows c, b, t) on the edge at arc length ``s``."""
        f = np.clip((s - self.s_grid[0]) / self.ds, 0, len(self.s_grid) - 1.000001)
        k = np.floor(f).astype(np.int64)
        w = (f - k)[:, None]
        g = self.gamma[k] * (1 - w) + self.gamma[k + 1] * w
        t = self.tt[k] * (1 - w) + self.tt[k + 1] * w
        b = self.bb[k] * (1 - w) + self.bb[k + 1] * w
        t /= np.linalg.norm(t, axis=1, keepdims=True)
        b -= np.sum(b * t, 1, keepdims=True) * t
        b /= np.linalg.norm(b, axis=1, keepdims=True)
        c = np.cross(t, b)
        return g, np.stack([c, b, t], 1)

    def local(self, P):
        """``(s, x, y, off)``: arc length, cross-section coordinates, distance off the section."""
        if getattr(self, "_axis", None) is not None:
            # along the straight axis first, then twice along the curve's own
            # tangent: a tree query per call was most of the time
            p0, t0, sg0, dsg, arc_of = self._axis
            f = np.clip(((P - p0) @ t0 - sg0) / dsg, 0, len(arc_of) - 1)
            s = np.interp(f, np.arange(len(arc_of)), arc_of)
            for _ in range(2):
                k = np.clip(np.rint((s - self.s_grid[0]) / self.ds), 0, len(self.s_grid) - 1).astype(np.int64)
                s = self.s_grid[k] + np.sum((P - self.gamma[k]) * self.tt[k], 1)
        else:
            k = self._tree.query(P)[1]
            s = self.s_grid[k] + np.sum((P - self.gamma[k]) * self.tt[k], 1)
        g, F = self.frame_at(s)
        d = P - g
        x = np.einsum("nk,nk->n", d, F[:, 0])
        y = np.einsum("nk,nk->n", d, F[:, 1])
        off = np.einsum("nk,nk->n", d, F[:, 2])
        return s, x, y, off

    def polar(self, x, y):
        X, Y = x, self.sigma * y + self.rho
        return np.arctan2(X, Y), np.hypot(X, Y)

    def set_profiles(self, knots, theta_grid, R0):
        """The outer profile ``R0[k]`` (radius per angle) at arc lengths ``knots``.

        Between knots, and over the hole, the profile is interpolated, so
        that a cross-section that changes along the edge -- the sole's side
        wall leans out further past the arch -- is followed, not averaged.
        """
        self.knots = np.asarray(knots, np.float64)
        self.theta_grid = np.asarray(theta_grid, np.float64)
        self.R0 = np.asarray(R0, np.float64)
        dth = self.theta_grid[1] - self.theta_grid[0]
        dr = np.gradient(self.R0, dth, axis=1)
        da = np.sqrt(self.R0 ** 2 + dr ** 2) * dth
        A = np.concatenate([np.zeros((len(R0), 1)), np.cumsum(da[:, :-1], 1)], 1)
        j0 = np.interp(0.0, self.theta_grid, np.arange(len(self.theta_grid)))
        A -= np.array([np.interp(j0, np.arange(A.shape[1]), A_k) for A_k in A])[:, None]
        self.A = A

    def _bilinear(self, T, s, th):
        K, nb = T.shape
        if K == 1:
            fk = np.zeros(len(s))
        else:
            fk = np.interp(s, self.knots, np.arange(K))
        k = np.clip(np.floor(fk).astype(np.int64), 0, max(K - 2, 0))
        w = np.clip(fk - k, 0.0, 1.0) if K > 1 else np.zeros(len(s))
        fj = np.clip((th - self.theta_grid[0]) / (self.theta_grid[1] - self.theta_grid[0]), 0, nb - 1.000001)
        j = np.floor(fj).astype(np.int64)
        u = fj - j
        k1 = np.minimum(k + 1, K - 1)
        return ((1 - w) * ((1 - u) * T[k, j] + u * T[k, j + 1]) +
                w * ((1 - u) * T[k1, j] + u * T[k1, j + 1]))

    def unroll(self, P):
        """``(s, a, h)`` of points: along the edge, across it, above the surface."""
        s, x, y, _ = self.local(P)
        th, r = self.polar(x, y)
        return s, self._bilinear(self.A, s, th), r - self._bilinear(self.R0, s, th)

    def theta_of(self, s, a):
        """The angle at which arc length ``a`` lies in the cross-section at ``s``."""
        lo = np.full(len(s), self.theta_grid[0])
        hi = np.full(len(s), self.theta_grid[-1])
        for _ in range(30):
            mid = 0.5 * (lo + hi)
            big = self._bilinear(self.A, s, mid) > a
            hi = np.where(big, mid, hi)
            lo = np.where(big, lo, mid)
        return 0.5 * (lo + hi)

    def place(self, s, a, h):
        """Points at ``(s, a, h)``: the inverse of `unroll`."""
        th = self.theta_of(s, a)
        r = self._bilinear(self.R0, s, th) + h
        x = r * np.sin(th)
        y = self.sigma * (r * np.cos(th) - self.rho)
        g, F = self.frame_at(s)
        return g + x[:, None] * F[:, 0] + y[:, None] * F[:, 1]



def _robust_poly(s, v, w, deg, iters=4, k=3.0):
    """Weighted polynomial fit of ``v(s)`` with outliers dropped."""
    keep = np.ones(len(s), bool)
    coef = None
    for _ in range(iters):
        if keep.sum() < deg + 2:
            break
        coef = np.polyfit(s[keep], v[keep], deg, w=np.sqrt(w[keep]))
        r = v - np.polyval(coef, s)
        mad = 1.4826 * np.median(np.abs(r[keep])) + 1e-12
        keep = np.abs(r) < k * mad
    if coef is None:
        coef = np.polyfit(s, v, min(deg, max(len(s) - 1, 0)))
    return coef


def _track_edge(rs, rx, ry, hole_lo, hole_hi, tol, misses=2):
    """Rows whose edge point continues the edge next to the hole, on both sides.

    From the rows beside the hole outward, a row is taken if its edge point
    lies within ``tol`` of the line through the last rows taken; after
    ``misses`` rows in a row that do not, the edge has ended there (a
    balcony over the hut's corner, a deck in front of it).
    """
    take = np.zeros(len(rs), bool)
    for side in (+1, -1):
        order = np.where(rs > hole_hi)[0] if side > 0 else np.where(rs < hole_lo)[0][::-1]
        got, miss = [], 0
        for k in order:
            if len(got) == 0:
                got.append(k)
                continue
            last = got[-3:]
            if len(last) >= 2:
                cx = np.polyfit(rs[last], rx[last], 1)
                cy = np.polyfit(rs[last], ry[last], 1)
                px, py = np.polyval(cx, rs[k]), np.polyval(cy, rs[k])
            else:
                px, py = rx[last[-1]], ry[last[-1]]
            if np.hypot(rx[k] - px, ry[k] - py) <= tol:
                got.append(k)
                miss = 0
            else:
                miss += 1
                if miss > misses:
                    break
        take[got] = True
    # the first row beside the hole is taken on trust; drop it if the next
    # ones disagree with it
    return take


def _outer_profile(th, r, w, sigma, spacing, nb=720, share=0.25):
    """The outer surface of a cross-section, in polar form: ``r0`` per angle bin.

    Per bin, the densest layers along the ray (opacity-weighted, a spacing
    and a half wide); of those holding at least ``share`` of the densest, the
    outermost. A percentile does not do: behind the hut's corner board a
    soft fan of pale splats outweighs the thin wall in front of it.
    """
    if len(th) == 0:
        return np.full(nb, np.nan)
    kb = np.clip(((th + np.pi) / (2 * np.pi) * nb).astype(np.int64), 0, nb - 1)
    r_lo = float(r.min())
    nr = int(min(max((float(r.max()) - r_lo) / spacing, 1), 4000)) + 3
    kr = np.clip(((r - r_lo) / spacing).astype(np.int64) + 1, 0, nr - 1)
    hist = np.bincount(kb * nr + kr, w, nb * nr).reshape(nb, nr)
    cnt = np.bincount(kb, None, nb)
    dens = ndimage.gaussian_filter1d(hist, 1.5, axis=1)
    peak = (dens >= np.roll(dens, 1, 1)) & (dens >= np.roll(dens, -1, 1)) &         (dens >= share * dens.max(1, keepdims=True)) & (dens > 0)
    any_ = peak.any(1) & (cnt >= 5)
    idx = np.arange(nr)[None, :]
    j = np.where(peak, idx, -1).max(1) if sigma > 0 else np.where(peak, idx, nr).min(1)
    r0 = np.where(any_, r_lo + (j - 1 + 0.5) * spacing, np.nan)
    return r0


def build_strip(xyz, alpha, known, fold, hole_lo, hole_hi, s_lo, s_hi, reach, spacing, centre, rho=None):
    """Fit the edge curve and the cross-section of one fold: a `Strip`, or None.

    ``known`` marks points that may be measured (not painted); ``hole_lo``,
    ``hole_hi`` is where the stroke lies along the edge, ``s_lo``, ``s_hi``
    how far along it to look. The edge is found row by row as the outermost
    material along the bisector and followed outward from the hole while it
    continues smoothly (`_track_edge`); a cubic through those rows carries it
    over the hole, so that a curved edge -- the sole's outline at the arch --
    is followed instead of cut by a straight line. Returns the strip and the
    stretch of edge that was followed.
    """
    nA, nB = fold["nA"], fold["nB"]
    sigma = 1.0 if fold["convex"] else -1.0
    t0 = _unit(np.cross(nA, nB))
    b0 = _unit(nA + nB)
    c0 = np.cross(t0, b0)
    # a point on the line where the two planes meet, level with the stroke
    M = np.stack([nA, nB, t0])
    rhs = np.array([nA @ fold["cA"], nB @ fold["cB"], t0 @ centre])
    p0 = np.linalg.solve(M, rhs)
    if (fold["cA"] - p0) @ c0 < 0:          # face A on the positive side
        c0, t0 = -c0, -t0
        hole_lo, hole_hi, s_lo, s_hi = -hole_hi, -hole_lo, -s_hi, -s_lo
    D = xyz - p0
    s0 = D @ t0
    x0 = D @ c0
    y0 = D @ b0
    tube = known & (alpha > 0.05) & (s0 > s_lo) & (s0 < s_hi) &         (np.abs(x0) < 1.5 * reach) & (np.abs(y0) < 1.5 * reach)
    ti = np.where(tube)[0]
    # the edge, row by row: the outermost material along the bisector
    row = max(4.0 * spacing, (hole_hi - hole_lo) / 12.0)
    k = np.floor((s0[ti] - s_lo) / row).astype(np.int64)
    ys = sigma * y0[ti]
    rho = float(rho or reach)
    near = (np.abs(x0[ti]) < 0.5 * rho) & (alpha[ti] > 0.2)
    rs, rx, ry, rw = [], [], [], []
    for kk in np.unique(k[near]):
        m = near & (k == kk)
        sc = s_lo + (kk + 0.5) * row
        if m.sum() < 8 or (hole_lo - 0.5 * row < sc < hole_hi + 0.5 * row):
            continue
        top = np.percentile(ys[m], 97)
        mm = m & (ys >= top - 3.0 * spacing)
        rs.append(sc)
        rx.append(float(np.median(x0[ti][mm])))
        ry.append(float(np.median(y0[ti][mm])))
        rw.append(float(m.sum()))
    if len(rs) < 3:
        return None
    rs, rx, ry, rw = map(np.asarray, (rs, rx, ry, rw))
    tol = max(6.0 * spacing, 0.04 * rho, 0.5 * row)
    take = _track_edge(rs, rx, ry, hole_lo, hole_hi, tol)
    if take.sum() < 3:
        return None
    rs, rx, ry, rw = rs[take], rx[take], ry[take], rw[take]
    # The lowest degree that follows the rows: a cubic through the hut's
    # straight corner bent it by three degrees between a row and its source.
    fits = []
    for deg in range(1, int(min(3, max(1, len(rs) // 4))) + 1):
        cx = _robust_poly(rs, rx, rw, deg)
        cy = _robust_poly(rs, ry, rw, deg)
        res_ = np.hypot(rx - np.polyval(cx, rs), ry - np.polyval(cy, rs))
        fits.append((float(np.median(res_)), cx, cy))
    best = min(f_[0] for f_ in fits)
    for mad_, cx, cy in fits:
        if mad_ <= max(1.5 * best, 1.5 * spacing):
            break
    e_lo = min(rs.min(), hole_lo) - 0.5 * row
    e_hi = max(rs.max(), hole_hi) + 0.5 * row
    lo, hi = e_lo - reach, e_hi + reach
    n = int(np.clip((hi - lo) / spacing, 200, 4000))
    sg = np.linspace(lo, hi, n)
    sc_ = np.clip(sg, e_lo, e_hi)                   # straight on past the ends
    gx = np.polyval(cx, sc_) + (sg - sc_) * np.polyval(np.polyder(cx), sc_)
    gy = np.polyval(cy, sc_) + (sg - sc_) * np.polyval(np.polyder(cy), sc_)
    gamma = p0 + sg[:, None] * t0 + gx[:, None] * c0 + gy[:, None] * b0
    # arc length along it, and a frame carried along without twist
    seg = np.linalg.norm(np.diff(gamma, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    j0 = int(np.argmin(np.abs(sg)))
    arc -= arc[j0]
    tt = np.gradient(gamma, axis=0)
    tt /= np.linalg.norm(tt, axis=1, keepdims=True)
    bb = np.zeros_like(tt)
    bb[j0] = _unit(b0 - (b0 @ tt[j0]) * tt[j0])
    for j in range(j0 + 1, n):
        b = bb[j - 1] - (bb[j - 1] @ tt[j]) * tt[j]
        bb[j] = b / np.linalg.norm(b)
    for j in range(j0 - 1, -1, -1):
        b = bb[j + 1] - (bb[j + 1] @ tt[j]) * tt[j]
        bb[j] = b / np.linalg.norm(b)
    cc = np.cross(tt, bb)
    s_grid = np.linspace(arc[0], arc[-1], n)
    res = [np.stack([np.interp(s_grid, arc, v[:, d]) for d in range(3)], 1)
           for v in (gamma, tt, bb, cc)]
    st = Strip(s_grid, *res, sigma, rho)
    st._axis = (p0, t0, float(sg[0]), float(sg[1] - sg[0]), arc)
    # where the edge was followed, in arc length
    st.edge_lo = float(np.interp(e_lo, sg, arc))
    st.edge_hi = float(np.interp(e_hi, sg, arc))
    st.hole_lo = float(np.interp(hole_lo, sg, arc))
    st.hole_hi = float(np.interp(hole_hi, sg, arc))
    # The cross-section's outer profile, per row the edge was followed in
    # (with its neighbours), interpolated along the edge and over the hole.
    # The sole's side wall leans half a unit further out past the arch than
    # beside the stroke: one profile for all rows put the wall beside the
    # stroke ten spacings under the surface.
    kk_taken = np.floor((rs - s_lo) / row).astype(np.int64)
    nb = 360
    profs, knots = [], []
    use = np.isin(k, np.concatenate([kk_taken - 1, kk_taken, kk_taken + 1]))
    _, x_all, y_all, _ = st.local(xyz[ti[use]])
    th_all, r_all = st.polar(x_all, y_all)
    k_use, w_use = k[use], alpha[ti[use]]
    for kk, sv in zip(kk_taken, rs):
        m = np.abs(k_use - kk) <= 1
        if m.sum() < 30:
            continue
        profs.append(_outer_profile(th_all[m], r_all[m], w_use[m], sigma, spacing, nb=nb, share=0.25))
        knots.append(float(np.interp(sv, sg, arc)))
    if len(profs) < 2:
        return None
    P_ = np.array(profs)
    dist = np.maximum(st.hole_lo - np.array(knots), np.array(knots) - st.hole_hi)
    near_k = np.argsort(dist, kind="stable")[:max(6, len(knots) // 2)]
    import warnings
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        cnt_ = np.isfinite(P_[near_k]).sum(0)
        g = np.nanmedian(P_[near_k], 0)
    g = np.where(cnt_ >= max(2, len(near_k) // 3), g, np.nan)
    ok = np.isfinite(g)
    if ok.sum() < 10:
        return None
    edges = np.linspace(-np.pi, np.pi, nb + 1)
    thc = 0.5 * (edges[1:] + edges[:-1])
    g = np.interp(thc, thc[ok], g[ok])
    # Each row's profile is the common one plus a drift that is smooth across
    # the section and along the edge. Taken raw, the lamp under the hut's
    # balcony made the last rows bulge, and copies placed on that bulge
    # kinked the corner board; the shape itself -- the corner board's
    # edges -- stays the common profile's.
    g = ndimage.median_filter(g, size=5, mode="nearest")
    g = ndimage.gaussian_filter1d(g, 1.5, mode="nearest")
    have = np.isfinite(P_)
    Dv = np.where(have, P_ - g[None], 0.0)
    if len(Dv) >= 5:
        Dv = ndimage.median_filter(Dv, size=(5, 1), mode="nearest")
    Dv = ndimage.gaussian_filter1d(Dv, 6.0, axis=1, mode="nearest")
    P_ = g[None] + Dv
    kn = np.array(knots)
    order = np.argsort(knots)
    st.set_profiles(kn[order], thc, P_[order])
    st.rows = (rs, rx, ry)
    return st


def strip_for_fold(xyz, alpha, sel_mask, fold, reach, spacing, look=2.0, rho=None,
                   max_turn_deg=None):
    """The strip of one fold, and where along the edge the stroke lies on it.

    Twice: the first strip only knows the straight line where the two faces'
    planes meet, so it takes the stroke's extent along the edge from what
    lies near that line; the second takes it from what lies on the first
    strip. ``look`` is how many hole lengths to either side the edge is
    followed for sources.
    """
    nA, nB = fold["nA"], fold["nB"]
    t0 = _unit(np.cross(nA, nB))
    b0 = _unit(nA + nB)
    c0 = np.cross(t0, b0)
    S = xyz[sel_mask]
    centre = S.mean(0)
    M = np.stack([nA, nB, t0])
    p0 = np.linalg.solve(M, np.array([nA @ fold["cA"], nB @ fold["cB"], t0 @ centre]))
    D = S - p0
    near = (np.abs(D @ c0) < reach) & (np.abs(D @ b0) < reach)
    if near.sum() < 30:
        return None
    st = None
    for k in range(2):
        s0 = D[near] @ t0
        lo, hi = np.percentile(s0, [1, 99])
        L = max(hi - lo, 4.0 * spacing)
        # the first strip only places the stroke along the edge: a narrow one
        r_k = min(reach, 2.0 * float(rho or reach)) if k == 0 else reach
        st = build_strip(xyz, alpha, ~sel_mask, fold, lo, hi, lo - look * L, hi + look * L,
                         r_k, spacing, centre, rho=rho)
        if st is None:
            return None
        if k == 0 and max_turn_deg is not None and _least_turn(st) > max_turn_deg:
            return None
        _, a, h = st.unroll(S)
        near = (a > -r_k) & (a < r_k) & (np.abs(h) < 0.5 * float(rho or reach))
        if near.sum() < 30:
            return None
    return st


def _least_turn(st):
    """How far the edge turns, in degrees, from the middle of the hole to the
    nearest place past either end -- where the middle copies from at the least."""
    mid = 0.5 * (st.hole_lo + st.hole_hi)
    sp_ = 0.02 * max(st.hole_hi - st.hole_lo, 1e-9)
    ends = np.array([st.hole_lo - sp_, st.hole_hi + sp_])
    _, Fm = st.frame_at(np.full(2, mid))
    _, Fe = st.frame_at(ends)
    tr_ = np.einsum("nki,nki->n", Fm, Fe)
    return float(np.degrees(np.arccos(np.clip((tr_ - 1) / 2, -1, 1))).min())


# ------------------------------------------------------------------ the grid

def _features(occ, col, hh, front, back, known, spacing):
    """Per cell: opacity-weighted colour and height, and what stands in front
    of the surface or lies behind it (a lamp on the hut's wall stands out a
    tenth of a unit; seen only at the surface, its rows looked like wall).
    Zero where unknown."""
    ref = max(float(np.median(occ[occ > 0])) if (occ > 0).any() else 1.0, 1e-9)
    on = np.clip(occ / ref, 0.0, 2.0)
    # colour and height count in full once a cell holds a third of the usual
    # opacity: weighted by opacity, faint rows looked alike and like anything
    gate = np.clip(on / 0.3, 0.0, 1.0)[..., None]
    f = np.concatenate([col * gate, np.clip(hh / (4.0 * spacing), -2, 2)[..., None] * gate,
                        0.5 * on[..., None], np.clip(front / ref, 0, 2)[..., None],
                        0.5 * np.clip(back / ref, 0, 2)[..., None]], -1)
    return np.where(known[..., None], f, 0.0)


def _row_distances(f, known):
    """``(sum, count)`` over columns of squared feature distance between every two rows."""
    n_s, n_a, C = f.shape
    V = known.astype(np.float64)
    F2 = (f ** 2).sum(-1) * V
    Ff = f.reshape(n_s, n_a * C)
    dot = Ff @ Ff.T
    S = F2 @ V.T + V @ F2.T - 2.0 * dot
    N = V @ V.T
    return np.maximum(S, 0.0), N


def _diag_window(M, lo, hi):
    """``out[x, y] = sum_{k=lo..hi} M[x+k, y+k]`` (out of range counts nothing)."""
    n = len(M)
    out = np.zeros_like(M)
    for k in range(lo, hi + 1):
        if k >= 0:
            out[:n - k, :n - k] += M[k:, k:]
        else:
            out[-k:, -k:] += M[:n + k, :n + k]
    return out


def _choose_shifts(f, known, hole, rows, win=3, switch=1.0, near=0.3, motif_weight=8.0,
                   reach=None):
    """One shift along the edge per row of the hole, by dynamic programming.

    A row ``i`` that takes shift ``d`` copies row ``i + d`` into its hole
    cells. Its cost: how well the known cells in the rows round it agree
    with the rows round its source (``win`` either side); a source row must
    be known where the row has its hole. Neighbouring rows pay for taking
    different shifts by how much their two sources disagree there, plus a
    little for changing at all -- image quilting in one dimension. Returns
    the shift per row of ``rows`` and the mean cost per cell.

    ``reach`` (rows): each row copies from no further than this past the
    nearer end of the hole -- the rows of the first half from before it, the
    second half's from after it, with a seam where they meet. Without it,
    one shift must suit every row.
    """
    n_s, n_a, _ = f.shape
    S, N = _row_distances(f, known)
    scale = float(np.median(S[N > 0] / N[N > 0])) if (N > 0).any() else 1.0
    scale = max(scale, 1e-9)
    Sn = S / scale
    Mn = np.where(N > 0, Sn / np.maximum(N, 1.0), 0.0)
    # the context cost: known cells only, so a row deep in the hole says little
    # Known cells round the row that its source cannot be compared on --
    # past the end of the edge, or in the hole -- count as a typical
    # mismatch: rows at the end of the followed edge are not free.
    kc = known.sum(1).astype(np.float64)
    want = np.zeros((n_s, n_s))
    for k in range(-win, win + 1):
        lo_, hi_ = max(0, -k), min(n_s, n_s - k)
        want[lo_:hi_, :] += kc[lo_ + k:hi_ + k][:, None]
    U_all = (_diag_window(Sn, -win, win) + np.maximum(want - _diag_window(N, -win, win), 0.0)) / max(n_a, 1)
    W2 = _diag_window(Mn, -win + 1, win)
    # A row that matches no other row along the edge is a motif -- the lamp
    # under the hut's balcony -- and is not copied: what repeats along an
    # edge is the edge, what does not is something on it.
    full = known.mean(1) > 0.95
    Nw = _diag_window(N, -win, win)
    Mw = np.where(Nw > 0.5 * (2 * win + 1) * n_a * 0.3, _diag_window(Sn, -win, win) / np.maximum(Nw, 1.0), np.inf)
    far = np.abs(np.arange(n_s)[:, None] - np.arange(n_s)[None, :]) > 2 * win
    lone = np.where(far & full[None, :], Mw, np.inf).min(1)
    lone = np.where(np.isfinite(lone), lone, 0.0)
    i0, i1 = int(rows[0]), int(rows[-1])
    ctx = full & (np.abs(np.arange(n_s) - 0.5 * (i0 + i1)) <= (i1 - i0) + 4 * win)
    ref = float(np.median(lone[ctx])) if ctx.any() else float(np.median(lone))
    motif = np.maximum(lone - 1.5 * ref, 0.0)
    # A cell unlike the rest of its column is a one-off -- the lamp under
    # the balcony takes five of a hundred columns and hardly moves a row's
    # distance, but it is all a hole cell in that column would get.
    # A row with little surface where the profile says it is has left the
    # face -- under the hut's balcony the last rows hold the soffit's
    # shadow -- and is no source; nor does it count in what a column holds.
    fill_r = (f[..., 4] * known).sum(1) / np.maximum(known.sum(1), 1)
    ref_fill = float(np.median(fill_r[full])) if full.any() else float(np.median(fill_r))
    eligible = fill_r >= 0.5 * ref_fill
    rare = np.zeros((n_s, n_a))
    for j in range(n_a):
        kj = known[:, j] & eligible
        if kj.sum() < 8:
            continue
        m = np.median(f[kj, j], 0)
        d = ((f[:, j] - m) ** 2).sum(-1)
        q = float(np.percentile(d[kj], 90)) + 1e-6
        rare[:, j] = np.clip((d - q) / q, 0.0, 3.0)
    rare[~known] = 0.0
    D = np.arange(-n_s + 1, n_s)
    D = D[D != 0]
    if reach is None:
        D = D[(i0 + D >= 0) & (i1 + D < n_s)]
        # the ends of the followed edge are where it stops being itself
        D = D[(i0 + D >= win) & (i1 + D < n_s - win)] if ((i0 + D >= win) & (i1 + D < n_s - win)).any() else D
        allow = None
    else:
        ii = np.arange(i0, i1 + 1)[:, None]
        src_ = ii + D[None, :]
        dl, dr = ii - i0 + 1, i1 - ii + 1
        allow = (((D[None, :] <= -dl) & (D[None, :] >= -dl - reach)) |
                 ((D[None, :] >= dr) & (D[None, :] <= dr + reach)))
        allow &= np.abs(D[None, :]) <= np.minimum(dl, dr) + reach
        allow &= (src_ >= win) & (src_ < n_s - win)
        keepD = allow.any(0)
        D, allow = D[keepD], allow[:, keepD]
        if not len(D) or not allow.any(1).all():
            return None, None
    if not len(D):
        return None, None
    nh = hole.sum(1).astype(np.float64)
    nr = i1 - i0 + 1
    cost = np.zeros((nr, len(D)))
    for r, i in enumerate(range(i0, i1 + 1)):
        src = np.clip(i + D, 0, n_s - 1)
        cov = (hole[i][None, :] & known[src]).sum(1) / max(nh[i], 1.0)
        odd = (rare[src] * hole[i][None, :]).sum(1)
        cov = np.where(eligible[src], cov, 0.0)
        cost[r] = (U_all[i, src] + 500.0 * (1.0 - cov) * max(nh[i], 1.0) / max(n_a, 1)
                   + motif_weight * (motif[src] * nh[i] + odd) / max(n_a, 1)
                   + near * np.abs(D) / max(i1 - i0 + 1, 1) * nh[i] / max(n_a, 1))
        if allow is not None:
            cost[r] = np.where(allow[r], cost[r], 1e12)
    acc = cost[0].copy()
    back = np.zeros((nr, len(D)), np.int64)
    off = 1.0 - np.eye(len(D))
    # A change of shift that steps the source back onto rows just copied
    # tiles the same few rows over and over: on the sole's pebbled border the
    # shift fell by two every two rows and one pair of rows was laid fifteen
    # times. Going on (step 1) is free, jumping ahead costs the seam,
    # stepping back costs a great deal.
    step = 1 + D[None, :] - D[:, None]
    off = off + 20.0 * (step <= 0)
    for r in range(1, nr):
        i = i0 + r - 1
        w_seam = 0.5 * (nh[i] + nh[i + 1]) / max(n_a, 1)
        sc_ = np.clip(i + D, 0, n_s - 1)
        P = W2[np.ix_(sc_, sc_)] * w_seam + switch * w_seam * off
        tot = acc[:, None] + P
        back[r] = np.argmin(tot, 0)
        acc = tot[back[r], np.arange(len(D))] + cost[r]
    best = np.empty(nr, np.int64)
    best[-1] = int(np.argmin(acc))
    for r in range(nr - 1, 0, -1):
        best[r - 1] = back[r, best[r]]
    return D[best], float(acc.min()) / max(float(hole[i0:i1 + 1].sum()), 1.0)


def _surface_height(I_, J_, H_, w, n_s, n_a, spacing, top=0.25, min_w=0.3):
    """Per cell, the height of the outer surface over the strip's profile, and
    whether a cell holds enough to say: of the cell's opacity, the layer at
    which the outermost quarter is reached, averaged over three spacings
    under it to one over. The lining behind a heel's leather is in the same
    cells and must not pull the surface in."""
    n = n_s * n_a
    hs = np.zeros(n)
    have = np.zeros(n, bool)
    lin = I_ * n_a + J_
    if len(lin) == 0:
        return hs.reshape(n_s, n_a), have.reshape(n_s, n_a)
    order = np.lexsort((-H_, lin))
    l_o, h_o, w_o = lin[order], H_[order], w[order]
    tot = np.bincount(l_o, w_o, n)
    cum = np.cumsum(w_o)
    first = np.searchsorted(l_o, np.arange(n))
    base = np.concatenate([[0.0], cum])[first]
    within = cum - base[l_o]
    reached = within >= top * tot[l_o]
    # the first point of each cell at which the outer quarter is reached
    q = np.full(n, np.nan)
    rr = np.where(reached)[0]
    if len(rr):
        cells, k = np.unique(l_o[rr], return_index=True)
        q[cells] = h_o[rr[k]]
    near = np.isfinite(q[l_o]) & (h_o > q[l_o] - 3 * spacing) & (h_o < q[l_o] + spacing)
    sw = np.bincount(l_o[near], w_o[near], n)
    sh = np.bincount(l_o[near], w_o[near] * h_o[near], n)
    have = sw >= min_w
    hs = np.where(have, sh / np.maximum(sw, 1e-9), 0.0)
    return hs.reshape(n_s, n_a), have.reshape(n_s, n_a)


def _line_worst(lum, I_, J_, n_s, n_a, min_n=10):
    """Per cell, how far its worst splat's brightness lies from the rest of its
    line, in the line's robust spread: ``(along the column, along the row)``.
    A column runs along the edge, a row across it."""
    out = []
    for key, other in ((J_, I_), (I_, J_)):
        z = np.zeros((n_s, n_a))
        n_k = n_a if key is J_ else n_s
        order = np.argsort(key, kind="stable")
        ks, ls, os_ = key[order], lum[order], other[order]
        starts = np.searchsorted(ks, np.arange(n_k + 1))
        for k in range(n_k):
            a_, b_ = starts[k], starts[k + 1]
            if b_ - a_ < min_n:
                continue
            v = ls[a_:b_]
            med = float(np.median(v))
            mad = 1.4826 * float(np.median(np.abs(v - med))) + 1e-3
            zz = np.abs(v - med) / mad
            if key is J_:
                np.maximum.at(z[:, k], os_[a_:b_], zz)
            else:
                np.maximum.at(z[k, :], os_[a_:b_], zz)
        out.append(z)
    return out


def _why(debug, where):
    """Note in ``debug`` at which check `fill_fold` gave up; returns None."""
    if debug is not None:
        debug["why"] = where
    return None


def fill_fold(s: SplatSet, sel_mask, params, band, fold, reach=None, vol=None, debug=None,
              max_turn_deg=10.0, bent_turn_deg=30.0):
    """Fill the part of a stroke that lies on one fold, row by row along the edge.

    Returns a dict: ``removed`` (indices into ``s``), ``added`` (a
    `SplatSet`), ``covers`` (which points lie in the filled cells -- a fill
    made before this one drops its splats there) and ``info``; or None when
    the fold could not be unrolled.
    """
    from . import shtools
    xyz = s.xyz.astype(np.float64)
    alpha = s.alpha
    rgb = s.rgb
    centre, radius, width, spacing, cand_idx, rim_idx = band
    if reach is None:
        reach = float(max(4.0 * width, 30 * spacing))
    rho = float(np.clip(width, 40 * spacing, 60 * spacing))
    # the middle of the hole copies from past its ends at the nearest: if the
    # edge turns too much even that far, no copy will do (`_least_turn`)
    st = strip_for_fold(xyz, alpha, sel_mask, fold, reach, spacing, rho=rho,
                        max_turn_deg=max_turn_deg)
    if st is None or _least_turn(st) > max_turn_deg:
        return _why(debug, "strip")
    cell = 2.0 * spacing
    # the painted layer, unrolled
    si = np.where(sel_mask)[0]
    s_s, a_s, h_s = st.unroll(xyz[si])
    on = (a_s > -reach) & (a_s < reach) & (np.abs(h_s) < 0.5 * rho)
    if on.sum() < 30:
        return _why(debug, "off the strip")
    # The stroke must cross the edge, not stop short of it: on the far side
    # of the sole it ended on the bevel, and the "fold" there unrolled the
    # bottom's lattice and copied it from nine units away.
    over = [float(np.percentile(-a_s[on], 99)), float(np.percentile(a_s[on], 99))]
    if min(over) < 4 * cell or min((a_s[on] < 0).mean(), (a_s[on] > 0).mean()) < 0.03:
        return _why(debug, "short of the edge")
    a_lo = max(-reach, float(np.percentile(a_s[on], 0.5)) - 6 * cell)
    a_hi = min(reach, float(np.percentile(a_s[on], 99.5)) + 6 * cell)
    s_lo, s_hi = st.edge_lo, st.edge_hi
    n_s = int(np.ceil((s_hi - s_lo) / cell))
    n_a = int(np.ceil((a_hi - a_lo) / cell))
    if n_s * n_a > 400_000 or n_s < 8 or n_a < 4:
        return _why(debug, "grid")
    h_in = float(np.clip(np.percentile(-h_s[on], 98), 16 * spacing, 0.5 * rho))
    h_out = float(np.clip(np.percentile(h_s[on], 99.5), 6 * spacing, 0.5 * rho))
    # everything near the strip, unrolled once
    lo_ = xyz[si[on]].min(0) - (s_hi - s_lo) - reach
    hi_ = xyz[si[on]].max(0) + (s_hi - s_lo) + reach
    box = np.where(np.all((xyz >= lo_) & (xyz <= hi_), 1) & (alpha > 0.005))[0]
    S_, A_, H_ = st.unroll(xyz[box])
    I_ = np.floor((S_ - s_lo) / cell).astype(np.int64)
    J_ = np.floor((A_ - a_lo) / cell).astype(np.int64)
    in_grid = (I_ >= 0) & (I_ < n_s) & (J_ >= 0) & (J_ < n_a)
    # what stands further out than the layer that is copied, per cell: the
    # body of a lamp on the wall stays where it is, so a row holding it
    # must not look like plain wall
    ah = in_grid & (H_ >= h_out) & (H_ < max(h_out, 0.5 * rho)) & ~sel_mask[box]
    ahead = np.bincount(I_[ah] * n_a + J_[ah], alpha[box[ah]], n_s * n_a).reshape(n_s, n_a)
    inside = in_grid & (H_ > -h_in) & (H_ < h_out)
    tube, I_, J_, H_, S_, A_ = box[inside], I_[inside], J_[inside], H_[inside], S_[inside], A_[inside]
    painted = sel_mask[tube]
    # the hole: painted cells, closed
    hole = np.zeros((n_s, n_a), bool)
    hole[I_[painted], J_[painted]] = True
    if vol is not None:
        grow = ndimage.binary_dilation(hole, np.ones((3, 3)), iterations=4)
        ci, cj = np.where(grow)
        if len(ci):
            sc = s_lo + (ci + 0.5) * cell
            ac = a_lo + (cj + 0.5) * cell
            hit = np.zeros(len(ci), bool)
            for hv in (-0.5 * h_in, 0.0, 0.5 * h_out):
                hit |= vol.inside(st.place(sc, ac, np.full(len(ci), hv)))
            hole[ci[hit], cj[hit]] = True
    hole = ndimage.binary_closing(hole, np.ones((3, 3)), iterations=2, border_value=0) | hole
    hole = ndimage.binary_fill_holes(hole)
    rows = np.where(hole.any(1))[0]
    if len(rows) < 2:
        return _why(debug, "rows")
    rows = np.arange(rows[0], rows[-1] + 1)
    # the outer layer of what is known, per cell, blurred across the edge
    # (not along it, where the rows' phase is) within what is known: a cell
    # two spacings wide holds a splat or two, and half the cells of a wall
    # came out empty
    known = ~hole
    kn = ~painted & (H_ > -4 * spacing) & (H_ < 4 * spacing)
    w = alpha[tube[kn]]
    lin = I_[kn] * n_a + J_[kn]

    def grid(vals, sel_, lin_):
        return np.bincount(lin_, vals, n_s * n_a).reshape(n_s, n_a)

    Kf = known.astype(np.float64)
    kb = np.maximum(ndimage.gaussian_filter(Kf, (0.0, 1.5)), 1e-9)

    def blur(g_):
        return np.where(known, ndimage.gaussian_filter(g_ * Kf, (0.0, 1.5)) / kb, 0.0)

    occ = blur(grid(w, kn, lin))
    col = np.stack([blur(grid(w * rgb[tube[kn], c], kn, lin)) for c in range(3)], -1)
    col = col / np.maximum(occ, 1e-9)[..., None]
    hh = blur(grid(w * H_[kn], kn, lin)) / np.maximum(occ, 1e-9)
    fr_ = ~painted & (H_ >= 4 * spacing)
    bk_ = ~painted & (H_ <= -4 * spacing)
    front = blur(grid(alpha[tube[fr_]], fr_, I_[fr_] * n_a + J_[fr_]) + ahead)
    back = blur(grid(alpha[tube[bk_]], bk_, I_[bk_] * n_a + J_[bk_]))
    f = _features(occ, col, hh, front, back, known, spacing)
    shifts, score = _choose_shifts(f, known, hole, rows)
    if shifts is None:
        return _why(debug, "shifts")
    # How far across the edge the copies may reach: a copy is turned with the
    # edge between its row and its source, and a face that does not turn with
    # the edge -- the sole's lattice beyond its rim -- is moved sideways by that
    # turn times the distance from the edge. Where that passes three cells,
    # the face's own fill stays.
    def turn_of(rows_, shifts_):
        s_row = s_lo + (rows_ + 0.5) * cell
        _, F1 = st.frame_at(s_row)
        _, F2 = st.frame_at(s_row + shifts_ * cell)
        tr = np.einsum("nki,nki->n", F1, F2)
        return float(np.arccos(np.clip((tr - 1) / 2, -1, 1)).max())

    turn_max = turn_of(rows, shifts)
    # A curved edge: one shift for every row reaches too far round the bend
    # (on the sole's outline at the arch, ten to twelve units, 18 degrees).
    # Then each half of the hole copies from just past its own end instead
    # (`_choose_shifts` with a reach), the copies turn with the edge, and
    # they keep their height over the surface rather than over the edge's
    # profile, which lay up to 0.8 units off the sole there.
    bent = turn_max > np.radians(max_turn_deg)
    reach_rows = max(8, int(round(0.4 * len(rows)))) if bent else None
    if bent:
        shifts, score = _choose_shifts(f, known, hole, rows, reach=reach_rows)
        if shifts is None:
            return _why(debug, "shifts")
        turn_max = turn_of(rows, shifts)
    a_c = a_lo + (np.arange(n_a) + 0.5) * cell
    a_allow = max(3.0 * cell / max(turn_max, 1e-6), 8.0 * cell)
    cols = np.abs(a_c) <= a_allow
    if not cols.all():
        hole = hole & cols[None, :]
        r_ = np.where(hole.any(1))[0]
        if len(r_) < 2:
            return _why(debug, "cols")
        rows = np.arange(r_[0], r_[-1] + 1)
        if bent:
            reach_rows = max(8, int(round(0.4 * len(rows))))
        fc = np.where(cols[None, :, None], f, 0.0)
        shifts, score = _choose_shifts(fc, known & cols[None, :], hole, rows, reach=reach_rows)
        if shifts is None:
            return _why(debug, "cols")
        if bent:
            turn_max = turn_of(rows, shifts)
    # Where the edge still turns much between a row and its source, a copy is
    # a guess, and the face fill stays. One shift for all rows on the sole's
    # outline took rows eleven units away and brought a ladder of bars into
    # the pebbles; the side wall changes pattern along the outline. Taking
    # only the colour the rows give each cell, and only in cells the face fill
    # left open, were tried as well; neither looked better than the face fill.
    if turn_max > np.radians(bent_turn_deg if bent else max_turn_deg):
        return _why(debug, "turn")
    # copy: each hole cell takes the splats of its source cell
    # never what was painted: past the reach the hole is cut off, and its
    # cells there still hold the painted splats (on the heel, the logo's ®)
    lin_all = np.where(painted, -1, I_ * n_a + J_)
    order = np.argsort(lin_all, kind="stable")
    order = order[lin_all[order] >= 0]
    lin_all = lin_all[order]
    starts = np.searchsorted(lin_all, np.arange(n_s * n_a + 1))
    # The profile is the edge's, not the surface's: on the heel the stitches
    # lay four spacings under it. What a cell holds is measured from the
    # surface itself (`_surface_height`, a thin plate over the hole).
    # Placing the copies by it too -- each keeping its height over the
    # surface where it came from -- changed nothing on the heel and put a
    # kink into the hut's corner board, so the copies keep the profile's.
    hs, have = _surface_height(I_[~painted], J_[~painted], H_[~painted], alpha[tube[~painted]],
                               n_s, n_a, spacing)
    have &= known
    hs_fit = hs
    if have.sum() >= 20:
        from .repair import fit_reference_surface
        hs_fit = fit_reference_surface(np.where(have, hs, 0.0), have, smooth_cells=3.0,
                                       plate=True, need=hole, fast=True)
    # Only from a cell outside the hole. On the heel the edge was followed
    # for barely twice the hole's length, the bottom rows could only copy
    # from rows inside the hole, and those held nothing but the lining: the
    # heel showed through as two dark dents. A cell whose source lies in the
    # hole takes the known cell of its column nearest to that source instead,
    # on the same side of the hole as the source where there is one.
    #
    # Nor from a cell holding a one-off. A row is chosen as a whole, and on
    # the heel the rows a unit above the logo carried a few stitches of the
    # collar's seam at one end: they came along as short dark dashes in the
    # middle of the leather. Per cell its worst splat is held against the
    # brightness of its whole column (along the edge) and of its whole row
    # (across it, `_line_worst`); past four robust spreads in both it is a
    # one-off, and a cell whose source holds one takes the nearest ordinary
    # cell of its column instead. The column alone took the hut's dark plank
    # joints for one-offs and moved a tenth of the corner's sources: the
    # corner board got a notch. A joint runs along its row, a stitch does
    # not. The face fill's own measure (`repair._cell_outliers`, against the
    # 7 x 7 cells round it) missed half the stitches and moved sources off
    # bright leather too: one dent came back.
    rel = H_ - hs_fit[I_, J_]
    sk = ~painted & (alpha[tube] > 0.15) & (np.abs(rel) < 4 * spacing) & known[I_, J_]
    colz, rowz = _line_worst(rgb[tube[sk]].mean(1), I_[sk], J_[sk], n_s, n_a)
    k_odd = 4.0
    odd = known & (colz > k_odd) & (rowz > k_odd)
    plain = known & ~odd
    dcell = np.zeros((n_s, n_a), np.int64)
    src_ok = np.zeros_like(hole)
    moved = np.zeros_like(hole)
    for i, d in zip(rows, shifts):
        hj = np.where(hole[i])[0]
        good = plain[i + d, hj]
        dcell[i, hj] = d
        src_ok[i, hj[good]] = True
        for j in hj[~good]:
            kr = np.where(plain[:, j])[0]
            if not len(kr):
                continue
            side = kr[np.sign(kr - i) == np.sign(d)]
            kr = side if len(side) else kr
            k = int(kr[np.argmin(np.abs(kr - (i + d)))])
            dcell[i, j] = k - i
            src_ok[i, j] = True
            moved[i, j] = True
    if not src_ok.any():
        return _why(debug, "no source")
    take, ds_, dh_ = [], [], []
    for i in rows:
        for j in np.where(src_ok[i])[0]:
            d = int(dcell[i, j])
            c_ = (i + d) * n_a + j
            k0, k1 = starts[c_], starts[c_ + 1]
            if k1 > k0:
                take.append(order[k0:k1])
                ds_.append(np.full(k1 - k0, d, np.int64))
                dh_.append(np.full(k1 - k0, hs_fit[i, j] - hs_fit[i + d, j] if bent else 0.0))
    if not take:
        return _why(debug, "no copies")
    take = np.concatenate(take)
    ds_ = np.concatenate(ds_)
    dh_ = np.concatenate(dh_)
    src_idx = tube[take]
    s_new = S_[take] - ds_ * cell
    added = s.take(src_idx)
    added.xyz = st.place(s_new, A_[take], H_[take] + dh_).astype(added.xyz.dtype)
    # turn each copy with the frame, source to target
    _, F_src = st.frame_at(S_[take])
    _, F_dst = st.frame_at(s_new)
    R = np.einsum("nki,nkj->nij", F_dst, F_src)       # F_dst^T F_src
    ang = np.degrees(np.arccos(np.clip((np.trace(R, axis1=1, axis2=2) - 1) / 2, -1, 1)))
    turn = ang > 0.5
    if turn.any():
        q = shtools.matrix_to_quat(R[turn] @ shtools.quat_to_matrix(s.quat[src_idx[turn]]))
        rot = added.rot.copy()
        rot[turn] = q.astype(rot.dtype)
        added.rot = rot
        if added.f_rest.shape[1]:
            key = np.round(ang / 6.0).astype(np.int64)
            fr = added.f_rest.copy()
            for g in np.unique(key[turn]):
                m = turn & (key == g)
                U_, _, Vt_ = np.linalg.svd(R[m].mean(0))
                fr[m] = shtools.rotate_sh(added.f_rest[m], U_ @ Vt_)
            added.f_rest = fr
    # what goes: the whole layer under the hole cells, painted or not
    gone = tube[src_ok[I_, J_]]
    removed = np.union1d(si, gone)
    hole_keep = src_ok

    def covers(P):
        if len(P) == 0:
            return np.zeros(0, bool)
        s2, a2, h2 = st.unroll(np.asarray(P, np.float64))
        i2 = np.floor((s2 - s_lo) / cell).astype(np.int64)
        j2 = np.floor((a2 - a_lo) / cell).astype(np.int64)
        ok = (i2 >= 0) & (i2 < n_s) & (j2 >= 0) & (j2 < n_a) & (h2 > -2 * h_in) & (h2 < 2 * h_out)
        out = np.zeros(len(P), bool)
        out[ok] = hole_keep[i2[ok], j2[ok]]
        return out

    info = {"unfold": "rows", "unfold_rows": int(len(rows)), "unfold_cells": int(src_ok.sum()),
            "unfold_no_source": int((hole & ~src_ok).sum()),
            "unfold_moved_source": int(moved.sum()),
            "unfold_one_offs": int(sum(int((odd[i + d] & hole[i]).sum()) for i, d in zip(rows, shifts))),
            "unfold_bent": bool(bent),
            "unfold_cols": [int(cols.sum()), int(n_a)],
            "unfold_turn_deg": round(float(np.degrees(turn_max)), 1),
            "unfold_shifts": [int(x) for x in np.unique(shifts)][:12],
            "unfold_score": round(float(score), 3), "unfold_added": int(added.n),
            "unfold_removed": int(len(gone)), "unfold_grid": [int(n_s), int(n_a)],
            "unfold_fold_deg": round(float(fold["angle"]), 1)}
    if debug is not None:
        debug.update(dict(bent=bent, reach_rows=reach_rows, cols=cols, st=st, occ=occ, col=col, hh=hh, hole=hole, src_ok=src_ok, hs=hs_fit, colz=colz, dcell=dcell, src_idx=src_idx, rows=rows, shifts=shifts, turn_deg=np.degrees(turn_max),
                          s_lo=s_lo, a_lo=a_lo, cell=cell, h_in=h_in, h_out=h_out, f=f))
    return dict(removed=removed, added=added, covers=covers, info=info, strip=st)
