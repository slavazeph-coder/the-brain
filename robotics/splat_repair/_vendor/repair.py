"""The repair brush: delete a region of Gaussians and fill the hole.

The surface around a brushed region is locally a height field over a tangent
plane, so the whole problem can be moved into 2D. We fit a robust tangent frame
to the rim, express everything as ``(u, v, h)``, rebuild the missing geometry as
a smooth ``h(u, v)`` plus borrowed high-frequency relief, and hand every new
Gaussian its appearance by *copying a donor wholesale* rather than averaging.

That last point matters most. A Gaussian's scale, rotation and SH bands were
fitted jointly by the trainer and are only coherent as a set. Blending ten
neighbours' quaternions yields an orientation matching none of them, and
averaging log-scales systematically inflates them -- the classic "cotton wool"
patch. So we pick one donor stochastically and take its whole covariance and
radiance, overriding only position and the DC colour term.

Two donor strategies, because surfaces differ:

``rim``     Each new Gaussian copies a nearby rim splat chosen by inverse
            distance. Robust on any topology; ideal for stochastic texture
            (grain, fabric, worn rubber). Cannot reproduce structure larger
            than the rim band.

``patch``   Find one coherent donor region elsewhere on the same surface whose
            rim matches this hole's, and transplant it as a block. Keeps
            repeating structure intact -- tread, weave, tiling -- which ``rim``
            would smear into mush.

``auto`` tries ``patch`` and falls back to ``rim`` when no donor scores well.

One thing a 2D healing brush gets for free and this does not: knowing which
surface the user meant. A scanned shell has an outside and an inside within a
centimetre of each other, and they land in the same ``(u, v)`` cell. Which side
is the front is decided by the camera the stroke was painted from
(``RepairParams.view``, sent by the app as it stood when the stroke, lasso or
box was made): the side facing it is outward. Only without a view, or when the
view runs nearly along the surface, does the material count decide -- the side
holding less than the rim is outward. Each cell is then cut at its first
thickness gap from that side, which keeps the layer the rim sits on.
"""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy import ndimage, signal, sparse
from scipy.sparse.linalg import spsolve
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree

from .io import SplatSet, SH_C0
from . import surfacefit


@dataclass
class RepairParams:
    """Knobs for :func:`repair`. Defaults are tuned for object-scale scans."""

    mode: str = "auto"              # "auto" | "patch" | "rim"
    density: float = 1.0            # multiplies the rim's splat density
    roughness: float = 1.0          # 0 = glassy smooth, 1 = keep donor relief
    relief_clamp: float = 3.0       # donor relief limit, in MADs; 0 = off
    backing: float = 10.0           # copy material this deep under the face
    color_smooth: float = 0.5       # 0 = donor DC verbatim, 1 = local IDW mean
    stiffness: float = 0.05         # ridge on the bootstrap polynomial's curvature
    reference_smooth: float = 6.0   # reference surface stiffness, in grid cells
    tone_smooth: float = 6.0        # reference tone stiffness, in grid cells
    tone_plate: bool = False        # bend the tone across the hole (worse)
    feather: float = 0.25           # seam fade, as a fraction of the stroke's half-width
    cleanup_ghosts: bool = True     # also drop haze left floating over the hole
    replace_below: float = 0.6      # painted cells with less face than this are refilled
    ring_continues: bool = True     # the seam ring copies from the hole's donors
    optical_fade: bool = True       # fade in optical depth, not in alpha
    fold_warn_deg: float = 70.0     # warn when rim sectors disagree by more than this
    charts: bool = True             # repair across a fold in two charts (see `repair`)
    chart_misfit: float = 0.8       # share of rim normals > 45 deg off the plane that splits
    turn_copies: bool = True        # turn each copy with the surface from donor to target
    source_region: int = 3          # closing size: source cells may be empty surface (0 = occupied only)
    empty_source: str = "skip"      # empty source inside the surface: "skip" copies it as empty,
                                    # "rigid" copies a neighbouring cell, "scatter" the old way
    outlier_weight: float = 8.0     # price on sources holding a one-off splat (0 = off)
    motif_weight: float = 8.0       # price on sources inside a motif the ring lacks (0 = off)
    enclosed_zone: bool = True      # a hole one zone encloses takes sources from that zone only
    depth_weight: float = 4.0       # in such a hole, price on changing depth inside the zone
    respect_edge: bool = True       # never fill past the surface's own edge
    unfold: bool = True             # over a fold or an edge: unroll it and copy along it (unfold.py)
    close_gaps: bool = True         # put painted surface splats no fill covers back, in the colour round them
    sh_mode: str = "donor"          # "donor" | "flat"
    surface_degree: int = 2         # polynomial degree of the fitted height field
    surface_trend: int = 0          # curved trend under the reference plate (surfacefit), degree; 0 = plate only (paused: 3 is the candidate, see updates/2026-11-10/progress/fill.md)
    relief_local: float = 0.0       # donor relief against its own local surface, smoothing in cells;
                                    # 0 = against hf (local measured worse on bench_shoe_gt, stays off)
    seam_clean: bool = False        # read the seam and tone outside the painted footprint only
    seam_membrane: bool = False     # seam correction as a membrane (stays in the ring's range), not a plate
    placement: str = "donor"        # "donor" | "grid": where new splats go
    zones: int = 5                  # kinds of surface to tell apart; 1 = off
    zone_weight: float = 1.0        # how dearly a match may cross a kind
    zone_bridge: bool = True        # carry a band across the hole
    zone_curves: bool = True        # continue a band's two boundaries through the hole
    curve_weight: float = 2.0       # price on leaving the depth a curve predicts
    curve_cap: float = 6.0          # that depth counts up to this many cells
    curve_margin: int = 4           # priced this far either side of a curve
    curve_gap: int = 12             # rim runs shorter than this are noise
    curve_fill: bool = True         # a smooth band's interior is scattered, not copied
    curve_smooth_ratio: float = 0.8  # "smooth": texture energy below this share of the surface's
    curve_border_thr: float = 0.3   # border = depths deviating more than this share of the most
    curve_pool_bright: tuple = (10.0, 55.0)  # brightness percentiles of the plain donor pool
    curve_pool_aniso: float = 50.0  # ... and its anisotropy percentile
    edge_band_weight: float = 8.0   # price on changing edge distance inside an edge band (0 = off)
    texture_weight: float = 0.0     # local texture strength in the match
    lattice: bool = True            # add lattice-vector multiples as candidates
    # Both off by measurement, not by preference. They are the textbook
    # form -- Wexler, Shechtman and Irani match every window overlapping the
    # hole, not only the ones inside it, and write each cell the weighted
    # mean over all windows covering it. Here the weighted vote doubles the
    # height error on the larger hold-out discs (1.96 splat spacings to
    # 4.57) and the frontier adds a little more on top. The reason is
    # probably that this grid is sparse and noisy where an image is dense:
    # a weighted mean of several uncertain proposals is a blur, and a blur
    # is a poor thing to match the next pass against.
    synth_frontier: bool = False    # also match cells just outside the hole
    synth_soft_vote: bool = False   # weighted vote over all covering windows
    synth: bool = True              # per-cell patch matching inside the hole
    synth_passes: int = 8           # how many matching passes
    synth_levels: int = 1           # pyramid levels; 1 = none (see below)
    synth_coherence: float = 10.0   # price of disagreeing with a neighbour
    rim_scale: float = 1.0          # rim band width multiplier
    neighbourhood: float = 3.0      # donor search reach, multiples of the half-width
    # The painting camera's forward direction. With it the side of the
    # surface facing the camera is the front; without it, the side with
    # less material is (wrong on a translucent wall with haze in front).
    view: Optional[list] = None
    # The painted volume (the app's ``volume`` dict, or an object with
    # ``inside`` and ``mask_in_view``; see `as_volume`). With it the cells of
    # the fitted surface inside the volume are the hole too, splats or not --
    # a hole in the scan has nothing to select -- and the deep fill's masks
    # are the volume seen from each view. None: the selection is the hole.
    volume: Optional[object] = None
    seed: int = 0

    def validate(self) -> None:
        if self.mode not in ("auto", "patch", "rim"):
            raise ValueError("mode must be auto, patch or rim")
        if self.sh_mode not in ("donor", "flat"):
            raise ValueError("sh_mode must be donor or flat")
        if not 1 <= self.surface_degree <= 3:
            raise ValueError("surface_degree must be 1, 2 or 3")
        if self.density <= 0:
            raise ValueError("the density must be positive")


@dataclass
class RepairResult:
    removed: np.ndarray             # indices into the input set
    added: SplatSet                 # brand-new Gaussians
    # Which of `added` are the slab behind the face rather than the face
    # itself. They sit several spacings under the surface on purpose, so
    # anything measuring where the fill *is* has to leave them out; anything
    # measuring how it looks must keep them.
    backing: Optional[np.ndarray] = None
    info: dict = field(default_factory=dict)
    # Working geometry, kept for a deep pass to build on: the tangent frame,
    # the fitted surface and where the hole was. Not serialised -- `info` is
    # what crosses the wire.
    context: dict = field(default_factory=dict)

    def apply_to(self, s: SplatSet) -> SplatSet:
        keep = np.ones(s.n, bool)
        keep[self.removed] = False
        return s.take(keep).concat(self.added)


class RepairError(RuntimeError):
    """Raised when the region cannot be repaired (and why)."""


class NothingToFill(RepairError):
    """The surface behind the stroke is whole: there is nothing to fill.

    ``standoff``: median distance from the painted splats to what is left, in
    splat spacings -- a pole in front of a wall, not a skin of the surface.
    """

    def __init__(self, msg, standoff=0.0):
        super().__init__(msg)
        self.standoff = float(standoff)


# ----------------------------------------------------------- painted volume

def as_volume(spec):
    """The painted volume (``volume.Volume``) from the app's dict; None stays None.

    An object that already has ``inside`` and ``mask_in_view`` is taken as
    it is. A volume that adds nothing counts as none.
    """
    if spec is None:
        return None
    if hasattr(spec, "inside") and hasattr(spec, "mask_in_view"):
        vol = spec
    else:
        if not isinstance(spec, dict):
            raise ValueError("volume must be an object with capsules or regions")
        from .volume import Volume
        vol = Volume.from_wire(spec)
    if vol is None or getattr(vol, "empty", False):
        return None
    return vol


def _volume_surface(vol) -> np.ndarray:
    """Points on the painted surface (holes included), computed once per volume."""
    got = getattr(vol, "_repair_surface", None)
    if got is None:
        fn = getattr(vol, "surface_points", None)
        got = np.asarray(fn(), np.float64).reshape(-1, 3) if fn is not None else np.zeros((0, 3))
        try:
            vol._repair_surface = got
        except AttributeError:
            pass
    return got


def _volume_pad(vol) -> float:
    """How far past its painted surface the volume reaches (brush, depth)."""
    caps = [c for c in getattr(vol, "capsules", ()) if getattr(c, "add", True)]
    return max([max(float(c.r), float(c.depth)) for c in caps] or [0.0])


def _volume_depth(vol) -> float:
    """How deep the brush reached along its view: the largest capsule depth."""
    caps = [c for c in getattr(vol, "capsules", ()) if getattr(c, "add", True)]
    return max([float(c.depth) for c in caps] or [0.0])


def _volume_cells(vol, surface, gu, gv, origin, basis, cu0, cv0, holefoot, cell, column=0.0):
    """Grid cells whose column through ``surface`` meets the painted volume.

    Only cells near the stroke are tested: the box of its painted surface,
    grown by the brush, and the selection's own footprint, grown a little.
    Gaps the stroke left inside its own footprint (a dab that met the far
    wall through the hole, say) are closed.
    """
    nv, nu = gu.shape
    cand = ndimage.binary_dilation(holefoot, np.ones((3, 3)), iterations=3)
    sp = _volume_surface(vol)
    if len(sp):
        pad = _volume_pad(vol) + 2.0 * cell
        uva = (sp - origin) @ basis[:2].T
        lo_u0 = float(gu[0, 0] + cu0) - 0.5 * cell
        lo_v0 = float(gv[0, 0] + cv0) - 0.5 * cell
        u0 = int(np.floor((uva[:, 0].min() - pad - lo_u0) / cell))
        u1 = int(np.floor((uva[:, 0].max() + pad - lo_u0) / cell)) + 1
        v0 = int(np.floor((uva[:, 1].min() - pad - lo_v0) / cell))
        v1 = int(np.floor((uva[:, 1].max() + pad - lo_v0) / cell)) + 1
        box = np.zeros((nv, nu), bool)
        box[max(v0, 0):max(min(v1, nv), 0), max(u0, 0):max(min(u1, nu), 0)] = True
        cand |= box
    ty, tx = np.where(cand)
    out = np.zeros((nv, nu), bool)
    if not len(ty):
        return out
    du, dv = gu[ty, tx], gv[ty, tx]
    h = np.asarray(surface(du, dv), float).reshape(-1)
    # A short column through the surface, not its one point: over a hole the
    # surface is a guess -- on the shoe it sat a quarter unit inside the sole,
    # pulled by the inner wall seen through the hole, while the brush sat on
    # the tread's ridges -- and a shallow brush missed it. Along the normal
    # the column reaches as deep as the brush does, no further.
    reach = max(float(column), 2.0 * cell)
    hit = np.zeros(len(ty), bool)
    for f in np.linspace(-1.0, 1.0, 7):
        todo = ~hit
        if not todo.any():
            break
        P = origin + np.stack([du[todo] + cu0, dv[todo] + cv0, h[todo] + f * reach], 1) @ basis
        hit[np.where(todo)[0][vol.inside(P)]] = True
    out[ty, tx] = hit
    if out.any():
        out = ndimage.binary_fill_holes(out)
    return out


def _volume_standins(s: SplatSet, vol, most: int = 4000):
    """Painted where no splat is: stand-ins on the painted surface, to be removed.

    A stroke painted wholly over a hole in the scan selects nothing, and the
    rim band, the grid and the frame are all measured from what is selected.
    Stand-ins at the volume's own surface points give them something; they
    are nearly transparent, so no normal is taken from them, and they leave
    with the rest of the selection.
    """
    P = _volume_surface(vol)
    if len(P) < 8:
        return None
    if len(P) > most:
        P = P[np.random.default_rng(0).choice(len(P), most, replace=False)]
    near = cKDTree(s.xyz.astype(np.float64)).query(P)[1]
    st = s.take(near)
    st.xyz = P.astype(st.xyz.dtype)
    st.opacity = np.full(st.n, -4.0, st.opacity.dtype)       # alpha 0.018
    return st


# ----------------------------------------------------------- surface fitting

def _turn_copies(quats, xyz_src, uv_new, hf, origin, basis, cu0, cv0, cell, sh_step=0.1):
    """Turn copies by the fitted surface's change of normal, donor to target.

    Returns ``(quats, angles_deg, sh_fn)``; ``sh_fn`` rotates view-dependent
    bands the same way, in groups of similar turns (``sh_step`` radians), as
    fitting the band mixing for every splat on its own would cost seconds.
    """
    from . import shtools

    def normal(u, v):
        e = cell
        hu = (hf(u + e - cu0, v - cv0) - hf(u - e - cu0, v - cv0)) / (2 * e)
        hv = (hf(u - cu0, v + e - cv0) - hf(u - cu0, v - e - cv0)) / (2 * e)
        n = np.stack([-hu, -hv, np.ones_like(hu)], 1)
        return n / np.linalg.norm(n, axis=1, keepdims=True)

    uv_src = (xyz_src - origin) @ basis[:2].T
    n_d = normal(uv_src[:, 0], uv_src[:, 1])
    n_t = normal(uv_new[:, 0], uv_new[:, 1])
    axis = np.cross(n_d, n_t)
    sin = np.linalg.norm(axis, axis=1)
    ang = np.arctan2(sin, np.sum(n_d * n_t, 1))
    axis = axis / np.maximum(sin, 1e-12)[:, None]
    # axis-angle in frame coordinates, then into the world
    rotvec = (axis * ang[:, None]) @ basis

    def rodrigues(rv):
        th = np.linalg.norm(rv, axis=-1)
        k = rv / np.maximum(th, 1e-12)[..., None]
        K = np.zeros(rv.shape[:-1] + (3, 3))
        K[..., 0, 1], K[..., 0, 2] = -k[..., 2], k[..., 1]
        K[..., 1, 0], K[..., 1, 2] = k[..., 2], -k[..., 0]
        K[..., 2, 0], K[..., 2, 1] = -k[..., 1], k[..., 0]
        s_, c_ = np.sin(th)[..., None, None], np.cos(th)[..., None, None]
        return np.eye(3) + s_ * K + (1 - c_) * (K @ K)

    # Copies on a surface that does not turn stay bit for bit what they were:
    # a round trip through the matrix renormalises and may flip the sign.
    out = quats.copy()
    turn = ang > np.radians(0.5)
    if turn.any():
        R = rodrigues(rotvec[turn])
        out[turn] = shtools.matrix_to_quat(R @ shtools.quat_to_matrix(quats[turn]))

    def sh_fn(f_rest):
        if f_rest.shape[1] == 0:
            return f_rest
        key = np.round(rotvec / sh_step).astype(np.int64)
        moved = ang > 0.5 * sh_step
        res = f_rest.copy()
        if not moved.any():
            return res
        uniq, inv = np.unique(key[moved], axis=0, return_inverse=True)
        idx = np.where(moved)[0]
        for g in range(len(uniq)):
            members = idx[inv.reshape(-1) == g]
            Rg = rodrigues(rotvec[members].mean(0))
            res[members] = shtools.rotate_sh(f_rest[members], Rg)
        return res

    return out, np.degrees(ang), sh_fn


def fit_tangent_frame(P, w=None, iters=2, mad_k=3.5):
    """Robust opacity-weighted tangent frame.

    Returns ``(origin, basis, inliers)``; ``basis`` rows are ``(e_u, e_v, n)``.

    The MAD rejection is what makes this usable as a brush. Whatever the user
    painted over usually leaves a few residual splats clinging to the rim, and
    an ordinary least-squares plane tips towards them.
    """
    P = np.asarray(P, float)
    if len(P) < 6:
        raise RepairError("too few splats at the rim for a surface (%d)" % len(P))
    w = np.ones(len(P)) if w is None else np.asarray(w, float).clip(1e-6)
    inl = np.ones(len(P), bool)
    V = None
    for _ in range(iters + 1):
        ww = w[inl]
        c = np.average(P[inl], axis=0, weights=ww)
        X = P[inl] - c
        C = (X * ww[:, None]).T @ X / ww.sum()
        _, V = np.linalg.eigh(C)
        n = V[:, 0]
        h = (P - c) @ n
        med = np.median(h[inl])
        mad = np.median(np.abs(h[inl] - med))
        if mad < 1e-12:
            break
        nxt = np.abs(h - med) < mad_k * 1.4826 * mad
        if nxt.sum() < 6 or np.array_equal(nxt, inl):
            break
        inl = nxt
    e_u, e_v, n = V[:, 2], V[:, 1], V[:, 0]
    if np.dot(np.cross(e_u, e_v), n) < 0:
        e_v = -e_v
    return c, np.stack([e_u, e_v, n]), inl


class HeightField:
    """Polynomial ``h(u, v)`` fitted in coordinates normalised by the rim extent.

    Normalising first is what makes the curvature ridge behave: coefficients
    then carry units of height-at-the-rim, so one ``stiffness`` value means the
    same thing on a 3 cm dent and a 3 m wall.
    """

    def __init__(self, coef, deg, scale):
        self.coef, self.deg, self.scale = coef, deg, scale

    def __call__(self, u, v):
        u, v = np.asarray(u, float), np.asarray(v, float)
        shape = np.broadcast(u, v).shape
        flat = _poly((u / self.scale).ravel(), (v / self.scale).ravel(), self.deg)[0]
        return (flat @ self.coef).reshape(shape)


class GridSurface:
    """A height field stored per grid cell, sampled bilinearly.

    Deliberately the same call signature as the polynomial it replaced --
    coordinates relative to the hole centre -- so the deep pass, which gets
    this through ``RepairResult.context["surface"]``, needs no change.
    """

    def __init__(self, H, lo_u, lo_v, cell, cu0, cv0):
        self.H, self.cell = H, cell
        self.lo_u, self.lo_v = lo_u, lo_v
        self.cu0, self.cv0 = cu0, cv0

    def __call__(self, du, dv):
        du, dv = np.asarray(du, float), np.asarray(dv, float)
        shape = np.broadcast(du, dv).shape
        u = np.broadcast_to(du, shape).ravel() + self.cu0
        v = np.broadcast_to(dv, shape).ravel() + self.cv0
        x = (u - self.lo_u) / self.cell - 0.5
        y = (v - self.lo_v) / self.cell - 0.5
        return ndimage.map_coordinates(self.H, [y, x], order=1,
                                       mode="nearest").reshape(shape)


def _frame_along(P, w, n, mad_k=3.5):
    """`fit_tangent_frame` with the normal given: origin and inliers only."""
    n = np.asarray(n, float) / np.linalg.norm(n)
    w = np.asarray(w, float).clip(1e-6)
    a = np.cross(n, [1.0, 0, 0] if abs(n[0]) < 0.9 else [0, 1.0, 0])
    a /= np.linalg.norm(a)
    h = P @ n
    med = float(np.median(h))
    mad = float(np.median(np.abs(h - med)))
    inl = np.abs(h - med) < mad_k * 1.4826 * max(mad, 1e-12)
    if inl.sum() < 6:
        inl = np.ones(len(P), bool)
    c = np.average(P[inl], axis=0, weights=w[inl])
    return c, np.stack([a, np.cross(n, a), n]), inl


def _lap_1d(m):
    """Second difference with a reflecting (Neumann) edge."""
    if m < 3:
        return sparse.csr_matrix((m, m))
    e = np.ones(m)
    D = sparse.diags([e[:-1], -2.0 * e, e[:-1]], [-1, 0, 1], format="lil")
    D[0, 0] = -1.0
    D[m - 1, m - 1] = -1.0
    return D.tocsr()


_LU_CACHE = {}          # system key -> (thread, {"lu": ...} or {"err": ...})

# A grid above this many cells is solved the quick way (`_solve_domain`).
# Below it nothing changes: the hold-out discs are 5-30 thousand cells, the
# stand's hole 75 thousand; a stroke along the hut's wall is 235 thousand.
_LARGE_GRID = 120_000


def _solve_domain(known, need, sm, plate, fast):
    """The cells a large grid is solved on, or None for the whole grid.

    On the hut a stroke along the wall runs diagonally across its chart: the
    grid is the stroke's box, 235 thousand cells, and three quarters of it
    hold neither surface nor hole. Every thin plate was factorised over all
    of it -- 16 of 25 seconds. A plate's value is only wanted on the data
    and on ``need`` (the hole), and what it does there depends on cells a
    few stiffness lengths away, not on an empty corner of the box. So it is
    solved on the cells within three stiffness lengths of them, holes in
    that closed; the rest takes its nearest value. Membranes are cheap and
    stay on the whole grid.
    """
    nv, nu = known.shape
    if not fast or not plate or nv * nu <= _LARGE_GRID:
        return None
    core = known if need is None else (known | need)
    if not core.any():
        return None
    m = int(np.ceil(max(8.0, 3.0 * sm)))
    dom = ndimage.distance_transform_cdt(~core, metric="chessboard") <= m
    dom = ndimage.binary_fill_holes(dom)
    if dom.sum() > 0.85 * nv * nu:
        return None
    return dom


def _system_key(known, sm, plate, exact, domain=None):
    return (known.shape, sm, bool(plate), bool(exact),
            np.packbits(np.asarray(known, bool)).tobytes(),
            None if domain is None else np.packbits(domain).tobytes())


def _system_matrix(known, sm, plate, domain=None):
    if domain is not None:
        return _domain_matrix(known, sm, plate, domain)
    nv, nu = known.shape
    L = (sparse.kron(sparse.eye(nv), _lap_1d(nu))
         + sparse.kron(_lap_1d(nv), sparse.eye(nu))).tocsr()
    # A whisper of pull towards the mean everywhere keeps the system
    # non-singular where a whole region has no data at all.
    w = np.where(known.ravel(), 1.0, 1e-4)
    smooth = (sm ** 4) * (L.T @ L) if plate else (sm ** 2) * (-L)
    return w, (sparse.diags(w) + smooth).tocsc()


def _domain_matrix(known, sm, plate, domain):
    """`_system_matrix` on the cells of ``domain``, reflecting at its border.

    The same second differences as on the whole grid, taken only between
    neighbours that are both in the domain: over the full grid this is the
    grid's own matrix.
    """
    idx = np.full(domain.shape, -1, np.int64)
    nd = int(domain.sum())
    idx[domain] = np.arange(nd)
    Ls = []
    for a, b in ((idx[:, :-1], idx[:, 1:]), (idx[:-1, :], idx[1:, :])):
        ok = (a >= 0) & (b >= 0)
        a, b = a[ok], b[ok]
        e = np.arange(len(a))
        D = sparse.csr_matrix((np.r_[-np.ones(len(a)), np.ones(len(a))],
                               (np.r_[e, e], np.r_[a, b])), shape=(len(a), nd))
        Ls.append(-(D.T @ D))
    L = (Ls[0] + Ls[1]).tocsr()
    w = np.where(known[domain], 1.0, 1e-4)
    smooth = (sm ** 4) * (L.T @ L) if plate else (sm ** 2) * (-L)
    return w, (sparse.diags(w) + smooth).tocsc()


def _factorise(A, exact):
    if not exact:
        # Symmetric positive definite: a symmetric ordering and no pivoting
        # factorise it in half the time, equal to float rounding. Callers
        # ask for it only where that rounding cannot matter.
        try:
            return sparse.linalg.splu(A, permc_spec="MMD_AT_PLUS_A", diag_pivot_thresh=0.0,
                                      options=dict(SymmetricMode=True))
        except Exception:                  # noqa: BLE001 - fall back to the general LU
            pass
    return sparse.linalg.splu(A)


def prefetch_reference_surface(known, smooth_cells=6.0, max_cells=400_000, plate=True,
                               exact=True, need=None, fast=False):
    """Start factorising the system `fit_reference_surface` will meet for ``known``.

    Runs in a thread; the fit that asks for the same system takes it from
    there. A prefetch nobody asks for costs a core for a moment and nothing else.
    """
    nv, nu = known.shape
    if nv < 3 or nu < 3 or not known.any():
        return
    sm = float(max(smooth_cells, 1e-3))
    known = np.array(known, bool)
    dom = _solve_domain(known, need, sm, plate, fast)
    if (nv * nu if dom is None else int(dom.sum())) > max_cells:
        return
    large = fast and nv * nu > _LARGE_GRID
    key = _system_key(known, sm, plate, exact, dom)
    if key in _LU_CACHE:
        return
    box = {}

    def run():
        try:
            box["lu"] = _factorise(_system_matrix(known, sm, plate, dom)[1], exact and not large)
        except Exception as e:             # noqa: BLE001 - re-raised where it is used
            box["err"] = e

    th = threading.Thread(target=run, daemon=True)
    th.start()
    _LU_CACHE[key] = (th, box)


def fit_reference_surface(data, known, smooth_cells=6.0, max_cells=400_000,
                          plate=True, exact=True, need=None, fast=False):
    """One height per cell: the measured surface where there is one, and a
    thin plate across the gaps.

    This is the surface everything else is measured against -- which cells
    still hold surface, how far each splat stands proud of it, and where new
    splats go. Having exactly one of it is the point. The earlier version
    used a global polynomial to place splats and a locally smoothed median to
    measure relief, and since those two disagree by a different amount at
    every point, their difference was added straight onto the height of every
    splat the fill produced.

    Minimises ``sum_known (f - data)^2 + lam * sum (laplacian f)^2``. The
    plate term is what makes it extrapolate like a surface rather than like a
    polynomial: across a hole it continues the boundary's slope and curvature
    instead of whatever a global quadratic felt like doing, and it matches the
    rim exactly, which is what makes the seam join.

    ``smooth_cells`` is the stiffness expressed as a length, because that is
    the thing with a meaning: detail finer than this counts as relief to be
    borrowed from a donor, anything coarser counts as the shape of the
    surface. ``lam`` is its fourth power, the bending energy going as the
    fourth derivative.

    ``plate=False`` swaps the bending term for a membrane one, ``sum |grad
    f|^2``. The difference is what happens over a wide gap. A plate continues
    the boundary's slope *and* curvature, which is right for a surface -- a
    sole that is curving away keeps curving away -- but a quantity with no
    reason to curve will shoot off: fitted to the tone around the shoe's hole
    the plate read 0.285 in the middle against a rim measured at 0.376, and
    dragged the rim itself down to 0.339 on the way. A membrane obeys the
    maximum principle, so the inside of a gap stays within the range of its
    edge, and the edge keeps the value it was given. Use it for anything that
    is a level rather than a shape.

    ``fast``: on a grid over `_LARGE_GRID` cells, a plate is solved only
    near the data and ``need`` (`_solve_domain`), and every factorisation
    takes the symmetric path, equal to float rounding. Smaller grids come
    out bit for bit as without it.
    """
    stacked = data.ndim == 3
    D = data if stacked else data[..., None]
    nv, nu, C = D.shape
    n = nv * nu

    def fallback():
        out = np.stack([_fill_nearest(np.where(known, D[..., c], np.nan), known)
                        for c in range(C)], -1)
        win = max(3, int(round(smooth_cells)))
        out = ndimage.uniform_filter(out, (win, win, 1), mode="nearest")
        return out if stacked else out[..., 0]

    if nv < 3 or nu < 3 or not known.any():
        return fallback()
    sm = float(max(smooth_cells, 1e-3))
    dom = _solve_domain(known, need, sm, plate, fast)
    if (n if dom is None else int(dom.sum())) > max_cells:
        # Too big to factorise. Nearest-plus-blur is what the old code did
        # everywhere, so this is no worse -- and it keeps one surface, which
        # was the actual bug.
        return fallback()
    large = fast and n > _LARGE_GRID
    sel_ = slice(None) if dom is None else dom.ravel()
    hit = _LU_CACHE.pop(_system_key(known, sm, plate, exact, dom), None)
    if hit is not None:
        w = np.where(known.ravel()[sel_], 1.0, 1e-4)
    else:
        w, A = _system_matrix(known, sm, plate, dom)
    try:
        # One factorisation, several right-hand sides: the matrix depends only
        # on which cells are known, and the colour channels and the height all
        # share that.
        if hit is not None:
            hit[0].join()
            if "err" in hit[1]:
                raise hit[1]["err"]
            lu = hit[1]["lu"]
        else:
            lu = _factorise(A, exact and not large)
        out = np.empty((nv, nu, C))
        if dom is not None:
            # outside the domain: the nearest value in it (never used for
            # anything but a lookup that lands next to the data)
            near_ = ndimage.distance_transform_edt(~dom, return_distances=False,
                                                   return_indices=True)
        for c in range(C):
            mean = float(np.mean(D[..., c][known]))
            d = np.where(known.ravel(),
                         np.nan_to_num(D[..., c].ravel(), nan=mean), mean)
            f = lu.solve(w * d[sel_])
            if not np.all(np.isfinite(f)):
                return fallback()
            if dom is None:
                out[..., c] = f.reshape(nv, nu)
            else:
                g = np.zeros((nv, nu))
                g[dom] = f
                out[..., c] = g[near_[0], near_[1]]
    except Exception:                      # noqa: BLE001 - singular, rare
        return fallback()
    return out if stacked else out[..., 0]


def _poly(u, v, deg):
    cols, curv = [], []
    for i in range(deg + 1):
        for j in range(deg + 1 - i):
            cols.append((u ** i) * (v ** j))
            curv.append(i + j >= 2)
    return np.stack(cols, 1), np.array(curv)


def fit_height_field(u, v, h, deg=2, w=None, stiffness=0.05):
    """Least-squares ``h(u, v)`` with a ridge on the curvature terms only.

    Without the ridge, a quadratic fitted to an uneven rim domes or dishes
    across the span it has no data for, which on a shoe sole reads as a bubble.
    The penalty is deliberately not applied to the constant or linear terms:
    tilt is real information from the rim, curvature past the rim is a guess.
    """
    u, v, h = np.asarray(u, float), np.asarray(v, float), np.asarray(h, float)
    scale = max(float(np.sqrt(np.percentile(u ** 2 + v ** 2, 90))), 1e-9)
    A, curv = _poly(u / scale, v / scale, deg)
    w = np.ones(len(u)) if w is None else np.asarray(w, float)
    sw = np.sqrt(np.clip(w, 1e-9, None))
    Aw, hw = A * sw[:, None], h * sw
    var = max(float(np.var(h)), 1e-12)
    lam = stiffness * w.sum() * var
    reg = np.diag(np.where(curv, lam, 0.0) + 1e-9 * w.sum() * var)
    coef = np.linalg.solve(Aw.T @ Aw + reg, Aw.T @ hw)
    return HeightField(coef, deg, scale)


# ------------------------------------------------------------------ helpers

def _local_spacing(xyz, idx, rng, sample=3000):
    """Median nearest-neighbour distance within a point set.

    Measured by querying a random subsample *against the full set* -- building
    the tree from a subsample instead would report the subsample's spacing,
    which is wildly larger and silently wrecks every downstream cell size.
    """
    tree = cKDTree(xyz[idx], balanced_tree=False, compact_nodes=False)
    q = idx if len(idx) <= sample else rng.choice(idx, sample, replace=False)
    d = tree.query(xyz[q], k=2, workers=-1)[0][:, 1]
    return float(np.median(d[np.isfinite(d) & (d > 0)]))


def _rim_band(xyz, sel_mask, alpha, params, rng):
    """Non-selected splats forming a band around the selection.

    Returns ``(centre, radius, width, spacing, cand_idx, rim_idx)``. ``radius``
    is how far the stroke reaches from its centre; ``width`` is how far it
    reaches across itself. They are the same for a dab and very different for
    a stroke along a cable or a scratch, and nearly everything here scales
    with the second. Sizing it all by the first made a 16-unit stroke search a
    ball 48 units across and lay a feather band as wide as the stroke was
    long: 6.8 s and seven new splats for every one removed, against 0.1 s and
    under two for a disc of the same area.
    """
    sel_pts = xyz[sel_mask]
    centre = sel_pts.mean(0)
    radius = max(float(np.percentile(np.linalg.norm(sel_pts - centre, axis=1), 95)), 1e-6)
    # half-width across the stroke: for a disc of radius R the middle
    # eigenvalue is R^2 / 4, so 2 sqrt(l_mid) gives R back; for a strip it
    # gives half its width
    X = sel_pts - centre
    lam = np.linalg.eigvalsh(X.T @ X / max(len(X), 1))
    width = float(np.clip(2.0 * np.sqrt(max(lam[1], 0.0)), 1e-6, radius))

    # measured from the stroke, not its centre: for a disc, within
    # (n - 1) R of its edge is the old ball of n R round its centre
    # A long stroke needs room beside it for a sideways copy of itself
    # plus the ring the donor search matches on, which two half-widths do
    # not give; five do. A disc, whose width is its radius, is unchanged.
    n1 = max(params.neighbourhood - 1.0, 1.0)
    reach = max(width * n1, min(radius * n1, 5.0 * width))
    lo, hi = sel_pts.min(0) - reach, sel_pts.max(0) + reach
    box = np.all((xyz >= lo) & (xyz <= hi), axis=1) & ~sel_mask & (alpha > 0.2)
    box_idx = np.where(box)[0]
    d_sel = cKDTree(sel_pts).query(xyz[box_idx], k=1, distance_upper_bound=reach,
                                   workers=-1)[0]
    cand_idx = box_idx[np.isfinite(d_sel)]
    if len(cand_idx) < 50:
        raise RepairError(
            "only %d usable splats around the stroke; "
            "paint a smaller spot" % len(cand_idx))
    spacing = _local_spacing(xyz, cand_idx, rng)
    d_hole = d_sel[np.isfinite(d_sel)]
    band = max(params.rim_scale * 6.0 * spacing, 0.12 * width)
    rim_idx = cand_idx[d_hole < band]
    if len(rim_idx) < 30:
        rim_idx = cand_idx[np.argsort(d_hole)[:300]]
    return centre, radius, width, spacing, cand_idx, rim_idx


def _cells(u, v, cell, lo_u, lo_v, nu, nv):
    iu = np.floor((u - lo_u) / cell).astype(np.int64)
    iv = np.floor((v - lo_v) / cell).astype(np.int64)
    ok = (iu >= 0) & (iu < nu) & (iv >= 0) & (iv < nv)
    return iu, iv, ok


def _accum(vals, iv, iu, nv, nu):
    """Per-cell sum and count of ``vals`` (shape (N,) or (N, C))."""
    lin = iv * nu + iu
    s = np.zeros((nv * nu,) + vals.shape[1:])
    c = np.zeros(nv * nu)
    np.add.at(s, lin, vals)
    np.add.at(c, lin, 1.0)
    return s.reshape((nv, nu) + vals.shape[1:]), c.reshape(nv, nu)


def _cell_outliers(rgb, relief, iv, iu, nv, nu, known, nbh=7, k0=3.0, cap=3.0):
    """Per cell, how much of a one-off its worst splat is.

    A stitch in white leather is one or two dark splats in an otherwise
    white cell: the cell's mean hardly moves, so a cost on cell means never
    sees it, and the fill copied whole stitch rows into the middle of a
    heel. The worst splat does see it. Per splat, the distance of its
    brightness, and of its relief, from the mean of the 7x7 neighbourhood,
    in that neighbourhood's mean absolute deviation; per cell the worst
    splat, less ``k0``, clipped at ``cap``. The ridge and the trough of a
    tread are both ordinary in their neighbourhood and score nothing.
    """
    out = np.zeros((nv, nu))
    cnt = np.zeros((nv, nu))
    np.add.at(cnt, (iv, iu), 1.0)
    m = (cnt > 0).astype(np.float64)
    den = np.maximum(ndimage.uniform_filter(m, nbh), 1e-9)
    n_nb = np.maximum(ndimage.uniform_filter(cnt, nbh), 1e-9)
    for b in (np.asarray(rgb, np.float64).mean(1), np.asarray(relief, np.float64)):
        sm = np.zeros((nv, nu))
        np.add.at(sm, (iv, iu), b)
        mean = ndimage.uniform_filter(np.where(cnt > 0, sm / np.maximum(cnt, 1), 0.0) * m,
                                      nbh) / den
        dev = np.abs(b - mean[iv, iu])
        sa = np.zeros((nv, nu))
        np.add.at(sa, (iv, iu), dev)
        scale = np.maximum(ndimage.uniform_filter(sa, nbh) / n_nb, 1e-9)
        worst = np.zeros((nv, nu))
        np.maximum.at(worst, (iv, iu), dev)
        out = np.maximum(out, np.clip(worst / scale - k0, 0.0, cap))
    return np.where(known, out, 0.0)


def _cell_quantile(vals, iv, iu, nv, nu, q):
    """Per-cell quantile of a scalar, via sort-and-pick on the flattened index."""
    lin = iv * nu + iu
    order = np.lexsort((vals, lin))
    sl, sv = lin[order], vals[order]
    starts = np.searchsorted(sl, np.arange(nv * nu), "left")
    ends = np.searchsorted(sl, np.arange(nv * nu), "right")
    cnt = ends - starts
    out = np.full(nv * nu, np.nan)
    nz = cnt > 0
    pick = starts[nz] + np.minimum((cnt[nz] - 1), (cnt[nz] * q).astype(np.int64))
    out[nz] = sv[pick]
    return out.reshape(nv, nu), cnt.reshape(nv, nu)


def _outer_shell(h, lin, outward, gap_tol):
    """Keep only the outermost layer of each cell.

    A scanned shell puts its outside and inside in the same ``(u, v)`` cell,
    separated by the material's thickness. Walking each cell from the outside
    inwards and cutting at the first gap wider than ``gap_tol`` separates them
    without needing to know how thick the material is -- a fixed tolerance
    cannot, because real surface relief and shell thickness overlap in range.
    """
    key = -h if outward > 0 else h          # ascending key == outward first
    order = np.lexsort((key, lin))
    sl, sk = lin[order], key[order]
    new = np.ones(len(order), bool)
    new[1:] = sl[1:] != sl[:-1]
    gap = np.zeros(len(order), bool)
    gap[1:] = (~new[1:]) & ((sk[1:] - sk[:-1]) > gap_tol)
    cs = np.cumsum(gap)
    starts = np.flatnonzero(new)
    base = np.repeat(cs[starts] - gap[starts], np.diff(np.append(starts, len(order))))
    keep = np.zeros(len(order), bool)
    keep[order] = (cs - base) == 0
    return keep


def _fill_nearest(a, mask):
    """Replace values outside ``mask`` with the nearest value inside it."""
    bad = ~mask
    if not bad.any() or not mask.any():
        return np.nan_to_num(a)
    ind = ndimage.distance_transform_edt(bad, return_distances=False,
                                         return_indices=True)
    return np.nan_to_num(a[tuple(ind)])


# -------------------------------------------------------------------- main

def repair(s: SplatSet, selection, params: Optional[RepairParams] = None) -> RepairResult:
    """Remove ``selection`` and synthesise Gaussians to close the hole.

    ``selection`` is a boolean mask or an index array over ``s``.

    One height field over one tangent plane carries a hole on one surface.
    Painted over a logo on a shoe's heel, the hole wrapped round a curve of
    nearly ninety degrees, the plane through the rim fitted none of it, and
    every copy came from a patch facing elsewhere: it stood in the leather as
    a needle and the heel came back as fluff. So when the rim says that one
    plane cannot be right, the hole is cut in two charts and filled one after
    the other (`_repair_in_charts`).

    With a painted volume (``params.volume``) the hole is what was painted:
    the cells of the fitted surface inside it are filled whether or not a
    splat was there to select. Painted wholly over a hole in the scan, the
    selection may be empty; stand-ins along the stroke then size the fill
    and leave with it (see `_volume_standins`).
    """
    import dataclasses
    params = params or RepairParams()
    params.validate()
    vol = as_volume(getattr(params, "volume", None))
    if vol is None:
        return _repair_any(s, selection, params)
    params = dataclasses.replace(params, volume=vol)
    sel_mask = np.zeros(s.n, bool)
    sel_mask[selection] = True
    n0 = s.n
    if sel_mask.sum() < 30:
        st = _volume_standins(s, vol)
        if st is None and not sel_mask.any():
            raise RepairError("nothing selected")
        if st is not None:
            s = s.concat(st)
            sel_mask = np.concatenate([sel_mask, np.ones(st.n, bool)])
    res = _repair_any(s, np.where(sel_mask)[0], params)
    if s.n == n0:
        return res
    # the stand-ins were never in the scan
    rem = np.asarray(res.removed, np.int64)
    ctx = dict(res.context or {})
    if "chart_sel" in ctx:
        ctx["chart_sel"] = [np.asarray(c)[np.asarray(c) < n0] for c in ctx["chart_sel"]]
    info = dict(res.info)
    info["standins"] = int(s.n - n0)
    info["removed"] = int((rem < n0).sum())
    return RepairResult(removed=rem[rem < n0], added=res.added, backing=res.backing,
                        info=info, context=ctx)


def _repair_any(s: SplatSet, selection, params: RepairParams) -> RepairResult:
    """`repair` without the volume's preparation: one chart, two, or face by face,
    and over a fold the band along the edge copied along it (`_unfold_pass`)."""
    res = _repair_faces(s, selection, params)
    if getattr(params, "unfold", False):
        try:
            res = _unfold_pass(s, selection, params, res)
        except RepairError:
            pass
    if getattr(params, "close_gaps", False):
        res = _close_gaps(s, selection, params, res)
    return res


def _close_gaps(s: SplatSet, selection, params: RepairParams, res: RepairResult,
                lateral=2.0, depth=12.0, proud=3.0) -> RepairResult:
    """Put back, in the colour round them, painted splats on the surface that no
    fill covers.

    Over the sole's edge the bottom's fill stops at its own edge and the
    side's starts on the side, and the strip between them -- the rounded
    rim -- was left to neither: the soft inner layer of the sole showed
    through as pale flecks along the rim. A painted splat lying on one of
    the charts' surfaces (not more than ``proud`` spacings in front of it)
    with no new splat of the face within ``lateral`` spacings of it across
    the surface, ``depth`` along it, keeps its place, size and turn, and
    takes the colour of the scan and the fill round it (inverse distance,
    twelve nearest), without view-dependent bands. Where the fills cover
    the stroke, nothing changes.
    """
    ctx = res.context or {}
    charts = ctx.get("charts") or ([ctx] if "basis" in ctx else [])
    charts = [c for c in charts if "basis" in c and "surface" in c]
    if not charts or res.added.n == 0:
        return res
    sel_idx = np.asarray(selection, np.int64)
    if sel_idx.dtype == bool:
        sel_idx = np.where(sel_idx)[0]
    removed = np.zeros(s.n, bool)
    removed[np.asarray(res.removed, np.int64)] = True
    cand = sel_idx[removed[sel_idx] & (s.alpha[sel_idx] > 0.2)]
    if len(cand) == 0:
        return res
    xyz = s.xyz.astype(np.float64)
    sp = float(ctx.get("spacing") or charts[0].get("spacing") or 0.0)
    if sp <= 0:
        return res
    # the chart each candidate lies on: the one whose surface it is nearest
    P = xyz[cand]
    best_d = np.full(len(cand), np.inf)
    best_rel = np.zeros(len(cand))
    best_n = np.zeros((len(cand), 3))
    for c in charts:
        B = np.asarray(c["basis"], np.float64)
        uvh = (P - np.asarray(c["origin"], np.float64)) @ B.T
        cu0, cv0 = c.get("uv_centre", (0.0, 0.0))
        rel = (uvh[:, 2] - c["surface"](uvh[:, 0] - cu0, uvh[:, 1] - cv0)) * float(c.get("outward", 1.0))
        better = np.abs(rel) < best_d
        best_d = np.where(better, np.abs(rel), best_d)
        best_rel = np.where(better, rel, best_rel)
        best_n[better] = B[2]
    on = best_rel < proud * sp
    cand, P, best_n = cand[on], P[on], best_n[on]
    if len(cand) == 0:
        return res
    back = (np.asarray(res.backing, bool) if res.backing is not None
            and len(res.backing) == res.added.n else np.zeros(res.added.n, bool))
    FX = res.added.xyz[~back].astype(np.float64)
    if len(FX) == 0:
        return res
    tf = cKDTree(FX)
    covered = np.zeros(len(cand), bool)
    for k, L in enumerate(tf.query_ball_point(P, depth * sp)):
        if L:
            dv = FX[L] - P[k]
            along = dv @ best_n[k]
            lat = np.linalg.norm(dv - along[:, None] * best_n[k], axis=1)
            covered[k] = bool(np.any(lat < lateral * sp))
    gap = cand[~covered]
    if len(gap) < 8:
        return res
    keep = ~removed & (s.alpha > 0.2)
    keep[sel_idx] = False
    near = np.where(keep & np.all(np.abs(xyz - P.mean(0)) < np.ptp(P, 0) / 2 + 30 * sp, 1))[0]
    pool_xyz = np.vstack([xyz[near], FX])
    pool_dc = np.vstack([s.f_dc[near].astype(np.float64), res.added.f_dc[~back].astype(np.float64)])
    dd, ii = cKDTree(pool_xyz).query(xyz[gap], k=min(12, len(pool_xyz)))
    dd, ii = np.atleast_2d(dd), np.atleast_2d(ii)
    w = 1.0 / np.maximum(dd, sp) ** 2
    patch = s.take(gap)
    patch.f_dc = ((pool_dc[ii] * w[..., None]).sum(1) / w.sum(1, keepdims=True)).astype(patch.f_dc.dtype)
    patch.f_rest = np.zeros_like(patch.f_rest)
    out = res.added.concat(patch)
    ctx2 = dict(ctx)
    if "chart_spans" in ctx2:
        ctx2["chart_spans"] = list(ctx2["chart_spans"]) + [(res.added.n, out.n)]
    # The deep fill leaves them as they are, as it leaves the copies along an
    # edge: LaMa, seeing the pale layer round the rim, painted them pale again.
    fz = ctx2.get("unfold_frozen")
    fz = (np.asarray(fz, bool) if fz is not None and len(fz) == res.added.n
          else np.zeros(res.added.n, bool))
    ctx2["unfold_frozen"] = np.concatenate([fz, np.ones(patch.n, bool)])
    if ctx2.get("cell_key") is not None and len(ctx2["cell_key"]) == res.added.n:
        ctx2["cell_key"] = np.concatenate([np.asarray(ctx2["cell_key"]), np.full(patch.n, -1, np.int64)])
    info = dict(res.info or {})
    info.update({"added": int(out.n), "gaps_closed": int(patch.n)})
    return RepairResult(removed=res.removed, added=out,
                        backing=np.concatenate([back, np.zeros(patch.n, bool)]),
                        info=info, context=ctx2)


def _unfold_pass(s: SplatSet, selection, params: RepairParams, res: RepairResult) -> RepairResult:
    """Over a fold, refill the band along the edge by copying along the edge.

    Runs only where the fill itself hints at a fold: it went face by face,
    or its rim is folded by more than 30 degrees. The folds are
    unrolled (`unfold.fill_fold`); in each, the cells of the hole are refilled
    with whole rows copied from further along the edge, the face fill's
    splats there are dropped, and the layer under those cells goes, painted
    or not. The copies are marked ``unfold_frozen`` in the context and carried
    as a span of their own, so a deep fill later recolours the faces' fills
    but leaves the copies as they are: they are the scan, moved along the edge.
    """
    from . import unfold
    info = res.info or {}
    # a clean right-angled corner leaves a single chart with its rim folded
    # by only 45 degrees (sector planes straddle the edge), so the gate is low
    if int(info.get("charts", 1) or 1) < 2 and float(info.get("rim_fold_deg", 0.0) or 0.0) <= 30.0:
        return res
    sel_mask = np.zeros(s.n, bool)
    sel_mask[selection] = True
    xyz = s.xyz.astype(np.float64)
    band = _rim_band(xyz, sel_mask, s.alpha, params, np.random.default_rng(params.seed))
    folds = unfold.find_folds(s, sel_mask, params, band)
    if not folds:
        return res
    vol = as_volume(getattr(params, "volume", None))
    added = res.added
    keep_add = np.ones(added.n, bool)
    removed = np.zeros(s.n, bool)
    removed[np.asarray(res.removed, np.int64)] = True
    copies, uinfo = [], []
    for fold in folds:
        got = unfold.fill_fold(s, sel_mask, params, band, fold, vol=vol)
        if got is None:
            continue
        keep_add &= ~got["covers"](added.xyz.astype(np.float64))
        copies = [c.take(np.where(~got["covers"](c.xyz.astype(np.float64)))[0]) for c in copies]
        removed[got["removed"]] = True
        copies.append(got["added"])
        uinfo.append(got["info"])
    if not copies:
        return res
    back0 = (np.asarray(res.backing, bool) if res.backing is not None and len(res.backing) == added.n
             else None)
    keep_add = _drop_bare_backing(keep_add, back0, (res.context or {}).get("cell_key"))
    kept = added.take(np.where(keep_add)[0])
    extra = copies[0]
    for c in copies[1:]:
        extra = extra.concat(c)
    out = kept.concat(extra)
    back = (np.asarray(res.backing, bool) if res.backing is not None and len(res.backing) == added.n
            else np.zeros(added.n, bool))
    backing = np.concatenate([back[keep_add], np.zeros(extra.n, bool)])
    ctx = dict(res.context or {})
    pos = np.concatenate([[0], np.cumsum(keep_add)])
    if "chart_spans" in ctx:
        ctx["chart_spans"] = [(int(pos[a]), int(pos[b])) for a, b in ctx["chart_spans"]] + \
            [(kept.n, out.n)]
    frozen = np.zeros(out.n, bool)
    frozen[kept.n:] = True
    ctx["unfold_frozen"] = frozen
    if ctx.get("cell_key") is not None and len(ctx["cell_key"]) == added.n:
        ctx["cell_key"] = np.concatenate([np.asarray(ctx["cell_key"])[keep_add],
                                          np.full(extra.n, -1, np.int64)])
    out_info = dict(info)
    out_info.update({"added": int(out.n), "removed": int(removed.sum()),
                     "unfold": uinfo if len(uinfo) > 1 else uinfo[0],
                     "unfold_dropped": int((~keep_add).sum())})
    return RepairResult(removed=np.where(removed)[0], added=out, backing=backing,
                        info=out_info, context=ctx)


def _repair_faces(s: SplatSet, selection, params: RepairParams) -> RepairResult:
    """One chart, two, or face by face."""
    if params.charts:
        sel_mask = np.zeros(s.n, bool)
        sel_mask[selection] = True
        if sel_mask.any():
            split, pre = _chart_split(s, sel_mask, params)
            if split is not None:
                try:
                    return _repair_in_charts(s, *split, params)
                except RepairError:
                    pass                  # one chart is better than none
            else:
                try:
                    res = _repair_chart(s, selection, params, pre=pre)
                except NothingToFill:
                    raise
                except RepairError as e:
                    # The one chart gave up -- its edge rule left nothing of
                    # the hole, say -- on a rim folded past the warning: the
                    # stroke spans two faces, so try them one by one before
                    # giving up on the stroke.
                    if getattr(e, "rim_fold", 0.0) <= params.fold_warn_deg:
                        raise
                    try:
                        faces = _repair_across_faces(s, sel_mask, params)
                    except RepairError:
                        faces = None
                    if faces is None:
                        raise e
                    return faces
                # Painted across a fold the one chart cannot hold both faces,
                # and it says so: its edge rule cuts the stroke's middle out
                # (the autotest stroke over the sole's edge lost half its
                # cells, and the inside of the shoe showed through as dark
                # blotches), or its copies sit far off the one height field
                # and are clamped. Then the stroke is filled face by face.
                if _runs_off_face(res.info, params):
                    try:
                        faces = _repair_across_faces(s, sel_mask, params)
                    except RepairError:
                        faces = None
                    if faces is not None:
                        return faces
                return res
    return _repair_chart(s, selection, params)


def _chart_split(s, sel_mask, params, fold_split=70.0, min_share=0.15, agree_deg=35.0):
    """``(split, pre)``: two masks and the fold, or None for one surface.

    ``pre`` is the rim band and the random state after it, so that a single
    chart does not compute the band a second time (0.45 s on the stand) and
    comes out exactly as it would have on its own.

    Two tests, because a scan's tread makes single normals wander on a
    perfectly flat sole (up to half of them 45 degrees off on the hold-out
    discs): the rim must be folded by sector planes, and nearly all of the
    rim's local normals must stand far off the plane through it -- 93 percent
    on the heel against at most 70 on the sole, the stand's hole included.
    The painted splats then go with the rim group they are nearest to.
    """
    rng = np.random.default_rng(params.seed)
    xyz = s.xyz.astype(np.float64)
    alpha = s.alpha
    try:
        band = _rim_band(xyz, sel_mask, alpha, params, rng)
    except RepairError:
        return None, None
    pre = (band, rng)
    centre, radius, width, spacing, cand_idx, rim_idx = band
    try:
        origin, basis, _ = fit_tangent_frame(xyz[rim_idx], w=alpha[rim_idx])
    except RepairError:
        return None, pre
    rng = np.random.default_rng(params.seed + 1)      # leave ``pre``'s state alone
    uv_r = (xyz[rim_idx] - xyz[sel_mask].mean(0)) @ basis[:2].T
    sec = (((np.arctan2(uv_r[:, 1], uv_r[:, 0]) + np.pi) / (2 * np.pi) * 8)
           .astype(np.int64) % 8)
    sec_n = {}
    for j in range(8):
        P = xyz[rim_idx[sec == j]]
        if len(P) >= 60:
            X = P - P.mean(0)
            sec_n[j] = np.linalg.eigh(X.T @ X)[1][:, 0]
    if len(sec_n) < 3:
        return None, pre
    if max(np.degrees(np.arccos(min(abs(n @ basis[2]), 1.0))) for n in sec_n.values()) < fold_split:
        return None, pre
    # the rim's own normals against the plane
    near = np.linalg.norm(xyz - centre, axis=1) < 3.0 * radius + 12.0 * spacing
    opq = xyz[near & (alpha > 0.5)]
    if len(opq) < 50:
        return None, pre
    tree = cKDTree(opq)
    pick = rim_idx[rng.choice(len(rim_idx), min(400, len(rim_idx)), replace=False)]
    off = []
    for q in xyz[pick]:
        nb = tree.query_ball_point(q, 6.0 * spacing)
        if len(nb) >= 8:
            X = opq[nb] - opq[nb].mean(0)
            n = np.linalg.eigh(X.T @ X)[1][:, 0]
            off.append(abs(n @ basis[2]) < np.cos(np.radians(45.0)))
    if not off or np.mean(off) < params.chart_misfit:
        return None, pre
    # the largest group of rim sectors that agree, by rim splats
    cos_t = np.cos(np.radians(agree_deg))
    count = {j: int(np.sum(sec == j)) for j in sec_n}
    best, best_w = None, 0
    for n in sec_n.values():
        group = [k for k, m in sec_n.items() if abs(m @ n) >= cos_t]
        wsum = sum(count[k] for k in group)
        if wsum > best_w:
            best, best_w = group, wsum
    if best is None or len(best) == len(sec_n):
        return None, pre
    lab = np.isin(sec, best)
    sel_idx = np.where(sel_mask)[0]
    _, nearest = cKDTree(xyz[rim_idx]).query(xyz[sel_idx], k=8)
    vote = lab[nearest].mean(1)
    A = np.zeros(s.n, bool)
    B = np.zeros(s.n, bool)
    A[sel_idx[vote >= 0.5]] = True
    B[sel_idx[vote < 0.5]] = True
    if min(A.sum(), B.sum()) < min_share * len(sel_idx):
        return None, pre
    fold = max(np.degrees(np.arccos(min(abs(sec_n[k] @ sec_n[best[0]]), 1.0)))
               for k in sec_n if k not in best)
    return (A, B, float(fold)), pre


def _repair_in_charts(s, A, B, fold, params):
    """Fill chart ``A`` with ``B`` taken out, then ``B`` with the first fill as rim.

    ``B``'s splats are out of the first pass so that they cannot be copied --
    on the heel they were the logo -- and back in for the second, where they
    mark its hole. The two passes are returned as one result over ``s``.
    """
    keep_a = np.where(~B)[0]
    s_a = s.take(keep_a)
    r_a = _repair_chart(s_a, np.where(A[keep_a])[0], params)
    gone_a = np.zeros(s_a.n, bool)
    gone_a[r_a.removed] = True
    kept_a = np.where(~gone_a)[0]
    n_k, n_a = len(kept_a), r_a.added.n
    s_b = s_a.take(kept_a).concat(r_a.added).concat(s.take(np.where(B)[0]))
    r_b = _repair_chart(s_b, np.arange(n_k + n_a, s_b.n), params)
    removed = A | B
    removed[keep_a[r_a.removed]] = True
    rb = np.asarray(r_b.removed)
    removed[keep_a[kept_a[rb[rb < n_k]]]] = True
    keep_add = np.ones(n_a, bool)
    keep_add[rb[(rb >= n_k) & (rb < n_k + n_a)] - n_k] = False
    added = r_a.added.take(np.where(keep_add)[0]).concat(r_b.added)
    backing = None
    if r_a.backing is not None and r_b.backing is not None:
        backing = np.concatenate([np.asarray(r_a.backing)[keep_add], np.asarray(r_b.backing)])
    first = r_a.info.get("target_cells", 0) >= r_b.info.get("target_cells", 0)
    info = dict(r_a.info if first else r_b.info)
    info.update({"charts": 2, "chart_fold_deg": round(fold, 1),
                 "chart_split": [int(A.sum()), int(B.sum())],
                 "added": int(added.n), "removed": int(removed.sum()),
                 "brushed": int((A | B).sum()), "warning": None})
    return RepairResult(removed=np.where(removed)[0], added=added, backing=backing,
                        info=info, context=dict((r_a if first else r_b).context))


# ------------------------------------------------------- faces of a fold

def _runs_off_face(info, params) -> bool:
    """Whether a single chart's own numbers say the stroke spans two faces."""
    if not info or info.get("rim_fold_deg", 0.0) <= params.fold_warn_deg:
        return False
    face = max(int(info.get("added", 0)) - int(info.get("backing", 0) or 0), 1)
    beyond = info.get("beyond_edge", 0) / max(int(info.get("target_cells", 0)), 1)
    clamped = info.get("relief_clamped", 0) / face
    return beyond > 0.05 or clamped > 0.08


def _cube_normals(P, L):
    """Per cube of side ``L``: key, member index, count, mean, normal, flatness."""
    key = np.floor(P / L).astype(np.int64)
    uk, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()
    n = len(uk)
    S1 = np.zeros((n, 3))
    np.add.at(S1, inv, P)
    S2 = np.zeros((n, 3, 3))
    np.add.at(S2, inv, P[:, :, None] * P[:, None, :])
    mean = S1 / cnt[:, None]
    C = S2 / cnt[:, None, None] - mean[:, :, None] * mean[:, None, :]
    w, V = np.linalg.eigh(C)
    flat = w[:, 0] / np.maximum(w[:, 1], 1e-18)
    return uk, inv, cnt, mean, V[:, :, 0], flat


def _smoothed_normals(mean, nrm, cnt, flat, L, smooth=2.5, min_cnt=8):
    """Orientation tensors averaged over ``smooth`` cubes: keeps a fold, drops grain.

    A cube's own normal is noise on a tread or on lap siding -- on the hut's
    wall the boards' tilt split one wall into three. Averaged over two and a
    half cubes the wall is one and the corner still two.
    """
    T = (nrm[:, :, None] * nrm[:, None, :]) * (cnt * (flat < 0.5) * (cnt >= min_cnt))[:, None, None]
    nb = cKDTree(mean).query_ball_point(mean, smooth * L)
    Ts = np.array([T[j].sum(0) for j in nb])
    w, V = np.linalg.eigh(Ts)
    return V[:, :, 2], w[:, 2] > 0


def _cube_components(uk, members):
    """Connected pieces (26-neighbourhood) of the cubes in ``members``."""
    index = {tuple(uk[i]): i for i in members}
    comp = {}
    c = 0
    for i in members:
        if i in comp:
            continue
        comp[i] = c
        st = [i]
        while st:
            a = st.pop()
            k = uk[a]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        j = index.get((k[0] + dx, k[1] + dy, k[2] + dz))
                        if j is not None and j not in comp:
                            comp[j] = c
                            st.append(j)
        c += 1
    out = [[] for _ in range(c)]
    for i, cc in comp.items():
        out[cc].append(i)
    return [np.asarray(m, np.int64) for m in out]


def _faces_of_stroke(s, sel_mask, params, mode_deg=20.0, sep_deg=35.0,
                     merge_deg=40.0, fold_deg=45.0, min_sel=0.04, min_rim=0.03,
                     min_after=0.08):
    """The faces a stroke covers: ``(masks, normals, field)``, biggest first, or None.

    The stroke and its rim are cut in cubes a quarter of the stroke's width;
    their smoothed normals give the dominant orientations, picked greedily by
    support, and each orientation falls apart into connected pieces. Pieces
    that touch and nearly agree are one face. A face counts if it holds a
    share of the stroke, has rim of its own -- a box standing on the sole
    has sides facing the way the wall does, but no surface goes on from them
    -- and stands at least ``fold_deg`` off every face already counted. Each
    painted splat then goes to the face it lies on (`_assign_to_faces`).
    """
    xyz = s.xyz.astype(np.float64)
    alpha = s.alpha
    band = _rim_band(xyz, sel_mask, alpha, params, np.random.default_rng(params.seed))
    _, _, width, spacing, _, rim_idx = band
    sel_idx = np.where(sel_mask)[0]
    L = float(np.clip(0.25 * width, 8 * spacing, 0.5 * width))
    so = sel_idx[alpha[sel_idx] > 0.5]
    ro = rim_idx[alpha[rim_idx] > 0.5]
    if len(so) + len(ro) < 100:
        return None
    uk, _, cnt, mean, nrm, flat = _cube_normals(xyz[np.concatenate([so, ro])], L)
    sn, _ = _smoothed_normals(mean, nrm, cnt, flat, L, min_cnt=0)
    wt = cnt * (cnt >= 8)
    cos_m, cos_s = np.cos(np.radians(mode_deg)), np.cos(np.radians(sep_deg))
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
        m = np.linalg.eigh(M)[1][:, 2]
        modes.append(m)
        free &= np.abs(sn @ m) < cos_s
    if len(modes) < 2:
        return None
    modes = np.array(modes)
    cube_mode = np.argmax(np.abs(sn @ modes.T), 1)
    tree_c = cKDTree(mean)
    sel_cube = tree_c.query(xyz[sel_idx])[1]
    rim_cube = tree_c.query(xyz[rim_idx])[1]
    pieces = []
    for k in range(len(modes)):
        for mem in _cube_components(uk, list(np.where(cube_mode == k)[0])):
            inp = np.zeros(len(uk), bool)
            inp[mem] = True
            pieces.append(dict(n=modes[k], mem=mem, cube=inp,
                               sel=int(inp[sel_cube].sum()), rim=int(inp[rim_cube].sum())))
    pieces.sort(key=lambda p: -p["sel"])
    cos_g = np.cos(np.radians(merge_deg))
    faces = []
    for p in pieces:
        tree_p = cKDTree(mean[p["mem"]])
        hit = None
        for f in faces:
            if (abs(p["n"] @ f["n"]) >= cos_g and
                    np.isfinite(tree_p.query(mean[f["mem"]], distance_upper_bound=1.8 * L)[0]).any()):
                hit = f
                break
        if hit is None:
            faces.append(dict(p, mem=p["mem"].copy(), cube=p["cube"].copy()))
        else:
            w0, w1 = hit["sel"] + hit["rim"], p["sel"] + p["rim"]
            nn = hit["n"] * w0 + np.sign(p["n"] @ hit["n"]) * p["n"] * w1
            hit.update(n=nn / np.linalg.norm(nn), sel=hit["sel"] + p["sel"],
                       rim=hit["rim"] + p["rim"], mem=np.concatenate([hit["mem"], p["mem"]]),
                       cube=hit["cube"] | p["cube"])
    faces.sort(key=lambda f: -f["sel"])
    n_sel, n_rim = len(sel_idx), len(rim_idx)
    keep = [faces[0]]
    for f in faces[1:]:
        ang = min(np.degrees(np.arccos(min(abs(f["n"] @ q["n"]), 1.0))) for q in keep)
        if f["sel"] >= min_sel * n_sel and f["rim"] >= max(40, min_rim * n_rim) and ang >= fold_deg:
            keep.append(f)
    if len(keep) < 2:
        return None
    # a face left with too little of the stroke goes, the rest is assigned again
    while True:
        lab = _assign_to_faces(xyz, alpha, sel_idx, rim_idx, rim_cube, keep)
        cnt_f = [int((lab == k).sum()) for k in range(len(keep))]
        k_min = int(np.argmin(cnt_f))
        if cnt_f[k_min] >= min_after * n_sel:
            break
        keep.pop(k_min)
        if len(keep) < 2:
            return None
    masks, normals = [], []
    for k in np.argsort(cnt_f)[::-1]:
        m = np.zeros(s.n, bool)
        m[sel_idx[lab == k]] = True
        masks.append(m)
        normals.append(keep[k]["n"] / np.linalg.norm(keep[k]["n"]))
    return masks, normals, (mean, sn)


def _assign_to_faces(xyz, alpha, sel_idx, rim_idx, rim_cube, faces):
    """Each painted splat to the face it lies on.

    A face is a quadratic over its plane through its own rim. A splat costs
    its distance from that surface along the face's normal, plus how far
    outside the rim's extent it falls. A box standing on the sole is next to
    the sole and far from the wall, though its sides face the way the wall
    does -- given to the wall, the sole's footprint kept the box's gaps and
    the inside of the shoe showed through them.
    """
    from scipy.spatial import Delaunay
    X = xyz[sel_idx]
    cost = np.zeros((len(sel_idx), len(faces)))
    for k, f in enumerate(faces):
        pts = rim_idx[f["cube"][rim_cube] & (alpha[rim_idx] > 0.5)]
        n = f["n"] / np.linalg.norm(f["n"])
        if len(pts) < 10:
            cost[:, k] = np.inf
            continue
        a = np.cross(n, [1.0, 0, 0] if abs(n[0]) < 0.9 else [0, 1.0, 0])
        a /= np.linalg.norm(a)
        B = np.stack([a, np.cross(n, a), n])
        o = xyz[pts].mean(0)
        uvh = (xyz[pts] - o) @ B.T
        hf = fit_height_field(uvh[:, 0], uvh[:, 1], uvh[:, 2], deg=2, stiffness=0.05)
        q = (X - o) @ B.T
        dh = np.abs(q[:, 2] - hf(q[:, 0], q[:, 1]))
        d_uv = cKDTree(uvh[:, :2]).query(q[:, :2])[0]
        try:
            out = Delaunay(uvh[:, :2]).find_simplex(q[:, :2]) < 0
        except Exception:                      # noqa: BLE001 - degenerate rim
            out = np.ones(len(q), bool)
        cost[:, k] = dh + np.where(out, d_uv, 0.0)
    return np.argmin(cost, 1)


def _face_inside(xyz, sel_mask, cand_idx, n, spacing):
    """Which way along ``n`` the inside lies: what is left behind the painted face."""
    cell = 2.0 * spacing
    a = np.cross(n, [1.0, 0, 0] if abs(n[0]) < 0.9 else [0, 1.0, 0])
    a /= np.linalg.norm(a)
    b = np.cross(n, a)
    S, Q = xyz[sel_mask], xyz[cand_idx]
    ks = np.floor(S @ a / cell).astype(np.int64) * 1000003 + np.floor(S @ b / cell).astype(np.int64)
    kq = np.floor(Q @ a / cell).astype(np.int64) * 1000003 + np.floor(Q @ b / cell).astype(np.int64)
    behind = np.isin(kq, ks)
    if behind.sum() >= 50:
        d = Q[behind] @ n - float(np.median(S @ n))
        far = np.abs(d) > 4.0 * spacing
        if far.sum() >= 30:
            return n if np.median(d[far]) > 0 else -n
    return n if (xyz.mean(0) - S.mean(0)) @ n > 0 else -n


def _face_pre(cloud, sel_mask, params, normal, field, rim_deg=35.0, cand_deg=50.0):
    """The rim band of one face, kept to that face: ``(pre, ballast, inside)``.

    The rim, so that the face's plane is fitted to the face. The candidates,
    so that the other face -- seen edge-on, it is "surface" at the wrong
    depth, and its copies came out clamped and hung a curtain into the shoe
    -- and the inside seen through the hole are not taken for surface. That
    takes most of what told `_repair_chart` which side is outside, so ballast
    goes behind the face, deep enough for the outer-shell cut to drop it,
    enough of it to carry the vote (where the painting camera does not
    decide it: a wall seen edge-on).
    """
    xyz = cloud.xyz.astype(np.float64)
    alpha = cloud.alpha
    rng = np.random.default_rng(params.seed)
    centre, radius, width, spacing, cand_idx, rim_idx = _rim_band(xyz, sel_mask, alpha, params, rng)
    cm, cn = field
    dots = np.abs(cn[cKDTree(cm).query(xyz[rim_idx])[1]] @ normal)
    agree = dots >= np.cos(np.radians(rim_deg))
    least = int(min(len(rim_idx), max(60, 0.25 * len(rim_idx))))
    more = None
    if agree.sum() < least:
        # Too little of the rim lies on this face. At the hut's corner the
        # second wall is a strip beside the corner board: 342 of 1821 rim
        # splats are on it, in a thin line, and topping that up with the
        # rim splats that came closest put a third of the other wall in --
        # the plane through both was the other wall's. So first take the
        # face's own surface from further out, nearest the stroke first
        # (from the band's candidates, which reach three half-widths).
        on_face = np.setdiff1d(cand_idx, rim_idx)
        if len(on_face):
            on_face = on_face[np.abs(cn[cKDTree(cm).query(xyz[on_face])[1]] @ normal)
                              >= np.cos(np.radians(rim_deg))]
        need_ = least - int(agree.sum())
        if len(on_face) >= need_:
            d_ = cKDTree(xyz[sel_mask]).query(xyz[on_face])[0]
            more = on_face[np.argsort(d_, kind="stable")[:need_]]
        else:
            agree = np.zeros(len(rim_idx), bool)
            agree[np.argsort(-dots)[:least]] = True
    rim_idx = rim_idx[agree]
    if more is not None:
        rim_idx = np.concatenate([rim_idx, more])
    inside = _face_inside(xyz, sel_mask, cand_idx, normal, spacing)
    # the face's own candidates
    Lc = max(0.25 * width, 8 * spacing)
    P = np.vstack([xyz[cand_idx], xyz[sel_mask]])
    P = P[np.concatenate([alpha[cand_idx], alpha[sel_mask]]) > 0.5]
    if len(P) > 120000:
        P = P[np.random.default_rng(params.seed + 2).choice(len(P), 120000, replace=False)]
    uk, _, cnt, mean, nrm, flat = _cube_normals(P, Lc)
    sn, ok = _smoothed_normals(mean, nrm, cnt, flat, Lc, smooth=1.5)
    keep = np.abs(sn[ok][cKDTree(mean[ok]).query(xyz[cand_idx])[1]] @ normal) >= np.cos(np.radians(cand_deg))
    keep |= np.isin(cand_idx, rim_idx)
    cand_idx = cand_idx[keep]
    # nothing behind the painted face
    a = np.cross(normal, [1.0, 0, 0] if abs(normal[0]) < 0.9 else [0, 1.0, 0])
    a /= np.linalg.norm(a)
    b = np.cross(normal, a)
    cell = 2.0 * spacing
    S, Q = xyz[sel_mask], xyz[cand_idx]
    ks = np.floor(S @ a / cell).astype(np.int64) * 1000003 + np.floor(S @ b / cell).astype(np.int64)
    kq = np.floor(Q @ a / cell).astype(np.int64) * 1000003 + np.floor(Q @ b / cell).astype(np.int64)
    out_s = -(S @ inside)                       # larger is further out
    order = np.argsort(ks)
    uniq, start = np.unique(ks[order], return_index=True)
    top = np.maximum.reduceat(out_s[order], start)
    pos = np.clip(np.searchsorted(uniq, kq), 0, len(uniq) - 1)
    behind = (uniq[pos] == kq) & (top[pos] + Q @ inside > 4.0 * spacing)
    cand_idx = cand_idx[~(behind & ~np.isin(cand_idx, rim_idx))]
    # ballast, counted the way _repair_chart counts
    ballast = None
    o_, B_, inl_ = fit_tangent_frame(xyz[rim_idx], w=alpha[rim_idx])
    b2 = B_[2]
    rim_h = float(np.median((xyz[rim_idx[inl_]] - o_) @ b2))
    h_c = (xyz[cand_idx] - o_) @ b2
    m_ = 3.0 * spacing
    n_in = int(np.sum(h_c < rim_h - m_)) if inside @ b2 < 0 else int(np.sum(h_c > rim_h + m_))
    need = int(np.ceil((0.7 * len(cand_idx) - n_in) / 0.3)) if len(cand_idx) else 0
    if need > 0 and len(rim_idx):
        pick = rim_idx[np.arange(need) % len(rim_idx)]
        ballast = cloud.take(pick)
        ballast.xyz = (xyz[pick] + inside * 30.0 * spacing).astype(ballast.xyz.dtype)
        cand_idx = np.concatenate([cand_idx, cloud.n + np.arange(need)])
    return ((centre, radius, width, spacing, cand_idx, rim_idx), rng, normal), ballast, inside


def _close_footprint(cloud, sel, normal):
    """Stand-ins for the gaps of a face's footprint, appended as painted.

    Under the stand the sole was never scanned, and the box's sparse top
    leaves cells with no painted splat in them. A hole the rim encloses is
    filled whole anyway; one that runs off its face across a fold is not
    enclosed, only its painted cells were filled, and the gaps stayed open
    onto the inside of the shoe. The stand-ins are removed with the rest.
    """
    P = cloud.xyz[sel].astype(np.float64)
    if len(P) < 50:
        return cloud, sel
    n = normal / np.linalg.norm(normal)
    a = np.cross(n, [1.0, 0, 0] if abs(n[0]) < 0.9 else [0, 1.0, 0])
    a /= np.linalg.norm(a)
    b = np.cross(n, a)
    sp = float(np.median(cKDTree(P).query(P[:: max(1, len(P) // 2000)], k=2)[0][:, 1]))
    cell = 2.0 * max(sp, 1e-9)
    u, v, h = P @ a, P @ b, P @ n
    iu = np.floor((u - u.min()) / cell).astype(np.int64) + 2
    iv = np.floor((v - v.min()) / cell).astype(np.int64) + 2
    nu, nv = iu.max() + 3, iv.max() + 3
    if nu * nv > 4_000_000:
        return cloud, sel
    occ = np.zeros((nv, nu), bool)
    occ[iv, iu] = True
    closed = ndimage.binary_closing(np.pad(occ, 4), np.ones((3, 3)), iterations=3)[4:-4, 4:-4]
    gaps = ndimage.binary_fill_holes(closed) & ~occ
    if not gaps.any():
        return cloud, sel
    gy, gx = np.where(gaps)
    gu = u.min() + (gx - 2 + 0.5) * cell
    gv = v.min() + (gy - 2 + 0.5) * cell
    j = cKDTree(np.stack([u, v], 1)).query(np.stack([gu, gv], 1), k=8)[1]
    gh = np.median(h[j], 1)
    dummy = cloud.take(np.where(sel)[0][j[:, 0]])
    dummy.xyz = (gu[:, None] * a + gv[:, None] * b + gh[:, None] * n).astype(dummy.xyz.dtype)
    return cloud.concat(dummy), np.concatenate([sel, np.ones(dummy.n, bool)])


def _repair_across_faces(s, sel_mask, params):
    """Fill a stroke over a fold face by face; None if it is one face.

    The biggest face first, the others out of it; each later face with the
    earlier fills in place. Each pass is a chart of its own (`_face_pre`,
    `_close_footprint`), and the edge rule leaves its footprint whole. A pass
    whose plane came out on another face, or on the wrong side of its own,
    makes the whole split fail -- one chart is better than that.
    """
    got = _faces_of_stroke(s, sel_mask, params)
    if got is None:
        return None
    masks, normals, (cube_m, cube_n) = got
    gone = np.zeros(s.n, bool)
    added, alive, backs, infos, ctxs = [], [], [], [], []
    later = np.zeros(s.n, bool)
    for m in masks[1:]:
        later |= m
    view = getattr(params, "view", None)
    for k, (m, nrm) in enumerate(zip(masks, normals)):
        later &= ~m
        keep_o = np.where(~gone & ~later)[0]
        cloud = s.take(keep_o)
        add_map = []
        for a, al in zip(added, alive):
            ii = np.where(al)[0]
            cloud = cloud.concat(a.take(ii))
            add_map.append(ii)
        sel = np.zeros(cloud.n, bool)
        sel[:len(keep_o)] = m[keep_o]
        cloud, sel = _close_footprint(cloud, sel, nrm)
        fm, fn = [cube_m], [cube_n]
        for a, al, nn in zip(added, alive, normals[:k]):
            pts = a.xyz[al].astype(np.float64)
            if len(pts):
                pts = pts[:: max(1, len(pts) // 400)]
                fm.append(pts)
                fn.append(np.repeat(nn[None], len(pts), 0))
        pre, ballast, inside = _face_pre(cloud, sel, params, nrm, (np.vstack(fm), np.vstack(fn)))
        if ballast is not None:
            cloud = cloud.concat(ballast)
            sel = np.concatenate([sel, np.zeros(ballast.n, bool)])
        r = _repair_chart(cloud, np.where(sel)[0], params, pre=pre, keep_foot=True)
        out = r.context["basis"][2] * r.context["outward"]
        by_view = (view is not None and len(view) == 3 and
                   abs(float(np.dot(r.context["basis"][2], view)))
                   > 0.2 * max(float(np.linalg.norm(view)), 1e-12))
        if abs(out @ nrm) < np.cos(np.radians(35.0)) or (out @ inside > 0 and not by_view):
            raise RepairError("face %d: plane beside the face" % k)
        rem = np.asarray(r.removed)
        gone[keep_o[rem[rem < len(keep_o)]]] = True
        off = len(keep_o)
        for a_i, ii in enumerate(add_map):
            hit = rem[(rem >= off) & (rem < off + len(ii))] - off
            alive[a_i][ii[hit]] = False
            off += len(ii)
        added.append(r.added)
        alive.append(np.ones(r.added.n, bool))
        backs.append(np.asarray(r.backing, bool) if r.backing is not None
                     and len(r.backing) == r.added.n else np.zeros(r.added.n, bool))
        infos.append(r.info)
        ctxs.append(r.context)
    removed = gone
    for m in masks:
        removed |= m
    parts, back, spans, keys, start = [], [], [], [], 0
    for k, (a, al, b, cx_) in enumerate(zip(added, alive, backs, ctxs)):
        key = cx_.get("cell_key")
        key = None if key is None else np.asarray(key, np.int64) + (np.int64(k) << 40)
        al = _drop_bare_backing(al, b, key)
        t = a.take(np.where(al)[0])
        parts.append(t)
        back.append(b[al])
        keys.append(np.full(t.n, -1, np.int64) if key is None else key[al])
        spans.append((start, start + t.n))
        start += t.n
    out_add = parts[0]
    for t in parts[1:]:
        out_add = out_add.concat(t)
    first = int(np.argmax([i.get("target_cells", 0) for i in infos]))
    info = dict(infos[first])
    fold = max(float(np.degrees(np.arccos(min(abs(n @ normals[0]), 1.0)))) for n in normals[1:])
    info.update({"charts": len(masks), "chart_fold_deg": round(fold, 1),
                 "chart_split": [int(m.sum()) for m in masks],
                 "added": int(out_add.n), "removed": int(removed.sum()),
                 "brushed": int(sel_mask.sum()), "warning": None,
                 "per_face": [{k: i.get(k) for k in ("target_cells", "added", "donor_offset",
                                                     "donor_score", "donor_shifts", "motif")}
                              for i in infos]})
    ctx = dict(ctxs[first])
    ctx.update({"charts": [dict(c) for c in ctxs], "chart_spans": spans,
                "chart_sel": [np.where(m)[0] for m in masks],
                "cell_key": np.concatenate(keys)})
    return RepairResult(removed=np.where(removed)[0], added=out_add,
                        backing=np.concatenate(back), info=info, context=ctx)


def _repair_chart(s: SplatSet, selection, params: RepairParams, pre=None,
                  keep_foot: bool = False) -> RepairResult:
    """One chart: the whole of the fill over one tangent frame.

    Every factorisation this chart prefetches is consumed inside it, or not
    at all -- a fill that found no donor never builds its zones, one that
    raises stops anywhere. Whatever is left is dropped on the way out: on a
    large grid a single left-over factorisation held about 1.5 GB until the
    next repair. (The face-by-face path calls this once per face; each call
    starts and ends with an empty cache.)
    """
    _LU_CACHE.clear()
    try:
        return _repair_chart_body(s, selection, params, pre, keep_foot)
    finally:
        _LU_CACHE.clear()


def _repair_chart_body(s, selection, params, pre, keep_foot):
    rng = np.random.default_rng(params.seed)

    sel_mask = np.zeros(s.n, bool)
    sel_mask[selection] = True
    if not sel_mask.any():
        raise RepairError("nothing selected")

    xyz = s.xyz.astype(np.float64)
    alpha = s.alpha
    face_n = None
    if pre is not None:
        (centre, radius, width, spacing, cand_idx, rim_idx), rng = pre[:2]
        face_n = pre[2] if len(pre) > 2 else None
    else:
        centre, radius, width, spacing, cand_idx, rim_idx = _rim_band(
            xyz, sel_mask, alpha, params, rng)

    origin, basis, inl = fit_tangent_frame(xyz[rim_idx], w=alpha[rim_idx])
    if face_n is not None and abs(float(basis[2] @ face_n)) < np.cos(np.radians(35.0)):
        # One face of a fold whose rim is mostly the other face: the hut's
        # second wall is a strip beside the corner board, its rim the board
        # and the first wall, and the plane through that rim was the first
        # wall's. The face's own orientation, from `_faces_of_stroke`, holds.
        origin, basis, inl = _frame_along(xyz[rim_idx], alpha[rim_idx], face_n)
    # Whether the rim is one surface at all. Painted across a fold -- the
    # edge of a sole, a floor meeting a wall -- it is not, and one height
    # field cannot carry both: measured, a third of the side wall went
    # unrebuilt and part of the fill went through the wall. One chart cannot
    # fix that, so it is said out loud instead.
    #
    # Judged per sector of the rim, one plane each, because single splats'
    # normals on a real scan are useless for this -- on the shoe's tread the
    # local normal strays up to 80 degrees on a perfectly ordinary surface.
    # A sector's few hundred splats average the tread out. Measured: a floor
    # meeting a wall, 76 to 80 degrees between sectors; the sole, up to 65 on
    # the band where it really does wrap round the edge, 64 on small noisy
    # rims. Hence a warning at 70, and never a refusal.
    uv_r = (xyz[rim_idx] - xyz[sel_mask].mean(0)) @ basis[:2].T
    sec = (((np.arctan2(uv_r[:, 1], uv_r[:, 0]) + np.pi) / (2 * np.pi) * 8)
           .astype(np.int64) % 8)
    sec_n = {}
    for j in range(8):
        P = xyz[rim_idx[sec == j]]
        if len(P) < 60:
            continue
        Xs = P - P.mean(0)
        sec_n[j] = np.linalg.eigh(Xs.T @ Xs)[1][:, 0]

    def fold_against(n):
        return max([float(np.degrees(np.arccos(min(abs(m @ n), 1.0))))
                    for m in sec_n.values()] or [0.0])

    rim_fold = fold_against(basis[2])
    rim_idx = rim_idx[inl]          # MAD-cleaned: residual junk left by the brush
    if len(rim_idx) < 30:
        raise RepairError("the rim around the stroke is too uneven for a surface")
    uvh_known = (xyz[cand_idx] - origin) @ basis.T
    uvh_rim = (xyz[rim_idx] - origin) @ basis.T
    uvh_hole = (xyz[sel_mask] - origin) @ basis.T

    # --- grid --------------------------------------------------------------
    cell = max(2.0 * spacing, 1e-9)
    all_u = np.concatenate([uvh_known[:, 0], uvh_hole[:, 0]])
    all_v = np.concatenate([uvh_known[:, 1], uvh_hole[:, 1]])
    vol = getattr(params, "volume", None)
    if vol is not None:
        # the grid reaches over the whole stroke, not only what was selected
        ax = _volume_surface(vol)
        if len(ax):
            uva = (ax - origin) @ basis[:2].T
            lo_k, hi_k = all_u.min(), all_u.max()
            lo_l, hi_l = all_v.min(), all_v.max()
            m_ = 4.0 * radius
            uva = uva[(uva[:, 0] > lo_k - m_) & (uva[:, 0] < hi_k + m_)
                      & (uva[:, 1] > lo_l - m_) & (uva[:, 1] < hi_l + m_)]
            all_u = np.concatenate([all_u, uva[:, 0]])
            all_v = np.concatenate([all_v, uva[:, 1]])
    lo_u, lo_v = all_u.min() - cell, all_v.min() - cell
    nu = int((all_u.max() - lo_u) / cell) + 2
    nv = int((all_v.max() - lo_v) / cell) + 2
    if nu * nv > 6_000_000:
        raise RepairError("the stroke is too large for one pass")

    ku, kv, kok = _cells(uvh_known[:, 0], uvh_known[:, 1], cell, lo_u, lo_v, nu, nv)
    cand_idx, uvh_known, ku, kv = cand_idx[kok], uvh_known[kok], ku[kok], kv[kok]
    ru, rv, rok = _cells(uvh_rim[:, 0], uvh_rim[:, 1], cell, lo_u, lo_v, nu, nv)
    hu, hv, hok = _cells(uvh_hole[:, 0], uvh_hole[:, 1], cell, lo_u, lo_v, nu, nv)

    # --- which layer is "the surface" -------------------------------------
    # The rim sits on it by definition, so whichever side holds less material
    # than the rim is outward. Then cut each cell at the first thickness gap.
    rim_cells = np.zeros((nv, nu), bool)
    rim_cells[rv[rok], ru[rok]] = True
    rim_h = float(np.median(uvh_rim[rok, 2]))
    outward = 1.0 if np.mean(uvh_known[:, 2] < rim_h) >= 0.5 else -1.0
    # The side facing the camera the stroke was painted from is the front.
    # The material count above is wrong on a translucent slab with haze and
    # raised lettering in front of it (the hut: the inside was taken for the
    # front, and the deep fill's wide view stood inside the hut).
    view = getattr(params, "view", None)
    if view is not None and len(view) == 3:
        f = float(np.dot(basis[2], np.asarray(view, float)))
        if abs(f) > 0.2 * max(float(np.linalg.norm(view)), 1e-12):
            outward = 1.0 if f < 0 else -1.0
    lin = kv * nu + ku
    surf = _outer_shell(uvh_known[:, 2], lin, outward, gap_tol=8.0 * spacing)
    if surf.sum() < 30:
        raise RepairError("no surface can be made out around the stroke")

    # The outermost layer is still several splats deep. A scanner leaves haze
    # standing off the front face with no gap wide enough to cut at, so the
    # gap rule keeps it, and the cell's height becomes a median of surface and
    # haze together -- which is neither. Measured on the shoe, a third of what
    # this called "surface" sat more than a unit off it, and right at the hole
    # the median was nine units out: the far wall, seen through the gap.
    #
    # Everything downstream is measured against that height, so this is not a
    # cosmetic problem. It is why donor relief came out in whole units where
    # a tread is a tenth of one, and why a transplant could not carry a
    # pattern: the pattern had been averaged away before the search began.
    #
    # So take the outermost *dense* layer. A high quantile per cell says
    # roughly where the front face is, a median filter across cells steadies
    # it against cells that hold nothing but haze, and splats more than a
    # couple of spacings off that are not the surface.
    q_out = 0.80 if outward > 0 else 0.20
    h_out, _ = _cell_quantile(uvh_known[surf, 2], kv[surf], ku[surf], nv, nu, q_out)
    h_out = ndimage.median_filter(_fill_nearest(h_out, np.isfinite(h_out)),
                                  size=3, mode="nearest")
    tight = np.zeros(len(surf), bool)
    idx_s = np.where(surf)[0]
    tight[idx_s] = (np.abs(uvh_known[idx_s, 2] - h_out[kv[idx_s], ku[idx_s]])
                    < 3.0 * spacing)
    if tight.sum() >= 30:
        surf = tight
    n_haze = int(len(idx_s) - surf.sum())

    sur_idx, uvh_sur = cand_idx[surf], uvh_known[surf]
    su, sv = ku[surf], kv[surf]
    occ = np.zeros((nv, nu), bool)
    occ[sv, su] = True
    surf_h_raw, cnt = _cell_quantile(uvh_sur[:, 2], sv, su, nv, nu, 0.5)

    # --- the reference surface ---------------------------------------------
    # One surface, used for everything downstream: which cells still hold
    # surface, how proud of it each splat sits, and where the new splats go.
    cu0, cv0 = uvh_hole[:, 0].mean(), uvh_hole[:, 1].mean()
    holefoot = np.zeros((nv, nu), bool)
    holefoot[hv[hok], hu[hok]] = True
    holefoot = ndimage.binary_closing(holefoot, np.ones((3, 3)))

    on_rim = np.isin(sur_idx, rim_idx)
    if on_rim.sum() < 20:
        on_rim = np.ones(len(sur_idx), bool)

    def _tol_from(pred_):
        d = uvh_sur[on_rim, 2] - pred_(uvh_sur[on_rim, 0] - cu0,
                                       uvh_sur[on_rim, 1] - cv0)
        mad = float(np.median(np.abs(d - np.median(d))))
        return max(4.0 * spacing, 3.0 * 1.4826 * mad)

    # Bootstrap. A polynomial through the rim is a poor surface but a fine
    # first guess, and all the first pass has to decide is which cells show
    # the near wall and which show the far one through the hole.
    pred = fit_height_field(uvh_sur[on_rim, 0] - cu0, uvh_sur[on_rim, 1] - cv0,
                            uvh_sur[on_rim, 2], deg=params.surface_degree,
                            w=alpha[sur_idx[on_rim]], stiffness=params.stiffness)
    tol = _tol_from(pred)

    yy, xx = np.mgrid[0:nv, 0:nu]
    gu = lo_u + (xx + 0.5) * cell - cu0
    gv = lo_v + (yy + 0.5) * cell - cv0
    has_data = np.isfinite(surf_h_raw)

    # What was painted is the hole, splats or not. Where the scan has a hole
    # there is nothing to select, so the footprint of the selection had a gap
    # there -- filled only when the surface enclosed it. With the painted
    # volume, every cell whose point on the fitted surface lies inside it is
    # in the footprint. The edge rule below still cuts what lies past the
    # surface's own edge; inside its outline the membrane keeps a painted
    # hole, since the hole is no longer "void".
    n_vol = 0
    if vol is not None:
        volfoot = _volume_cells(vol, pred, gu, gv, origin, basis, cu0, cv0, holefoot, cell,
                                column=min(max(_volume_depth(vol), tol), 0.5 * radius))
        if keep_foot:
            # one face of a fold: the volume runs on over the other face, and
            # this face's plane carried past the fold is in the air there
            volfoot &= ndimage.binary_fill_holes(
                ndimage.binary_closing(np.pad(holefoot, 6), np.ones((3, 3)),
                                       iterations=4)[6:-6, 6:-6])
        n_vol = int((volfoot & ~holefoot).sum())
        holefoot = holefoot | volfoot

    # Two passes. The thin plate is a far better surface than the bootstrap,
    # so deciding coverage again with it moves the cells the polynomial had
    # misjudged -- on a large hole, most of them.
    covered = ref = None
    for pass_ in range(2):
        expect = pred(gu, gv)
        near = np.abs(uvh_sur[:, 2] - expect[sv, su]) < tol
        covered = np.zeros((nv, nu), bool)
        covered[sv[near], su[near]] = True
        covered = ndimage.binary_closing(covered, np.ones((3, 3)))

        ref = covered & ~holefoot & has_data
        if ref.sum() < 16:
            ref = occ & ~holefoot & has_data
        if ref.sum() < 4:
            raise RepairError("no surface is left around the stroke "
                              "to measure against")
        if pass_ == 1 and params.respect_edge:
            # The edge membrane further down solves over the surface ring and
            # the void beside the hole; both are known now, but for the cells
            # `thin` adds to the hole, which on every case measured changes
            # none of them. So start on it now; if `thin` does change them it
            # is simply factorised again where it is used.
            enc_ = ndimage.binary_fill_holes(covered) & ~covered
            hole_ = ndimage.binary_opening((holefoot | enc_) & ~covered, np.ones((2, 2)))
            nh_ = ndimage.binary_dilation(holefoot, np.ones((3, 3)),
                                          iterations=max(over_cells_hint(params, width, cell), 4) + 4)
            vd_ = ndimage.binary_opening(nh_ & ~ndimage.binary_closing(occ, np.ones((3, 3)))
                                         & ~holefoot & ~hole_, np.ones((3, 3)))
            if vd_.sum() >= 8:
                prefetch_reference_surface((covered & ~holefoot & nh_) | vd_, smooth_cells=1.0,
                                           plate=False, exact=False)
        # The curved shape first, the thin plate on what is left (surfacefit):
        # a stiff plate alone flattened every dome -- the collar's surface
        # sat 8 spacings inside the scan under the hole, the sole's rounded
        # edge 5-6, and every copy sank with it.
        H = surfacefit.complete(surf_h_raw, ref, holefoot, smooth_cells=params.reference_smooth,
                                deg=params.surface_trend, exact=pass_ > 0,
                                need=holefoot | has_data, fast=True)
        pred = GridSurface(H, lo_u, lo_v, cell, cu0, cv0)
        tol = _tol_from(pred)

    hf = pred
    # Relief is sampled at each splat's own position, not at its cell's
    # centre, so that it is the exact inverse of how the new heights are
    # built further down. Anything else reintroduces the mismatch.
    relief_sur = uvh_sur[:, 2] - hf(uvh_sur[:, 0] - cu0, uvh_sur[:, 1] - cv0)

    enclosed = ndimage.binary_fill_holes(covered) & ~covered
    target = (holefoot | enclosed) & ~covered

    # What was painted gets replaced, even where some of it survived.
    #
    # "Covered" means a cell still holds *a* surface splat after a 3x3
    # closing, and that is far too generous inside the painted footprint. On
    # a curved band the brush (or a flat cut) takes most of the face and
    # leaves a scattering of it; the closing joins the scattering up, every
    # cell of the footprint is declared intact, and the brush refuses with
    # "no gap to fill" over a hole anyone can see. Measured on the sole, three
    # of four sites where the surface changes character came back like that:
    # 575 of 575 footprint cells "covered" while holding a fraction of the
    # material around them. Photoshop's remove tool does not ask whether
    # enough of what you painted is left; it replaces it.
    #
    # So inside the footprint, judge by how much face is left against what
    # the surroundings carry, and treat a cell holding less than most of it
    # as gone. Its remnants are taken out further down, so that the cell is
    # filled once, properly, instead of half-filled on top of a half-surface.
    face = np.abs(relief_sur) < 3.0 * spacing
    face_cnt = np.zeros((nv, nu))
    np.add.at(face_cnt, (sv[face], su[face]), 1.0)
    ring_ref = ref & ~holefoot & (face_cnt > 0)
    dens_face = float(np.median(face_cnt[ring_ref])) if ring_ref.any() else 1.0
    have_face = ndimage.uniform_filter(face_cnt, 3, mode="nearest") / max(dens_face, 1e-6)
    thin = holefoot & (have_face < params.replace_below)
    target = target | thin
    target = ndimage.binary_opening(target, np.ones((2, 2)))

    # Not past the surface's own edge.
    #
    # The footprint is wherever the brush went, and a brush painted over
    # something that stood out beyond the surface -- the stand on the shoe
    # reaches past the sole's edge -- covers cells where there never was any
    # surface. Filling them grew a ledge of Gaussians into empty space, which
    # from the photo's angle was a fringe flying free above the sole. A cell
    # beside the hole that holds no surface and was not painted is void.
    #
    # Which hole cells are past the edge is decided by carrying the edge
    # across: inside/outside interpolated over the hole as a membrane, cut
    # at one half. Nearest-of-the-two (surface or void) was tried first and
    # cut the stand's hole in half: its upper cells lie nearer the void just
    # above than the surface at the far side, though the edge runs past
    # them on both sides. The membrane joins the edge where it leaves the
    # hole to where it comes back.
    reach_v = max(over_cells_hint(params, width, cell), 4) + 4
    near_hole = ndimage.binary_dilation(holefoot, np.ones((3, 3)), iterations=reach_v)
    # void is never part of the hole itself: gaps the fill takes over beyond
    # the painted footprint (enclosed, or thinned past saving) would otherwise
    # pin the edge into the middle of the hole
    void = (near_hole & ~ndimage.binary_closing(occ, np.ones((3, 3)))
            & ~holefoot & ~target)
    void = ndimage.binary_opening(void, np.ones((3, 3)))
    if vol is not None and void.any():
        # Painted over a real hole, the cells the volume's column just missed
        # are empty too, and as "void" they pinned the edge into the middle
        # of the hole (a hole in the middle of the sole lost a third of its
        # cells). Void the painted footprint and the surface enclose is a
        # gap in the surface, not the land past its edge.
        void &= ~ndimage.binary_fill_holes(holefoot | covered)
    n_beyond = 0
    if void.sum() >= 8 and params.respect_edge:
        surf_cells = covered & ~holefoot & near_hole
        inside = fit_reference_surface(np.where(surf_cells, 1.0, 0.0),
                                       surf_cells | void, smooth_cells=1.0,
                                       plate=False, exact=False)
        beyond = target & (inside < 0.5)
        if keep_foot:
            # a face of a fold: the void beside its footprint is the other
            # face, not the end of the surface
            beyond &= ~holefoot
        n_beyond = int(beyond.sum())
        target &= ~beyond
    lbl, nlbl = ndimage.label(target)
    if nlbl:
        touched = set(np.unique(lbl[holefoot & (lbl > 0)])) - {0}
        target = np.isin(lbl, sorted(touched)) if touched else np.zeros_like(target)
    n_target = int(target.sum())
    if n_target < 4:
        # How far the painted splats stood from what is left: the pole's from
        # the hut's wall 4.4 spacings, a skin of a surface 1.0. Measured in
        # 3-D -- the rim's plane runs through a thin object, not the wall.
        d_s = cKDTree(xyz[cand_idx]).query(xyz[sel_mask])[0]
        standoff = float(np.median(d_s)) / spacing
        if n_beyond > 0 and standoff < 2.0:
            # Not a whole surface: the edge rule took the hole away, so the
            # stroke lies past what this one chart takes for the surface's
            # edge -- across a fold, typically. Saying "nothing to fill"
            # here sent the document to its delete fallback before the
            # face-by-face fill in `repair` had a chance. Unless the stroke
            # stands clear of what is left: the pole, painted with the app's
            # reach, crossed the roof's edge and was refused here.
            err = RepairError("The stroke lies beyond the edge of this surface. "
                              "Paint across an edge in smaller pieces.")
            err.rim_fold = float(rim_fold)
            raise err
        raise NothingToFill(
            "The surface behind the stroke is intact, nothing to fill. "
            "To remove it, use Delete.", standoff=standoff)

    # --- how many new Gaussians, and where --------------------------------
    # Fill a little past the hole, under the surviving surface, and fade
    # across that overlap. Fading at the hole's own edge would leave a ring of
    # half-transparent splats with nothing behind them -- a dark halo, since
    # the brush deleted the old surface there too.
    over = int(np.clip(round(params.feather * width / cell), 1, 12))
    fill = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=over)
    d_out = ndimage.distance_transform_edt(~target)
    ramp = np.clip(1.0 - d_out / (over + 1.0), 0.0, 1.0)

    # How many splats per cell the surrounding surface actually has.
    #
    # This used to be the rim band's splat count divided by the cells it
    # occupies, which counts a band several cells deep against the cells of
    # one -- the fill came out at 4.6 splats per cell against the 2.2 of the
    # surface it was joining. Twice the material reads as a patch whatever
    # its colour does, so measure the thing directly: the median count over
    # the cells that still hold surface near the hole.
    ring_cells = ndimage.binary_dilation(target, np.ones((3, 3)),
                                         iterations=max(over, 4)) & ref
    dens_src = cnt[ring_cells] if ring_cells.sum() >= 12 else cnt[ref]
    per_cell = params.density * float(np.median(dens_src)) if dens_src.size else 1.0
    per_cell = float(np.clip(per_cell, 0.05, 64.0))

    # Fade by what is already there, not by distance alone.
    #
    # A distance ramp does not know whether a cell still has surface in it.
    # Outside the hole it does, at full opacity, so new splats laid there at
    # full opacity too made a band of double material right along the seam --
    # which is the edge you can see. Taking the complement of the surviving
    # coverage puts in exactly what is missing: nothing where the old surface
    # is whole, everything where it is gone, and the in-between in between.
    # The averaging here must not reach across the hole's edge. A plain box
    # filter does, so cells just outside it were told they were only half
    # covered, and the fill kept a quarter of its opacity there -- a smooth,
    # pale veil lying over surface that was perfectly intact, washing out the
    # tread underneath it. That pale band along the rim was the edge.
    #
    # A normalised convolution averages only over cells that still hold
    # surface, so inside the hole it reports nothing and outside it reports
    # what is really there. The handover is then abrupt in the fill's own
    # opacity but continuous in the total, which is the quantity that shows:
    # the fill supplies exactly what the surface is missing, like a piece of
    # jigsaw rather than a cross-fade.
    want = max(per_cell / max(params.density, 1e-6), 1e-6)
    num = ndimage.uniform_filter(np.where(ref, cnt, 0.0), 3, mode="nearest")
    den = ndimage.uniform_filter(ref.astype(float), 3, mode="nearest")
    have = np.where(den > 1e-3, num / np.maximum(den, 1e-9), 0.0) / want
    fade_grid = np.minimum(ramp, np.clip(1.0 - have, 0.0, 1.0))
    fade_grid = np.maximum(fade_grid, np.where(target, 1.0, 0.0))
    # Nowhere near invisible is still not invisible: a splat at two percent
    # opacity is material lying over the surface. Where the surviving surface
    # is whole, put nothing there at all.
    place = fill & (fade_grid > 0.03)
    # The feather ring tops up a surviving surface; where none surrounds a
    # ring cell at the reference height there is nothing to top up. Read as
    # "nothing here, so fill fully", that laid a flat strip of copies past
    # the sole's edge where the real surface curves away -- 247 splats
    # floating beside the shoe, the fringe seen above the stand's hole.
    if params.respect_edge:
        place &= target | ((den > 0.3) & ~void)
    if not place.any():
        place = target
    ty, tx = np.where(place)
    counts = rng.poisson(per_cell, size=len(ty))
    if counts.sum() == 0:
        counts[:] = 1
    cy, cx = np.repeat(ty, counts), np.repeat(tx, counts)
    jit = rng.random((len(cy), 2))
    nu_ = lo_u + (cx + jit[:, 0]) * cell
    nv_ = lo_v + (cy + jit[:, 1]) * cell
    forced = None

    # --- donors ------------------------------------------------------------
    rgb_sur = s.rgb[sur_idx]
    # Relief against the surface where the donor *is*, not against `hf`.
    #
    # `hf` is stiff on purpose -- it has to bridge the hole -- so away from
    # the hole it misses the surface's own bends by several spacings, and
    # "relief" there carried that miss: on the toe cap the donors' relief
    # sat a median 2.4 spacings under `hf`, and the patch sank by as much
    # although the surface under the hole was right. So relief is taken
    # against the local surface at the source -- `hf` plus the donors' own
    # mean relief, smoothed over a few cells, coarser than any pattern --
    # and what fixes the patch's height is the rim, through the seam
    # correction, which is given the raw relief on the hole's side.
    relief_raw = relief_sur
    rel_lp = level = None
    if params.relief_local > 0:
        ok_lp = ~target & ~holefoot
        sR, cR_ = _accum(relief_sur, sv, su, nv, nu)
        m_lp = (cR_ > 0) & ok_lp
        num_lp = ndimage.gaussian_filter(np.where(m_lp, sR / np.maximum(cR_, 1e-9), 0.0),
                                         params.relief_local, mode="nearest")
        den_lp = ndimage.gaussian_filter(m_lp.astype(np.float64), params.relief_local,
                                         mode="nearest")
        if m_lp.sum() >= 16:
            rel_lp = np.where(den_lp > 1e-3, num_lp / np.maximum(den_lp, 1e-9), 0.0)
            relief_sur = relief_sur - rel_lp[sv, su]
            # where the surface really is, against `hf`: measured round the
            # hole and carried across it as a membrane (it stays within what
            # the rim says). This, not the texture's mismatch along the seam,
            # pins the patch's height.
            near_lp = m_lp & (den_lp > 0.05)
            level = fit_reference_surface(np.where(near_lp, rel_lp, np.nan), near_lp,
                                          smooth_cells=1.0, plate=False, exact=False)
    # What relief this surface actually has, measured where we can see it.
    # Used twice below: to judge a whole donor block, and to rein in the
    # individual donors inside it.
    # Taken from the rim band. Widening it to the whole surviving surface
    # was tried, on the grounds that a narrow band on a smooth stretch gives
    # a tiny limit that clamps almost every donor; it doubled the height
    # error, so the narrowness is doing real work and stays.
    rim_rel = relief_sur[on_rim]
    rel_med = float(np.median(rim_rel))
    rel_mad = 1.4826 * float(np.median(np.abs(rim_rel - rel_med)))
    rel_lim = (np.inf if params.relief_clamp <= 0 else
               max(params.relief_clamp * rel_mad, 2.0 * spacing))

    donor_offset, score, cands = None, np.inf, []
    foreign = _foreign_cells(rgb_sur, sv, su, nv, nu, cnt, occ, target,
                             s.rgb[sel_mask], s.alpha[sel_mask])
    if foreign is not None:
        h_rem = outward * (uvh_hole[:, 2] - hf(uvh_hole[:, 0] - cu0, uvh_hole[:, 1] - cv0))
        foreign = _foreign_halo(foreign, occ & ~target, target, h_rem, cell)
    if params.mode in ("auto", "patch"):
        donor_offset, score, cands = _find_donor_patch(
            target, occ, relief_sur, rgb_sur, sv, su, nv, nu, cnt, topk=6,
            avoid=foreign)
        if donor_offset is None and params.mode == "patch":
            raise RepairError("no donor patch matches this rim; try seeding from the rim")
        if params.mode == "auto" and score > 25.0:
            # Fall back only when nothing plausible was found at all.
            #
            # Two tighter rules used to live here -- a hole-size rule and a
            # match-score cut at 3 -- and ground truth says neither predicts
            # anything. The size rule sent every small hole to rim sampling;
            # the score cut rejected a donor scoring 17.6 whose fill came out
            # four and a half times closer to the truth than rim sampling's.
            # Both were calibrated when the transplant was being fed a
            # surface half made of haze, and neither survived the fix.
            #
            # What is left is a guard against nonsense rather than a
            # preference, and it is honest to say there is no measured case
            # in which a donor that passes it does worse than rim sampling.
            # The real fallback is finding no donor at all, which still
            # happens on surfaces with nothing repeating to borrow from.
            donor_offset = None

    src, dc_shift, don_relief, used, block_dev = None, None, None, "rim", None
    n_bridged = 0
    curved = []
    n_band = 0.0
    sdz = None
    smooth_fill = None
    n_empty_src = 0
    aux = {}
    motif_info = None
    field, n_shifts = None, 1
    reg = None
    if donor_offset is not None:
        if params.synth and target.sum() >= 12 and params.zones > 1:
            # The zone membrane (`_region_labels`) solves over exactly these
            # cells. Started here, once a donor says the zones will be built:
            # started before the donor search, a fill that then fell back to
            # the rim left it factorised and unused.
            prefetch_reference_surface(occ & ~holefoot & covered, smooth_cells=3.0, plate=False,
                                       fast=True)
        if params.tone_smooth > 0 and (occ & ~target).sum() >= 16:
            # the tone fit in `_donors_from_patch` solves over exactly these cells
            prefetch_reference_surface(occ & ~target, smooth_cells=params.tone_smooth,
                                       plate=params.tone_plate, exact=False)
        if params.synth and target.sum() >= 12:
            # Per-cell sources, found by patch matching. The content the
            # hole is filled with is chosen cell by cell against what
            # surrounds it, which is the only way a lattice comes out as a
            # lattice instead of as the average of one.
            sumR_f, cnt_f = _accum(rgb_sur, sv, su, nv, nu)
            cR_f = sumR_f / np.maximum(cnt_f, 1e-9)[..., None]
            sumH_f, _ = _accum(relief_sur, sv, su, nv, nu)
            cH_f = sumH_f / np.maximum(cnt_f, 1e-9)
            span_f = max(float(np.percentile(np.abs(cH_f[occ]), 95)), 1e-6)
            feat = np.concatenate(
                [1.1 * (cH_f / span_f)[..., None], 1.73 * cR_f], axis=-1)
            valid_f = cnt_f > 0
            kn = valid_f & ~holefoot & covered
            if params.texture_weight > 0:
                # How busy each neighbourhood is, as a channel of its own.
                #
                # A squared difference over relief and colour is minimised
                # by the donor whose *mean* matches, and at a boundary between
                # a tread and a smooth band that is a smooth or a blurred
                # mixed patch -- the classic bias of patch matching towards
                # flat sources. Newson and others (2014, video inpainting)
                # add the local texture strength to the descriptor so that a
                # busy target refuses a flat donor and the other way round.
                # Normalised over the occupied cells only, because a third of
                # the grid is empty and a plain filter would count the gaps.
                m_ = kn.astype(np.float64)
                den_ = np.maximum(ndimage.uniform_filter(m_, 5), 1e-9)
                tex = []
                for ch in (feat[..., 0], feat[..., 1:4].mean(-1)):
                    mu_ = ndimage.uniform_filter(ch * m_, 5) / den_
                    var_ = ndimage.uniform_filter(ch * ch * m_, 5) / den_ - mu_ ** 2
                    sd_ = np.sqrt(np.maximum(var_, 0.0))
                    scale_ = float(np.median(sd_[kn])) if kn.any() else 1.0
                    tex.append(params.texture_weight * sd_ / max(scale_, 1e-9))
                feat = np.concatenate([feat, np.stack(tex, -1)], -1)
            lab = None
            if params.zones > 1:
                # One-hot zone channels. A match that crosses from the
                # diamonds to the plaque now costs `zone_weight` per channel
                # on every cell of the window, which is what stops a lattice
                # being run over a smooth area.
                lab = _region_labels(feat, kn, target, k=params.zones)
                if lab is not None and params.zone_bridge:
                    lab, n_bridged = _bridge_zones(lab, target, params.zones)
                # A band whose two boundaries both enter and leave the hole --
                # the plaque under the sole's border arc -- is completed between
                # those boundaries, each continued as a curve. Measured on the
                # stand hole the membrane had run the lattice over it, and the
                # fill copied the arc in as a pale arrow. Only the band is
                # stamped; every other label stays as it was, and a band that
                # fails any of the tests in `_bridge_curves` changes nothing.
                if lab is not None and params.zone_curves:
                    surf_ = ~_void_mask(kn, target) & ~target
                    clean_ = _clean_labels(lab, surf_, params.zones)
                    out_, sdz, cinfo = _bridge_curves(
                        clean_, kn, target, surf_, params.zones, gap=params.curve_gap,
                        margin=params.curve_margin, cap=params.curve_cap)
                    if sdz is not None:
                        lab = np.where(target & np.isin(out_, cinfo["zones"]), out_, lab)
                        curved = cinfo.get("bridged", [])
                if lab is not None:
                    oh = np.stack([(lab == j).astype(np.float64) * params.zone_weight
                                   for j in range(params.zones)], -1)
                    feat = np.concatenate([feat, oh], -1)
            # Start from the coherent field, not from one global offset.
            #
            # Patch matching can only judge a cell that has something around
            # it to be judged against, so it works inwards from the rim about
            # two cells a pass however far its candidates jump. On a hole
            # thirty-seven cells deep the middle therefore kept whatever it
            # started with, and starting it all at one offset left the centre
            # a single flat sample of the pattern. The label field below has
            # no such limit -- where there is no data its cost is zero for
            # every candidate and coherence carries the choice in from the
            # rim -- so it makes the right first guess everywhere, and the
            # matching refines it where it can see.
            # Lattice vectors from `_dominant_offsets` were tried here once
            # as extra candidates and lost near the rim: a single lattice
            # vector is a few cells long, so for a hole twenty-five cells
            # deep its source lies inside the hole and only the rim can use
            # it. Multiples of it reach across. Two cells filled from
            # different multiples of the same vector place identical
            # content, so the field can change between them without a seam,
            # and on the stand hole one offset now carries most of the hole
            # in phase instead of a mosaic of five hundred.
            pool = list(cands)
            if params.lattice:
                pool += _lattice_multiples(feat, kn, target, nv, nu)
            reg = (_source_region(kn, target, params.source_region)
                   if params.source_region > 0 else kn)
            if foreign is not None:
                reg = reg & ~foreign
            outl = (_cell_outliers(rgb_sur, relief_sur, sv, su, nv, nu, kn)
                    if params.outlier_weight > 0 else None)
            # A hole that one zone encloses -- letters inside a woven label --
            # takes its sources from that zone. Nothing is continued into such
            # a hole: its ring names the zone. On open holes the same rule
            # doubled the height error, so it fires only on an enclosure.
            enc, enc_info = ((_enclosed_zone(lab, kn, target))
                             if params.enclosed_zone and lab is not None else (None, {}))
            dzone = None
            depth_w = params.depth_weight
            # Near a continued curve, a source must stand at the same depth
            # into the band as the cell it fills, so the border is copied from
            # the border and the middle from the middle. NaN in `sdz` -- hole
            # cells away from every curve -- carries no price.
            if enc is None and sdz is not None:
                dzone, depth_w = sdz, params.curve_weight
            if enc is not None and (reg & enc).sum() >= 30:
                reg = reg & enc
                # Depth inside the zone: a label is brighter at its margin than
                # in its middle, and margin cells copied mid-field left a pale
                # streak. Sources from the same depth keep the margin a margin.
                if params.depth_weight > 0:
                    dzone = ndimage.distance_transform_edt(
                        ndimage.binary_closing(enc | target, np.ones((5, 5))) | target)
            # Bands along a surface's edge -- the pebbled strip round a sole,
            # the smooth stripe inside it -- must come in at the width they have
            # beside the hole. Measured on the stand hole, the band rows took
            # their sources 1-2 cells nearer the edge, so the band came out
            # wide; in the wide stroke the rows 8-15 cells in copied lattice
            # ridges from 8-15 cells deeper, the pale rectangles in the band.
            # Inside the band depth read from the zones, a source must stand
            # at the same distance from the edge; beyond it every depth is
            # alike. Only where the hole reaches into the band and past it --
            # everywhere else the price cost height (edge discs r=4: 3.4 -> 4.3).
            if dzone is None and params.edge_band_weight > 0:
                dzone, n_band = _edge_band_dzone(kn, target, lab)
                if dzone is not None:
                    depth_w = params.edge_band_weight
                else:
                    n_band = 0.0          # measured, but the gate kept the price off
            # The coherent first field still wants occupied sources: allowed
            # empty ones, it laid one copy over most of the hole and brought
            # the plaque's arc in as a pale blob. Only the fine matching below
            # may point at an empty cell inside the surface -- there it keeps
            # the lattice's offset where it used to switch to another one.
            # Never copy a motif: a source inside something that does not
            # repeat under the surface's own lattice, where the hole's ring
            # has nothing like it, pays per cell (`_motif_map`). On the stand
            # hole the heel's and the ball's circle carried 82 % of the hole.
            motif = (_motif_map(feat[..., :4], kn, target)
                     if params.motif_weight > 0 else None)
            if motif is not None:
                motif_info = round(float(np.median(motif[1][target])), 3)
            init_y, init_x, _ = _offset_field(pool, target, kn, feat,
                                              valid_f, nv, nu,
                                              region=((kn & ~foreign) if foreign is not None else kn)
                                              if params.source_region > 0 else reg,
                                              outlier=outl,
                                              outlier_w=params.outlier_weight,
                                              dzone=dzone, depth_w=depth_w,
                                              motif=motif, motif_w=params.motif_weight)
            init_y = np.where(target, init_y, 0).astype(np.int64)
            init_x = np.where(target, init_x, 0).astype(np.int64)
            fy, fx = _synthesise_offsets(target, kn, feat,
                                         (init_y, init_x), rng,
                                         iters=params.synth_passes,
                                         levels=params.synth_levels,
                                         frontier=params.synth_frontier,
                                         soft_vote=params.synth_soft_vote,
                                         coherence=params.synth_coherence,
                                         region=reg, outlier=outl,
                                         outlier_w=params.outlier_weight,
                                         dzone=dzone, depth_w=depth_w,
                                         motif=motif, motif_w=params.motif_weight)
            # A smooth band is not copied inside. The plaque is made of long
            # flat splats (anisotropy p90 61, each spanning several cells), and
            # a mosaic of 325 offsets cut that arrangement into pieces that
            # each carried whole needles: the band came out pale and hairy.
            # Its interior is scattered from a pool of the zone's plain splats
            # instead; only the border strip and the cells beside it are copied.
            if sdz is not None and enc is None and params.curve_fill:
                smooth_fill = _smooth_band(target, kn, sdz, lab, feat, sv, su, s, sur_idx,
                                           params)
            # Past the hole's edge the field used to be (0, 0), so the fill
            # laid in the seam ring was each cell's own surface copied back
            # onto itself -- and then shifted by the seam correction, which
            # had been solved for a donor from somewhere else. Measured, the
            # self-copies moved a median 0.6 to 6.5 splat spacings off the
            # surface: a faint second skin floating over the seam. Carry the
            # nearest hole cell's offset outwards instead, so the ring
            # continues the transplant it is blending into.
            if params.ring_continues:
                fy = np.where(target, fy, np.rint(_fill_nearest(
                    np.where(target, fy, np.nan).astype(float), target))).astype(np.int64)
                fx = np.where(target, fx, np.rint(_fill_nearest(
                    np.where(target, fx, np.nan).astype(float), target))).astype(np.int64)
            field = (fy, fx)
            n_shifts = int(len(np.unique(
                (fy[target].astype(np.int64) << 20) + fx[target])))
        if field is not None and params.placement == "donor":
            # Let the donors decide where the new splats go.
            #
            # The other way round -- scatter splats on a jittered grid, then
            # hand each the donor nearest its own position plus the offset --
            # puts every copy up to half a neighbour-distance away from where
            # its content belongs. Individually invisible; across a whole
            # patch it is a blur at exactly the scale of the pattern, and the
            # rendered tread came out a quarter softer than the surface it
            # joined. Copying a donor region rigidly keeps its splats in
            # their relative places, and the density comes out right without
            # being asked.
            fy, fx = field
            order = np.lexsort((np.arange(len(sv)), sv * nu + su))
            lin_sorted = (sv * nu + su)[order]
            starts = np.searchsorted(lin_sorted, np.arange(nv * nu), "left")
            ends = np.searchsorted(lin_sorted, np.arange(nv * nu), "right")
            s_lin = (ty + fy[ty, tx]) * nu + (tx + fx[ty, tx])
            ok_cell = ((ty + fy[ty, tx] >= 0) & (ty + fy[ty, tx] < nv)
                       & (tx + fx[ty, tx] >= 0) & (tx + fx[ty, tx] < nu))
            s_lin = np.where(ok_cell, s_lin, 0)
            take, oy_, ox_ = [], [], []
            ex_y, ex_x = [], []
            j0a = np.where(ok_cell, starts[s_lin], 0)
            j1a = np.where(ok_cell, ends[s_lin], 0)
            # smooth band interior: scattered below; empty source: likewise
            in_band = (smooth_fill[0][ty, tx] if smooth_fill is not None
                       else np.zeros(len(ty), bool))
            hit = ~in_band & (j1a > j0a)
            miss = np.flatnonzero(~hit).tolist()
            if hit.any():
                nh = (j1a - j0a)[hit]
                first = np.cumsum(nh) - nh
                take.append(order[np.repeat(j0a[hit] - first, nh) + np.arange(int(nh.sum()))])
                oy_.append(np.repeat(ty[hit], nh))
                ox_.append(np.repeat(tx[hit], nh))
                ex_y.append(np.zeros(int(nh.sum())))
                ex_x.append(np.zeros(int(nh.sum())))
            # With empty cells allowed as sources, a target whose source holds
            # nothing copies the nearest occupied neighbour of that source,
            # rigidly and shifted by the one cell, instead of a Poisson
            # scatter of nearest donors that breaks the pattern's phase.
            # An empty source cell inside the surface is part of the pattern
            # (the gap between two ridges): copy it as empty. That is the
            # rigid copy, and the density stays the source's own. On the stand
            # hole the phase seams fell from 30 % of neighbouring cells to 13 %.
            if miss and params.empty_source == "skip" and reg is not None:
                mi_ = np.asarray(miss, np.int64)
                in_reg = ok_cell[mi_] & reg[np.where(ok_cell, ty + fy[ty, tx], 0)[mi_],
                                            np.where(ok_cell, tx + fx[ty, tx], 0)[mi_]]
                miss = mi_[in_band[mi_] | ~in_reg].tolist()
            if miss and params.empty_source == "rigid":
                still = []
                for i in miss:
                    sy0 = ty[i] + fy[ty[i], tx[i]]
                    sx0 = tx[i] + fx[ty[i], tx[i]]
                    found = None
                    for ddy, ddx in ((0, 1), (0, -1), (1, 0), (-1, 0),
                                     (1, 1), (1, -1), (-1, 1), (-1, -1)):
                        sy1, sx1 = sy0 + ddy, sx0 + ddx
                        if 0 <= sy1 < nv and 0 <= sx1 < nu:
                            l1 = sy1 * nu + sx1
                            if ends[l1] > starts[l1]:
                                found = (order[starts[l1]:ends[l1]], ddy, ddx)
                                break
                    if found is None:
                        still.append(i)
                        continue
                    gsel, ddy, ddx = found
                    take.append(gsel)
                    oy_.append(np.full(len(gsel), ty[i]))
                    ox_.append(np.full(len(gsel), tx[i]))
                    ex_y.append(np.full(len(gsel), float(ddy)))
                    ex_x.append(np.full(len(gsel), float(ddx)))
                miss = still
            if take:
                g = np.concatenate(take)
                cy, cx = np.concatenate(oy_), np.concatenate(ox_)
                nu_ = uvh_sur[g, 0] - fx[cy, cx] * cell - np.concatenate(ex_x) * cell
                nv_ = uvh_sur[g, 1] - fy[cy, cx] * cell - np.concatenate(ex_y) * cell
                # A source cell can be empty -- the grid is only about sixty
                # percent occupied -- and a target cell left with nothing is
                # a hole inside the fill. Those few fall back to the old
                # way: scatter on the grid, take the nearest donor.
                if miss:
                    mi = np.asarray(miss)
                    c2 = np.maximum(rng.poisson(per_cell, size=len(mi)), 1)
                    gy2 = np.repeat(ty[mi], c2)
                    gx2 = np.repeat(tx[mi], c2)
                    j2 = rng.random((len(gy2), 2))
                    u2 = lo_u + (gx2 + j2[:, 0]) * cell
                    v2 = lo_v + (gy2 + j2[:, 1]) * cell
                    q2 = np.stack([u2 + fx[gy2, gx2] * cell,
                                   v2 + fy[gy2, gx2] * cell], 1)
                    _, d2 = cKDTree(uvh_sur[:, :2]).query(q2, k=1)
                    if smooth_fill is not None:
                        d2 = _smooth_band_donors(d2, gy2, gx2, smooth_fill, rng, fy, fx)
                    nu_ = np.concatenate([nu_, u2])
                    nv_ = np.concatenate([nv_, v2])
                    cy = np.concatenate([cy, gy2])
                    cx = np.concatenate([cx, gx2])
                    g = np.concatenate([g, d2])
                forced = g
                # Cells of a smooth band are scattered on purpose; only the
                # rest had an empty source.
                n_smooth = (int(smooth_fill[0][ty[miss], tx[miss]].sum()) if miss else 0
                            ) if smooth_fill is not None else 0
                n_empty_src = len(miss) - n_smooth
        src, dc_shift, don_relief, aux = _donors_from_patch(
            donor_offset, cell, nu_, nv_, uvh_sur, sur_idx, rgb_sur, relief_sur,
            target, sv, su, nv, nu, cy, cx, field=field, forced=forced,
            tone_smooth=params.tone_smooth, tone_plate=params.tone_plate,
            level=level, ring_avoid=holefoot if params.seam_clean else None,
            seam_membrane=params.seam_membrane)
        used = "patch"
        # Reported, not acted on. It was a reject rule once -- a donor
        # whose relief strayed far from the rim's median looked like the
        # wrong surface. Measured against ground truth it turned out to
        # predict the opposite: the two sites where it ran highest (3.1 and
        # 8.0) are the two where the transplant beat rim sampling four times
        # over, because relief that strays from the median is exactly what a
        # tread is. Preferring a low value was preferring a flat donor.
        block_dev = (float(np.median(np.abs(don_relief - rel_med)))
                     / max(rel_mad, 1e-9))
    if src is None:
        src, dc_shift, don_relief = _donors_from_rim(
            nu_, nv_, uvh_sur, sur_idx, relief_sur, on_rim, s, rng, params)

    # --- build -------------------------------------------------------------
    # Donor relief is copied from real splats, and not every splat on a scan
    # is surface: some of it is haze hanging a finger's width off the front
    # face. Copy one of those and the new splat inherits the same distance
    # proud of the fill, which is how a patch comes out riding above the
    # surface it was meant to join. The rim band says what relief this
    # surface actually has; anything well outside that is not texture.
    # Centred on the rim, which is also doing the donor set's levelling:
    # centring on the donors' own median instead was tried and doubled the
    # height error, so the two jobs are not separable here.
    # the clamp is on the donor's own relief, not on the level it is set to
    base_lv = (aux["height"][cy, cx] if level is not None and isinstance(aux, dict)
               and aux.get("height") is not None and len(cy) == len(don_relief) else 0.0)
    don_relief = don_relief - base_lv
    clamped = int(np.count_nonzero(np.abs(don_relief - rel_med) > rel_lim))
    don_relief = np.clip(don_relief, rel_med - rel_lim, rel_med + rel_lim)
    don_relief = don_relief + base_lv

    # --- the slab behind the face -----------------------------------------
    # A scanned surface is not a sheet. Within eight splat spacings of the
    # fitted surface the shoe carries three splats per cell; the outermost
    # dense layer, which is all the donors are taken from, holds two. The
    # fill was reproducing the face and leaving the third behind, so it came
    # out with 0.86 of opacity per cell against the surround's 1.38, and what
    # lies behind a surface shows through it: the patch rendered four percent
    # darker than its neighbours for that reason alone, on top of the much
    # larger tone error that has its own fix above.
    #
    # The face is found by cutting everything more than three spacings off
    # the outermost dense layer. That cut is right for deciding what the
    # surface *is* -- averaging haze into it is what made relief meaningless
    # -- but the material it discards inwards is real, and the fill needs it.
    # So copy it too, from the same source cell and at its own depth, with
    # no say in the matching and none of the face's levelling.
    n_back = 0
    if forced is not None and params.backing > 0 and field is not None:
        fy, fx = field
        rel_known = uvh_known[:, 2] - hf(uvh_known[:, 0] - cu0,
                                         uvh_known[:, 1] - cv0)
        face_rel, _ = _cell_quantile(relief_sur, sv, su, nv, nu, q_out)
        face_rel = _fill_nearest(face_rel, np.isfinite(face_rel))
        depth_k = outward * (rel_known - face_rel[kv, ku])
        back = ((depth_k < -3.0 * spacing)
                & (depth_k > -params.backing * spacing)
                & covered[kv, ku] & ~holefoot[kv, ku])
        b_all = np.where(back)[0]
        if len(b_all) >= 16:
            bl = kv[b_all] * nu + ku[b_all]
            ob = np.argsort(bl, kind="stable")
            bls = bl[ob]
            bs = np.searchsorted(bls, np.arange(nv * nu), "left")
            be = np.searchsorted(bls, np.arange(nv * nu), "right")
            sy_t = ty + fy[ty, tx]
            sx_t = tx + fx[ty, tx]
            good = ((sy_t >= 0) & (sy_t < nv) & (sx_t >= 0) & (sx_t < nu))
            slin = np.where(good, sy_t * nu + sx_t, 0)
            take, ocy, ocx = [], [], []
            j0b = np.where(good, bs[slin], 0)
            j1b = np.where(good, be[slin], 0)
            hb = j1b > j0b
            if hb.any():
                nb = (j1b - j0b)[hb]
                first = np.cumsum(nb) - nb
                take.append(b_all[ob[np.repeat(j0b[hb] - first, nb) + np.arange(int(nb.sum()))]])
                ocy.append(np.repeat(ty[hb], nb))
                ocx.append(np.repeat(tx[hb], nb))
            if take:
                bk = np.concatenate(take)
                bcy, bcx = np.concatenate(ocy), np.concatenate(ocx)
                bsy = np.clip(bcy + fy[bcy, bcx], 0, nv - 1)
                bsx = np.clip(bcx + fx[bcy, bcx], 0, nu - 1)
                hcorr = aux.get("height")
                b_rel = rel_known[bk] + (0.0 if hcorr is None
                                         else hcorr[bcy, bcx])
                if rel_lp is not None:
                    b_rel = b_rel - rel_lp[bsy, bsx]
                tone = aux.get("tone")
                b_shift = (np.zeros((len(bk), 3)) if tone is None else
                           (tone[bcy, bcx] - tone[bsy, bsx]) / SH_C0)
                src = np.concatenate([src, cand_idx[bk]])
                nu_ = np.concatenate([nu_, uvh_known[bk, 0] - fx[bcy, bcx] * cell])
                nv_ = np.concatenate([nv_, uvh_known[bk, 1] - fy[bcy, bcx] * cell])
                cy, cx = np.concatenate([cy, bcy]), np.concatenate([cx, bcx])
                don_relief = np.concatenate([don_relief, b_rel])
                dc_shift = np.vstack([dc_shift, b_shift])
                n_back = int(len(bk))

    h_new = hf(nu_ - cu0, nv_ - cv0) + params.roughness * don_relief
    new_xyz = origin + np.stack([nu_, nv_, h_new], 1) @ basis

    # A copy keeps the orientation it had where it came from. On a flat sole
    # that is right; on a curved surface the donor faces another way than the
    # place it is copied to, and the copy stands in the surface at that angle.
    # So each copy is turned by the change of the fitted surface's normal
    # from its donor to its target, orientation and view-dependent bands
    # alike -- what the stamp already does.
    quats = s.rot[src].astype(np.float64)
    turns = np.zeros(len(src))
    sh_turn = None
    if params.turn_copies and len(src):
        quats, turns, sh_turn = _turn_copies(
            quats, xyz[src], np.stack([nu_, nv_], 1), hf, origin, basis, cu0, cv0, cell)

    f_dc = s.f_dc[src].astype(np.float64) + dc_shift
    if params.sh_mode == "flat" or s.f_rest.shape[1] == 0:
        f_rest = np.zeros_like(s.f_rest[src], dtype=np.float64)
    else:
        f_rest = s.f_rest[src].astype(np.float64)
        if sh_turn is not None:
            f_rest = sh_turn(f_rest)

    t = fade_grid[cy, cx]
    fade = 0.5 * (1.0 - np.cos(np.pi * t))      # smooth, not linear, at both ends
    opacity = _scale_opacity(s.opacity[src], fade, optical=params.optical_fade)

    # Reconstruction haze around a removed object rarely falls inside the
    # stroke -- it hangs just off the surface, outside it. Left alone it shows
    # as a grey smear over an otherwise clean repair, so anything still
    # floating proud of the new surface inside the painted footprint goes too.
    removed = sel_mask.copy()
    # remnants of the face in cells judged gone (see `thin` above)
    gone = (target & thin)[sv, su]
    removed[sur_idx[gone]] = True
    n_remnants = int(gone.sum())
    n_ghosts = 0
    if params.cleanup_ghosts:
        kin = holefoot[kv, ku]
        proud = outward * (uvh_known[:, 2]
                           - hf(uvh_known[:, 0] - cu0, uvh_known[:, 1] - cv0)) > tol
        ghosts = cand_idx[kin & proud]
        # Only near what was painted. Haze off a removed object lies within
        # four spacings of it (every shoe disc, the stand); painted through to
        # a second wall, the footprint grew and the rule took 9177 splats off
        # the first one, 65-150 spacings from the stroke.
        if len(ghosts):
            d_g = cKDTree(xyz[sel_mask]).query(
                xyz[ghosts], distance_upper_bound=6.0 * spacing)[0]
            ghosts = ghosts[np.isfinite(d_g)]
        removed[ghosts] = True
        n_ghosts = int(len(ghosts))

    added = SplatSet(
        xyz=new_xyz.astype(np.float32),
        f_dc=f_dc.astype(np.float32),
        f_rest=f_rest.astype(np.float32),
        opacity=opacity.astype(np.float32),
        scale=s.scale[src].copy(),
        rot=quats.astype(np.float32),
        extra={k: v[src].copy() for k, v in s.extra.items()},
    )
    info = {
        "mode": used, "removed": int(removed.sum()), "ghosts": n_ghosts,
        "brushed": int(sel_mask.sum()), "added": int(added.n),
        "rim_splats": int(len(rim_idx)), "surface_splats": int(surf.sum()),
        "hole_radius": round(radius, 4), "hole_width": round(width, 4),
        "spacing": round(spacing, 5),
        "cell": round(cell, 5), "grid": [int(nu), int(nv)],
        "target_cells": n_target, "per_cell": round(per_cell, 3),
        "haze_dropped": n_haze, "backing": n_back,
        "zones_bridged": n_bridged, "empty_sources": n_empty_src,
        "zones_curved": curved, "edge_band": n_band,
        "remnants": n_remnants, "beyond_edge": n_beyond, "volume_cells": n_vol,
        "rim_fold_deg": round(rim_fold, 1), "charts": 1,
        "turn_deg": round(float(np.percentile(turns, 90)) if len(turns) else 0.0, 1),
        "warning": ("painted across an edge: the fill follows only one "
                    "surface; paint the other side separately"
                    if rim_fold > params.fold_warn_deg else None),
        "outward": outward, "tol": round(tol, 4),
        "donor_offset": None if donor_offset is None else [int(x) for x in donor_offset],
        "donor_score": None if not np.isfinite(score) else round(float(score), 5),
        "donor_block_dev": None if block_dev is None else round(block_dev, 3),
        "donor_shifts": n_shifts, "donor_candidates": len(cands),
        "motif": motif_info,
        "relief_clamped": clamped,
        "relief_limit": round(rel_lim, 5) if np.isfinite(rel_lim) else None,
    }
    context = {
        "origin": origin, "basis": basis, "surface": hf,
        "uv_centre": (cu0, cv0), "centre": centre, "radius": radius,
        "outward": outward, "spacing": spacing, "cell": cell,
        "tol": tol, "grid": (lo_u, lo_v, nu, nv),
        "target": target, "fill": fill, "rim_idx": rim_idx,
        "tone": aux.get("tone"), "offsets": field, "void": void,
        "holefoot": holefoot, "covered": covered,
        "surface_idx": sur_idx, "volume": vol,
    }
    back_mask = np.zeros(added.n, bool)
    if n_back:
        back_mask[added.n - n_back:] = True
    if len(cy) == added.n:
        # which cell each copy filled: the slab behind a cell goes with its face
        # (`_drop_bare_backing`)
        context["cell_key"] = (cy * nu + cx).astype(np.int64)
    return RepairResult(removed=np.where(removed)[0], added=added,
                        backing=back_mask, info=info, context=context)


def _drop_bare_backing(keep, backing, key):
    """``keep`` less the slab copies whose cell kept none of its face.

    The slab behind a face is copied so that the face does not show what
    lies behind it; without the face in front it is what shows. Over the
    sole's edge the side's fill took the bottom's copies off the rim, and
    the unrolled edge took them off the band, but the slab under them stayed
    -- pale flecks along the rim (the deeper layers near an edge hold the
    side wall and the upper). ``key``: the cell of every copy; None keeps
    ``keep`` as it is.
    """
    keep = np.asarray(keep, bool)
    if key is None or backing is None or len(key) != len(keep) or len(backing) != len(keep):
        return keep
    backing = np.asarray(backing, bool)
    key = np.asarray(key)
    faced = np.unique(key[keep & ~backing])
    bare = backing & keep & ~np.isin(key, faced)
    return keep & ~bare


def over_cells_hint(params, width, cell):
    """How many cells the fill reaches past the hole; see ``over`` in repair."""
    return int(np.clip(round(params.feather * width / cell), 1, 12))


def _scale_opacity(logit, fade, optical=True):
    """Scale a splat's coverage by ``fade``, back to logit space.

    In optical depth, ``1 - (1 - a)^fade``, not in alpha. The fill is
    built to supply exactly what the surviving surface is missing, and two
    layers faded linearly to ``f a`` and ``(1 - f) a`` come to
    ``a - f (1 - f) a^2`` -- a quarter short at the middle of the seam for
    an opaque surface. Optical depth adds; alpha does not.
    """
    a = 1.0 / (1.0 + np.exp(-logit.astype(np.float64)))
    f = np.clip(fade, 0.0, 1.0)
    a = 1.0 - (1.0 - np.clip(a, 0.0, 1.0 - 1e-6)) ** f if optical else a * f
    a = np.clip(a, 1e-4, 1.0 - 1e-6)
    return np.log(a / (1.0 - a))


def _donors_from_rim(nu_, nv_, uvh_sur, sur_idx, relief, on_rim, s, rng, params):
    """Pick one rim donor per new splat, inverse-distance weighted."""
    pool = np.where(on_rim)[0]
    tree = cKDTree(uvh_sur[pool, :2])
    k = int(min(10, len(pool)))
    d, j = tree.query(np.stack([nu_, nv_], 1), k=k)
    if k == 1:
        d, j = d[:, None], j[:, None]
    w = 1.0 / np.maximum(d, 1e-9)
    w /= w.sum(1, keepdims=True)
    cum = np.cumsum(w, axis=1)
    pick = (cum < rng.random((len(nu_), 1))).sum(1).clip(0, k - 1)
    chosen = pool[j[np.arange(len(nu_)), pick]]
    nbr = pool[j]
    dc = s.f_dc[sur_idx].astype(np.float64)
    idw = np.einsum("nk,nkc->nc", w, dc[nbr])
    shift = params.color_smooth * (idw - dc[chosen])
    return sur_idx[chosen], shift, relief[chosen]


_POOL = []


def _corr_many(jobs):
    """`_corr` of several ``(a, k)`` pairs, in threads; results in order."""
    if len(jobs) < 4:
        return [_corr(a, k) for a, k in jobs]
    if not _POOL:
        from concurrent.futures import ThreadPoolExecutor
        _POOL.append(ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 1)))
    return list(_POOL[0].map(lambda ak: _corr(*ak), jobs))


def _corr(a, k):
    """Correlation of ``a`` with ``k`` for every integer shift.

    ``out[i, j]`` is ``sum_p k[p] * a[p + (i - nv//2, j - nu//2)]``.
    """
    return signal.fftconvolve(a, k[::-1, ::-1], mode="same")


def _foreign_cells(rgb, sv, su, nv, nu, cnt, occ, target, rem_rgb, rem_alpha,
                   k=6.0, gate=0.25, max_share=0.5):
    """Cells of the colour being painted out, where the ring has none of it.

    None unless the stroke removes an object of another colour: a quarter
    of the removed opacity more than ``k`` robust spreads from the ring.
    The hut's red lettering and cross pass (0.83); a patch of a surface
    painted over like itself -- every hold-out disc on the shoe, at most
    0.05 -- does not, and nothing changes there. When it fires, cells far
    from the ring are no source: unchecked, the matcher filled the
    lettering with the cross beside it and the cross with the lettering.
    """
    if len(rem_rgb) == 0:
        return None
    ring = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=3) & ~target & occ
    if ring.sum() < 12:
        return None
    sumR, _ = _accum(rgb, sv, su, nv, nu)
    cR = sumR / np.maximum(cnt, 1e-9)[..., None]
    med = np.median(cR[ring], axis=0)
    mad = np.maximum(1.4826 * np.median(np.abs(cR[ring] - med), axis=0), 0.02)
    dev_rem = (np.abs(np.asarray(rem_rgb, np.float64) - med) / mad).max(-1)
    w = np.asarray(rem_alpha, np.float64)
    if w[dev_rem > k].sum() < gate * max(w.sum(), 1e-12):
        return None
    known = occ & ~target
    far = known & ((np.abs(cR - med) / mad).max(-1) > k)
    if not far.any() or far[known].mean() > max_share:
        return None
    return far

def _foreign_halo(foreign, known, target, h_rem, cell, max_share=0.5):
    """The foreign cells and what a raised object brings round them.

    Painted over the EHBO letters, the fill no longer copied the red cross
    below -- but it copied the wall right beside it: the cross's pale sides,
    its long vertical edge splats and its drop shadow, none of them red.
    Pieced into the hole they drew rectangles and dark vertical lines, which
    read as the outlines of the letters that had been removed. Another
    object of the colour being removed stands out from the surface as far
    as this one did, and its sides and shadow reach about as far across it.
    So the cells within that reach of a foreign cell are no source either.
    ``h_rem``: how far the removed splats stand off the surface. Only a
    raised object counts -- half of what was removed more than three
    spacings (1.5 cells) proud, `objsel`'s own bar: the letters stand 2.3
    cells off the wall, the green print on the brush's heel 1.0 off the
    leather, and there the fill stays as it was.
    """
    if len(h_rem) == 0 or float(np.median(h_rem)) < 1.5 * cell:
        return foreign
    h = float(np.percentile(h_rem, 90))
    reach = int(np.clip(np.floor(h / max(cell, 1e-12)), 0, 6))
    if reach < 1:
        return foreign
    grown = ndimage.binary_dilation(foreign, np.ones((3, 3)), iterations=reach) & ~target
    if known.any() and (grown & known).sum() > max_share * known.sum():
        return foreign
    return grown


def _find_donor_patch(target, occ, relief, rgb, sv, su, nv, nu, cnt,
                      min_cov=0.92, topk=1, avoid=None):
    """Find the translation whose donor region best continues this rim.

    Evaluated for every shift at once by FFT correlation rather than a nested
    loop -- the brush has to feel instant, and this is the only part of the
    pipeline whose cost grows with the search range.
    """
    occf = occ.astype(float)
    occ_c = ndimage.binary_closing(occ, np.ones((3, 3)))
    sumR, _ = _accum(rgb, sv, su, nv, nu)
    sumH, _ = _accum(relief, sv, su, nv, nu)
    c = np.maximum(cnt, 1e-9)
    cR = sumR / c[..., None]
    cH = sumH / c
    cR = np.where(occ[..., None], cR, 0.0)
    cH = np.where(occ, cH, 0.0)

    ring = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=3) & ~target & occ
    if ring.sum() < 12:
        return (None, np.inf, []) if topk > 1 else (None, np.inf)
    m = ring.astype(float)
    span = max(float(np.percentile(np.abs(cH[occ]), 95)), 1e-6)

    # weighted SSD over the ring, expanded so every term is a correlation
    jobs = [(occf * (cH / span) ** 2, m), (occf * (cH / span), m * (cH / span)),
            (occf, m * (cH / span) ** 2)]
    for ch in range(3):
        I = cR[..., ch]
        jobs += [(occf * I * I, m), (occf * I, m * I), (occf, m * I * I)]
    jobs += [(occf, m), (occ_c.astype(float), target.astype(float))]
    cr = _corr_many(jobs)
    num = cr[0] - 2.0 * cr[1] + cr[2]
    num *= 1.2
    for ch in range(3):
        num += 3.0 * (cr[3 + 3 * ch] - 2.0 * cr[4 + 3 * ch] + cr[5 + 3 * ch])
    den = np.maximum(cr[12], 1e-9)
    score = num / den

    # Reference: how well a flat patch of the ring's mean colour would score.
    # Reporting the ratio makes the caller's accept/reject decision scale-free
    # instead of a magic constant that drifts whenever the weights change.
    ref = 0.0
    rv = ring
    for ch in range(3):
        x = cR[..., ch][rv]
        ref += 3.0 * float(np.mean((x - x.mean()) ** 2))
    x = cH[rv] / span
    ref += 1.2 * float(np.mean((x - x.mean()) ** 2))
    ref = max(ref, 1e-9)

    # Coverage is measured against a closed occupancy map. Raw occupancy is
    # Poisson at roughly one splat per cell, so ~a third of cells on a
    # perfectly good surface are empty by chance; testing against it would
    # reject every donor on any sparsely sampled scene.
    cover = cr[13] / max(target.sum(), 1)
    # A sparse shell -- a translucent scan whose 3-D spacing comes from many
    # layers -- leaves the 3x3 closing full of holes, and no shift reaches
    # the bar: 2 of 4608 on the hut's cross (closed occupancy round the
    # hole 0.75, against at least 0.97 on the shoe). Only there, close wider.
    foot = ndimage.binary_closing(occ, np.ones((9, 9))) & ~target
    if foot.any() and occ_c[foot].mean() < 0.85:
        k_close = 3
        while occ_c[foot].mean() < 0.85 and k_close < 9:
            k_close += 2
            occ_c = ndimage.binary_closing(occ, np.ones((k_close, k_close)))
        cover = _corr(occ_c.astype(float), target.astype(float)) / max(target.sum(), 1)
    valid = (cover >= min_cov) & (den > 0.5 * ring.sum())
    # What the block holds, not only how its edge fits: the share of it in
    # the colour being painted out (see `_foreign_cells`; None elsewhere).
    far_share = (_corr(avoid.astype(float), target.astype(float)) / max(target.sum(), 1)
                 if avoid is not None else 0.0)

    yy, xx = np.mgrid[0:nv, 0:nu]
    dy, dx = yy - nv // 2, xx - nu // 2
    # keep the donor block inside the grid
    ty, tx = np.where(target)
    valid &= (ty.min() + dy >= 0) & (ty.max() + dy < nv)
    valid &= (tx.min() + dx >= 0) & (tx.max() + dx < nu)
    valid &= (np.abs(dy) > 3) | (np.abs(dx) > 3)
    ry, rx = np.where(ring)
    valid &= (ry.min() + dy >= 0) & (ry.max() + dy < nv)
    valid &= (rx.min() + dx >= 0) & (rx.max() + dx < nu)
    if not valid.any():
        return (None, np.inf, []) if topk > 1 else (None, np.inf)

    total = score + 2.0e-5 * ref * (dy * dy + dx * dx) \
        + 0.8 * ref * np.clip(1.0 - cover, 0, 1) + 4.0 * ref * far_share
    total = np.where(valid, total, np.inf)
    i = int(np.argmin(total))
    by, bx = i // nu, i % nu
    best = (int(by - nv // 2), int(bx - nu // 2)), float(score[by, bx] / ref)
    if topk <= 1:
        return best

    # The best few translations, not just the best one, kept well apart so
    # they are genuinely different placements rather than one placement and
    # its neighbours. The caller mixes them per cell.
    cands, work = [], total.copy()
    sep = max(4, int(0.15 * min(nv, nu)))
    for _ in range(topk):
        i = int(np.argmin(work))
        if not np.isfinite(work.flat[i]):
            break
        yy_, xx_ = i // nu, i % nu
        cands.append(((int(yy_ - nv // 2), int(xx_ - nu // 2)),
                      float(score[yy_, xx_] / ref)))
        y0, y1 = max(0, yy_ - sep), min(nv, yy_ + sep + 1)
        x0, x1 = max(0, xx_ - sep), min(nu, xx_ + sep + 1)
        work[y0:y1, x0:x1] = np.inf
    return best[0], best[1], cands


def _shift(a, dy, dx, fill=0.0):
    """Shift an array by whole cells, filling what moves in from outside."""
    out = np.full_like(a, fill, dtype=a.dtype if a.dtype != bool else bool)
    ys, yd = (slice(dy, None), slice(None, a.shape[0] - dy)) if dy >= 0 \
        else (slice(None, a.shape[0] + dy), slice(-dy, None))
    xs, xd = (slice(dx, None), slice(None, a.shape[1] - dx)) if dx >= 0 \
        else (slice(None, a.shape[1] + dx), slice(-dx, None))
    out[yd, xd] = a[ys, xs]
    return out


def _source_region(known, target, size=5):
    """Where a source cell may lie: the surface round the hole, empty cells too.

    The grid is only about sixty percent occupied, and demanding an occupied
    source cell made the offset field change candidate at every empty one:
    the stand's hole came out as 426 pieces of about eight cells in 93
    different phases of the lattice, which read as soft although each piece
    was sharp. The window costs still count occupied cells only.
    """
    return (ndimage.binary_closing(known, np.ones((size, size))) & ~target) | known


def _enclosed_zone(lab, known, target, share=0.8, margin=2, fill=0.9, outer_same=0.3):
    """The known cells of the one zone that encloses the hole, or None.

    Four tests, each general: the ring is one zone (at least ``share`` of
    it); that zone, closed over small gaps, wraps the hole and a margin
    (``fill``); it is an island -- clear of the grid's border and bordered by
    other material, which keeps one phase of a lattice from passing, as it
    closes into blobs bordered by more of itself; and it is not most of the
    surface. The label on the shoe's side passes (ring 90 % weave); the
    stand's hole, the heel and the hold-out discs bar one do not.
    """
    ring = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=2) & ~target & known
    if ring.sum() < 12:
        return None, {"why": "ring"}
    labs, cnt = np.unique(lab[ring], return_counts=True)
    j = int(labs[np.argmax(cnt)])
    sh = float(cnt.max() / cnt.sum())
    if sh < share:
        return None, {"why": "mixed", "share": round(sh, 2)}
    zone = ndimage.binary_closing((lab == j) & known, np.ones((5, 5)))
    comp, _ = ndimage.label(zone | target)
    lbl_hole = np.unique(comp[target])
    lbl_hole = lbl_hole[lbl_hole > 0]
    if len(lbl_hole) != 1:
        return None, {"why": "split"}
    region = comp == lbl_hole[0]
    if region[0].any() or region[-1].any() or region[:, 0].any() or region[:, -1].any():
        return None, {"why": "border", "share": round(sh, 2)}
    outer = ndimage.binary_dilation(region, np.ones((3, 3)), iterations=3) & ~region & known
    if outer.sum() >= 12 and float((lab[outer] == j).mean()) > outer_same:
        return None, {"why": "same outside", "share": round(sh, 2)}
    grown = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=margin)
    if float(ndimage.binary_fill_holes(region)[grown].mean()) < fill:
        return None, {"why": "open", "share": round(sh, 2)}
    allowed = (lab == j) & known
    if float(allowed.sum()) / max(int(known.sum()), 1) > 0.5:
        return None, {"why": "whole", "share": round(sh, 2)}
    return allowed, {"why": "enclosed", "label": j, "share": round(sh, 2)}


def _lloyd(pts, cent, iters):
    """Lloyd's algorithm from `cent` until the assignment stops changing."""
    p2 = (pts ** 2).sum(1)
    lab = None
    for _ in range(iters):
        new = (p2[:, None] - 2.0 * (pts @ cent.T) + (cent ** 2).sum(1)[None]).argmin(1)
        if lab is not None and np.array_equal(new, lab):
            break
        lab = new
        cnt = np.bincount(lab, minlength=len(cent))
        ok = cnt > 0
        cent = cent.copy()
        cent[ok] = (np.eye(len(cent))[lab].T @ pts)[ok] / cnt[ok, None]
    d = p2[:, None] - 2.0 * (pts @ cent.T) + (cent ** 2).sum(1)[None]
    lab = d.argmin(1)
    return cent, lab, float(np.maximum(d[np.arange(len(pts)), lab], 0.0).sum())


def _same_partition(a, b, k):
    """Share of points two labelings agree on, after the best renaming."""
    M = np.bincount(a * k + b, minlength=k * k).reshape(k, k)
    r, c = linear_sum_assignment(-M)
    return float(M[r, c].sum()) / max(len(a), 1)


def _modal_kmeans(pts, k, starts=16, stride=3, iters=100, same=0.97, seed=0):
    """Centroids of the partition most random starts converge to, in a fixed order.

    One random start, as before, was luck: it drew its centres from the
    known cells by index, so a 1 % change in which cells count as known --
    a stiffer reference surface, or a slightly different stroke -- drew
    other centres, and twelve iterations from there left the zones wherever
    they happened to be. On the stand hole the plaque came out as zone 0
    instead of 2, its band 1168 cells instead of 1335, and it went needly.

    The partition with the least inertia is no answer either: on the stand
    hole it is a rare one (a few starts in sixty) that splits the lattice
    and merges the plaque into it. Fifty of sixty starts end in one
    partition, and that one carries the plaque as a zone of its own. So run
    many starts to convergence on a fixed subsample of the cells, group the
    partitions that agree on `same` of the points, take the largest group,
    refine its best member on all points, and number the zones by their
    centroid's position along the data's main axis, so the same zones get
    the same numbers -- the steps after this one are not quite blind to the
    numbering.
    """
    sub = pts[::stride] if len(pts) >= 64 * stride else pts
    rng = np.random.default_rng(seed)
    groups = []
    for _ in range(starts):
        cent, lab, inertia = _lloyd(sub, sub[rng.choice(len(sub), k, replace=False)].astype(float), iters)
        for g in groups:
            if _same_partition(g["lab"], lab, k) > same:
                g["n"] += 1
                if inertia < g["inertia"]:
                    g.update(cent=cent, lab=lab, inertia=inertia)
                break
        else:
            groups.append(dict(n=1, cent=cent, lab=lab, inertia=inertia))
    best = max(groups, key=lambda g: (g["n"], -g["inertia"]))
    cent, lab, _ = _lloyd(pts, best["cent"].copy(), iters)
    mu = pts.mean(0)
    axis = np.linalg.svd(pts - mu, full_matrices=False)[2][0]
    if np.mean(((pts - mu) @ axis) ** 3) < 0:
        axis = -axis                      # the sign of an eigenvector is arbitrary
    return cent[np.argsort((cent - mu) @ axis)]


def _region_labels(feat, known, target, k=3, smooth=7, iters=100, seed=0):
    """Split the surface into its few kinds of area, and name them.

    A sole is not one texture. It has a pebbled band round the rim, a field
    of diamonds, and a smooth plaque with a raised border, and a search that
    knows nothing about this runs diamonds over all three -- it has no reason
    not to, since a diamond patch is just as good a match for a patch of
    plaque as anything else once the plaque has been averaged away by the
    window.

    So label the kinds first, from what distinguishes them at a glance:
    colour and relief at a coarse scale, where a tread is dark-and-busy and a
    plaque is pale-and-flat. k-means on those numbers, with the partition
    chosen as the one most starts reach (`_modal_kmeans`), so the zones do
    not depend on a random start or on a few cells. The labels then ride along as extra channels in the
    descriptor, so a match that crosses from one kind to another pays for it
    -- "texture by numbers", after Hertzmann and others' image analogies, and
    the mechanism Barnes and others use for the same purpose in PatchMatch.
    """
    nv, nu, _ = feat.shape
    m = known.astype(np.float64)
    den = np.maximum(ndimage.uniform_filter(m, smooth), 1e-9)
    low = np.stack([ndimage.uniform_filter(feat[..., c] * m, smooth) / den
                    for c in range(feat.shape[2])], -1)
    # how busy the neighbourhood is: the plaque's tell
    rough = np.stack([
        np.sqrt(np.maximum(
            ndimage.uniform_filter((feat[..., c] ** 2) * m, smooth) / den
            - low[..., c] ** 2, 0.0)) for c in range(feat.shape[2])], -1)
    X = np.concatenate([low, 2.0 * rough], -1)
    pts = X[known]
    if len(pts) < 64:
        return None
    cent = _modal_kmeans(pts, k, iters=iters, seed=seed)
    full = np.argmin(((X.reshape(-1, X.shape[-1])[:, None, :] - cent[None]) ** 2)
                     .sum(-1), 1).reshape(nv, nu)

    # Inside the hole the coarse features are the far wall's, so the label
    # there means nothing and has to come from outside. Carrying in the
    # nearest known label is the obvious way and it is wrong: drawn out, the
    # hole came back as a fan of five arbitrary wedges meeting in the middle,
    # a Voronoi diagram of whatever happened to sit on the rim. Zones that
    # shape are worse than none, because the search then pays a price for
    # crossing boundaries that are not there.
    #
    # Each label is an indicator, so extend the indicators instead and take
    # the winner. A membrane extension obeys the maximum principle, so a
    # band that enters the hole on two opposite sides comes out joined across
    # it, and a label that only grazes the rim stays a fringe instead of
    # claiming a wedge. The small smoothing first is for the same reason the
    # features are low-passed: a single cell's label is noise.
    oh = np.stack([(full == j).astype(np.float64) for j in range(k)], -1)
    oh = (ndimage.uniform_filter(oh * m[..., None], (3, 3, 1))
          / np.maximum(ndimage.uniform_filter(m, 3), 1e-9)[..., None])
    ext = fit_reference_surface(oh, known, smooth_cells=3.0, plate=False, fast=True)
    lab = np.argmax(ext, -1).astype(np.int64)
    # Beside a free edge the membrane is still wrong: it bulges a band that
    # runs along the edge into a blob as deep as the hole. There the zones
    # are continued along the edge instead.
    return _labels_along_edge(lab, known, target)


def _nearest_component(mask, target):
    """The connected part of ``mask`` that lies nearest the hole."""
    lbl, n = ndimage.label(mask)
    if n <= 1:
        return mask
    ys, xs = np.where(target)
    d = [ndimage.distance_transform_edt(lbl != j)[ys, xs].min() for j in range(1, n + 1)]
    return lbl == (int(np.argmin(d)) + 1)


def _edge_void(known, target, frac=0.85, min_cells=8):
    """The void beyond a real edge of the surface, or None.

    The empty margin round the sampled neighbourhood is not an edge: void
    cells beyond ``frac`` of the sampled radius are dropped.
    """
    void = _void_mask(known, target)
    if not void.any() or not target.any():
        return None
    nv, nu = known.shape
    ys, xs = np.where(target)
    yy, xx = np.mgrid[0:nv, 0:nu]
    rd = np.hypot(yy - ys.mean(), xx - xs.mean())
    v = ndimage.binary_opening(void & (rd < frac * float(rd[known].max())), np.ones((3, 3)))
    return _nearest_component(v, target) if v.sum() >= min_cells else None


def _band_depth(lab, known, target, d_edge, reach=40):
    """How deep the bands along the edge reach, in cells (0 = no band).

    The majority zone per distance from the edge, over known cells near the
    hole; the field is the majority of the far half, and the band depth is
    where the rows stop differing from it.
    """
    near = known & ndimage.binary_dilation(target, np.ones((3, 3)), iterations=reach)
    dq = np.rint(d_edge).astype(np.int64)
    k = int(lab.max()) + 1
    maj = []
    for d in range(reach + 1):
        m = near & (dq == d)
        maj.append(int(np.argmax(np.bincount(lab[m], minlength=k))) if m.sum() >= 6 else -1)
    maj = np.array(maj)
    good = maj[maj >= 0]
    if len(good) < 4:
        return 0.0
    field = int(np.bincount(good[len(good) // 2:]).argmax())
    db = 0
    for d in range(len(maj)):
        if maj[d] == field:
            break
        if maj[d] >= 0:
            db = d + 1
    return float(db)


_BAND_MARGIN = [4.0]


def _edge_band_dzone(kn, target, lab, past=1.5, min_reach=40):
    """Edge distance capped at the band depth, as a depth price; or None."""
    if lab is None:
        return None, 0.0
    void = _edge_void(kn, target)
    if void is None:
        return None, 0.0
    d = ndimage.distance_transform_edt(~void)
    ys, xs = np.where(target)
    if d[ys, xs].min() > min_reach:
        return None, 0.0
    db = _band_depth(lab, kn, target, d)
    if db <= 0 or d[ys, xs].max() < past * db:
        return None, db
    if d[ys, xs].min() >= db:
        return None, db
    return np.minimum(d, db + _BAND_MARGIN[0]), db


def _void_mask(known, target):
    """Cells beyond the surface's edge: large empty regions, not islands."""
    surf = ndimage.binary_closing(known | target, np.ones((5, 5)))
    empty = ~surf
    lbl, n = ndimage.label(empty)
    if n == 0:
        return np.zeros_like(known)
    border = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
    return np.isin(lbl, border[border > 0])


def _edge_tangent(void, target, reach=14):
    """Unit tangent (dy, dx) of the surface edge near the hole, or None.

    The orientation is averaged with doubled angles, so two parallel edges
    either side of the hole agree. The principal axis of the edge cells,
    the obvious alternative, gives the axis across them.
    """
    edge = ndimage.binary_dilation(void, np.ones((3, 3))) & ~void
    near = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=reach)
    ys, xs = np.where(edge & near)
    if len(ys) < 8:
        return None
    g = ndimage.gaussian_filter(void.astype(float), 3.0)
    gy, gx = np.gradient(g)
    ang = np.arctan2(gy[ys, xs], gx[ys, xs])
    w = np.hypot(gy[ys, xs], gx[ys, xs])
    c, s_ = (w * np.cos(2 * ang)).sum(), (w * np.sin(2 * ang)).sum()
    if np.hypot(c, s_) < 1e-9:
        return None
    nrm = 0.5 * np.arctan2(s_, c)
    return np.array([np.cos(nrm), -np.sin(nrm)])


def _labels_along_edge(lab, known, target, reach=40, tau=10.0, tol=1.5):
    """Continue the zones through the hole along the surface's edge.

    Each hole cell takes the label that known cells at the same distance
    from the edge carry nearby along it, nearer ones counting more. A band
    round the rim keeps its width and a field stays a field. Holes with no
    edge in reach (every interior hole) keep the membrane answer.
    """
    void = _void_mask(known, target)
    if not void.any():
        return lab
    t = _edge_tangent(void, target)
    d_edge = ndimage.distance_transform_edt(~void)
    ys, xs = np.where(target)
    if t is None or len(ys) == 0 or d_edge[ys, xs].min() > reach:
        return lab
    k = int(lab.max()) + 1
    tc = (np.arange(lab.shape[0])[:, None] * t[0]
          + np.arange(lab.shape[1])[None, :] * t[1])
    ky, kx = np.where(known & ndimage.binary_dilation(
        target, np.ones((3, 3)), iterations=reach))
    dk, tk, lk = d_edge[ky, kx], tc[ky, kx], lab[ky, kx]
    order = np.argsort(dk)
    dk_s = dk[order]
    out = lab.copy()
    for i in range(len(ys)):
        d0, t0 = d_edge[ys[i], xs[i]], tc[ys[i], xs[i]]
        a, b = np.searchsorted(dk_s, d0 - tol), np.searchsorted(dk_s, d0 + tol)
        j = order[a:b]
        if len(j) < 4:
            continue
        w = np.exp(-np.abs(tk[j] - t0) / tau)
        out[ys[i], xs[i]] = np.argmax(np.bincount(lk[j], weights=w, minlength=k))
    oh = ndimage.uniform_filter(
        np.stack([(out == j).astype(float) for j in range(k)], -1), (3, 3, 1))
    return np.where(target, np.argmax(oh, -1), out).astype(np.int64)


def _bridge_zones(lab, target, k, reach=8.0, max_area=0.25, max_width=8):
    """Carry a band across the hole instead of letting it dissolve inside it.

    The membrane extension in `_region_labels` is right for a region and
    wrong for a stripe. Harmonic interpolation of an indicator falls off with
    distance from the data, so a border three cells wide that enters the hole
    on one side and leaves it on the other comes back as nothing: the two
    stumps lose the argmax to whatever fills the middle. The sole's raised
    border arc is exactly that shape, and so is the edge of the pebbled band,
    and both are things the user has asked for by name.

    So treat a stripe as a stripe. Where a label touches the hole's rim in
    exactly two places and is not the background, read its direction at each
    contact from the band's own principal axis, and join the two with the
    cubic that leaves along one and arrives along the other. That is Sun and
    others' structure propagation with the curve found rather than drawn: a
    straight chord where the band runs straight, and a curve of the right
    bend where it is an arc, because a Hermite with tangent length equal to
    the gap collapses to the chord exactly when both tangents point along it.

    Stamped into the label field before the offsets are solved, so the
    matching sees a band to follow and pays `zone_weight` for leaving it.
    """
    out = lab.copy()
    nv, nu = lab.shape
    rim = ndimage.binary_dilation(target, np.ones((3, 3))) & ~target
    n_known = max(int((~target).sum()), 1)
    eight = np.ones((3, 3))
    bridged = 0
    for j in range(k):
        mask = (lab == j) & ~target
        area = int(mask.sum())
        if area < 12 or area > max_area * n_known:
            continue                       # nothing, or the background
        comp, nc = ndimage.label(mask & rim, structure=eight)
        if nc != 2:
            continue                       # not a band crossing this hole
        by, bx = np.where(mask)
        ends, widths = [], []
        for c in (1, 2):
            ys, xs = np.where(comp == c)
            p = np.array([ys.mean(), xs.mean()])
            near = np.hypot(by - p[0], bx - p[1]) < reach
            if near.sum() < 6:
                ends = []
                break
            X = np.stack([by[near] - by[near].mean(),
                          bx[near] - bx[near].mean()], 1)
            w, v = np.linalg.eigh(X.T @ X)
            ends.append((p, v[:, -1]))
            # the band's width is its spread across its own axis
            widths.append(2.0 * np.sqrt(max(w[0] / max(near.sum() - 1, 1), 0.25)))
        if len(ends) != 2:
            continue
        (pA, tA), (pB, tB) = ends
        d = pB - pA
        L = float(np.hypot(*d))
        if L < 2.0:
            continue
        tA = tA * np.sign(np.dot(tA, d) or 1.0)
        tB = tB * np.sign(np.dot(tB, d) or 1.0)
        t = np.linspace(0.0, 1.0, int(4 * L) + 4)[:, None]
        h00 = 2 * t ** 3 - 3 * t ** 2 + 1
        h10 = t ** 3 - 2 * t ** 2 + t
        h01 = -2 * t ** 3 + 3 * t ** 2
        h11 = t ** 3 - t ** 2
        pts = h00 * pA + h10 * (L * tA) + h01 * pB + h11 * (L * tB)
        yy = np.clip(np.rint(pts[:, 0]).astype(np.int64), 0, nv - 1)
        xx = np.clip(np.rint(pts[:, 1]).astype(np.int64), 0, nu - 1)
        line = np.zeros((nv, nu), bool)
        line[yy, xx] = True
        half = int(np.clip(round(0.5 * float(np.mean(widths))), 1, max_width))
        line = ndimage.binary_dilation(line, eight, iterations=half)
        out[line & target] = j
        bridged += 1
    return out, bridged


def _clean_labels(lab, surf, k, min_area=60):
    """Absorb islands of a zone smaller than `min_area` into what surrounds them.

    The zone map is read off low-passed features and still holds specks --
    a dark scuff labelled as a rim band in the middle of the plaque -- and a
    speck on the hole's rim is a false end for a curve.
    """
    out = lab.copy()
    for _ in range(2):
        for j in range(k):
            comp, n = ndimage.label((out == j) & surf)
            if n == 0:
                continue
            sizes = ndimage.sum(np.ones_like(comp), comp, np.arange(1, n + 1))
            for c in np.where(sizes < min_area)[0] + 1:
                m = comp == c
                rim = ndimage.binary_dilation(m, np.ones((3, 3))) & ~m & surf
                if rim.any():
                    out[m] = np.bincount(out[rim], minlength=k).argmax()
    return out


_N8 = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def _hole_outline(region):
    """Boundary cells of the largest component of `region`, in order (Moore tracing)."""
    comp, n = ndimage.label(region, np.ones((3, 3)))
    if n == 0:
        return np.zeros((0, 2), int)
    big = comp == (np.argmax(ndimage.sum(region, comp, np.arange(1, n + 1))) + 1)
    big = ndimage.binary_fill_holes(big)
    P = np.pad(big, 1)
    ys, xs = np.where(P)
    i = np.lexsort((xs, ys))[0]
    start = (int(ys[i]), int(xs[i]))
    pts = [start]
    cur, back = start, 6
    for _ in range(4 * P.size):
        found = False
        for k in range(8):
            d = (back + 1 + k) % 8
            ny, nx = cur[0] + _N8[d][0], cur[1] + _N8[d][1]
            if P[ny, nx]:
                back = (d + 4) % 8
                cur = (ny, nx)
                found = True
                break
        if not found or cur == start:
            break
        pts.append(cur)
    return np.array(pts) - 1


def _outline_labels(pts, lab, surf, rad=2):
    """The zone seen just outside each outline cell; -1 where there is no surface."""
    nv, nu = lab.shape
    k = int(lab.max()) + 1
    out = np.full(len(pts), -1)
    for i, (y, x) in enumerate(pts):
        y0, y1 = max(y - rad, 0), min(y + rad + 1, nv)
        x0, x1 = max(x - rad, 0), min(x + rad + 1, nu)
        m = surf[y0:y1, x0:x1]
        if m.sum() >= 2:
            out[i] = np.bincount(lab[y0:y1, x0:x1][m], minlength=k).argmax()
    return out


def _cyclic_runs(seq):
    """Runs (value, start, length) of a closed sequence."""
    n = len(seq)
    if n == 0:
        return []
    ch = np.where(seq != np.roll(seq, 1))[0]
    if len(ch) == 0:
        return [(int(seq[0]), 0, n)]
    return [(int(seq[a]), int(a), int(b - a)) for a, b in zip(ch, np.r_[ch[1:], ch[0] + n])]


def _absorb_short_runs(seq, gap):
    """Merge runs shorter than `gap` into a neighbour, a sandwiched one first.

    Smallest-first alone is wrong: on the stand hole a ten-cell tongue of
    lattice split the plaque's contact, and the plaque's own nine-cell stub
    beside it went to the rim band first, so the plaque lost its wide end.
    """
    seq = seq.copy()
    for _ in range(400):
        rs = _cyclic_runs(seq)
        if len(rs) <= 2:
            break
        short = [(i, r) for i, r in enumerate(rs) if r[2] < gap]
        if not short:
            break
        sand = [(i, r) for i, r in short if rs[i - 1][0] == rs[(i + 1) % len(rs)][0]]
        i, r = min(sand or short, key=lambda ir: ir[1][2])
        prv, nxt = rs[i - 1], rs[(i + 1) % len(rs)]
        fill = prv[0] if (prv[0] == nxt[0] or prv[2] >= nxt[2]) else nxt[0]
        seq[(np.arange(r[1], r[1] + r[2])) % len(seq)] = fill
    return seq


def _branch_tangent(p, lab, surf, j, reach, inward):
    """Direction into the hole of zone j's boundary where it meets the rim at p.

    Principal axis of the boundary cells connected to p's neighbourhood within
    `reach`, weighted towards p; signed by the hole's inward normal (pointing
    from the branch towards p gave the wrong sign where the boundary hugs the
    rim). Also returns how line-like the branch is, as the eigenvalue ratio.
    """
    own = (lab == j) & surf
    oth = (lab != j) & surf
    edge = (own & ndimage.binary_dilation(oth, np.ones((3, 3)))) | (
        oth & ndimage.binary_dilation(own, np.ones((3, 3))))
    nv, nu = lab.shape
    y0, y1 = max(p[0] - reach, 0), min(p[0] + reach + 1, nv)
    x0, x1 = max(p[1] - reach, 0), min(p[1] + reach + 1, nu)
    E = edge[y0:y1, x0:x1]
    comp, _ = ndimage.label(E, np.ones((3, 3)))
    yy, xx = np.mgrid[y0:y1, x0:x1]
    d = np.hypot(yy - p[0], xx - p[1])
    seeds = np.unique(comp[(d <= 3.0) & E])
    seeds = seeds[seeds > 0]
    if len(seeds) == 0:
        return None, 0.0
    m = np.isin(comp, seeds) & (d <= reach)
    if m.sum() < 6:
        return None, 0.0
    X = np.stack([yy[m], xx[m]], 1).astype(float)
    w = 1.0 / (1.0 + d[m])
    mu = (X * w[:, None]).sum(0) / w.sum()
    ev, v = np.linalg.eigh(((X - mu).T * w) @ (X - mu) / w.sum())
    t = v[:, -1]
    if np.dot(t, inward) < 0:
        t = -t
    return t, float(ev[-1] / max(ev[0], 1e-6))


def _hermite_curve(pA, tA, pB, tB):
    """Cubic from pA leaving along tA to pB arriving along tB; tangent length = chord."""
    L = float(np.hypot(*(pB - pA)))
    t = np.linspace(0.0, 1.0, int(4 * L) + 4)[:, None]
    return ((2 * t ** 3 - 3 * t ** 2 + 1) * pA + (t ** 3 - 2 * t ** 2 + t) * (L * tA)
            + (-2 * t ** 3 + 3 * t ** 2) * pB + (t ** 3 - t ** 2) * (L * tB))


def _in_polygon(poly, ys, xs):
    """Even-odd point-in-polygon test for many points."""
    py, px = poly[:, 0], poly[:, 1]
    qy, qx = np.roll(py, -1), np.roll(px, -1)
    inside = np.zeros(len(ys), bool)
    for a in range(len(py)):
        y0, x0, y1, x1 = py[a], px[a], qy[a], qx[a]
        if y0 == y1:
            continue
        cond = (y0 > ys) != (y1 > ys)
        inside ^= cond & (xs < x0 + (ys - y0) * (x1 - x0) / (y1 - y0))
    return inside


def _curves_touch(P, Q):
    if len(P) < 6 or len(Q) < 6:
        return False
    d, _ = cKDTree(Q[2:-2]).query(P[2:-2])
    return bool((d < 1.0).any())


def _trim_run(raw, j, run, n):
    """Run (label, start, length) shrunk to its first and last cell that read j."""
    idx = (run[1] + np.arange(run[2])) % n
    own = np.where(raw[idx] == j)[0]
    if len(own) == 0:
        return run
    return (run[0], int(idx[own[0]]), int(own[-1] - own[0] + 1))


def _bridge_curves(lab, known, target, surf, k, min_run=6, gap=12, reach=10,
                   max_area=0.25, min_lin=2.5, max_turn=110.0, max_dev=70.0,
                   max_chord=1.2, edge_w=12.0, margin=4, cap=6.0):
    """A band crossing the hole, completed between its two continued boundaries.

    `_bridge_zones` draws a band's centre line at a fixed width and needs
    exactly two contacts; the plaque on the sole touches the stand hole three
    times, and its width changes across the hole. Here the hole's outline is
    read in order, short runs are merged, and a zone with two long runs gets
    its four ends joined pairwise by Hermite cubics that leave along the
    zone's own boundary there -- Sun and others' structure propagation with
    the curves found rather than drawn. The polygon of run, curve, run, curve
    is the band.

    Each test below is a reason to change nothing: a band along the surface's
    edge (`_labels_along_edge` continues those), an end without a line-like
    boundary, a curve that turns too far, strays from its chord or leaves the
    hole, two curves that touch, or a band larger than most of the hole. On
    the wide stroke one end had no line to follow, and the fill built on its
    guess was a pale smear, so a missing tangent is a rejection, not a chord.
    None of the sixteen hold-out discs fires.

    Returns (labels, sdz, info): the stamped labels, and the signed depth into
    the band (clipped to +-cap) with NaN on hole cells farther than `margin`
    from a curve and outside the band.
    """
    info = {}
    out = lab.copy()
    pts = _hole_outline(target)
    if len(pts) < 20:
        return out, None, info
    raw = _outline_labels(pts, lab, surf)
    seq = _absorb_short_runs(raw, gap)
    n = len(seq)
    rs = _cyclic_runs(seq)
    n_known = max(int(surf.sum()), 1)
    grown = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=2)
    diam = float(max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1]))) + 1.0
    gy, gx = np.gradient(ndimage.gaussian_filter(target.astype(float), 2.0))
    void = ~(surf | target) & ~known
    d_edge = ndimage.distance_transform_edt(~void) if void.any() else np.full(lab.shape, 1e9)
    near = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=20) & surf
    curves_all, zones = [], []
    for j in range(k):
        area = int(((lab == j) & surf).sum())
        if area < 12 or area > max_area * n_known:
            continue                       # nothing, or the background
        mj = near & (lab == j)
        if mj.sum() and float(np.median(d_edge[mj])) < edge_w:
            continue                       # a band along the edge
        mine = sorted([r for r in rs if r[0] == j and r[2] >= min_run], key=lambda r: -r[2])
        if len(mine) < 2:
            continue
        # Absorbing short runs can carry a run's end onto a neighbour's
        # stretch, up to `gap` cells from where the zone's own boundary meets
        # the rim, and the tangent read there finds no boundary to follow. In
        # the band test a two-cell rind of mixed cells between band and field
        # did that, and the curve step fired at one density in four.
        A, B = [_trim_run(raw, j, r, n) for r in sorted(mine[:2], key=lambda r: r[1])]
        a0, a1 = A[1], (A[1] + A[2] - 1) % n
        b0, b1 = B[1], (B[1] + B[2] - 1) % n
        ok, curves = True, []
        for e0, e1 in ((a1, b0), (b1, a0)):
            p0, p1 = pts[e0].astype(float), pts[e1].astype(float)
            t0, l0 = _branch_tangent(pts[e0], lab, surf, j, reach,
                                     np.array([gy[tuple(pts[e0])], gx[tuple(pts[e0])]]))
            t1, l1 = _branch_tangent(pts[e1], lab, surf, j, reach,
                                     np.array([gy[tuple(pts[e1])], gx[tuple(pts[e1])]]))
            if t0 is None or t1 is None or min(l0, l1) < min_lin:
                ok = False
                break
            if np.degrees(np.arccos(np.clip(np.dot(t0, -t1), -1, 1))) > max_turn:
                ok = False
                break
            ch = p1 - p0
            L = float(np.hypot(*ch))
            if L < 2.0 or L > max_chord * diam:
                ok = False
                break
            ch = ch / L
            if max(np.degrees(np.arccos(np.clip(np.dot(t0, ch), -1, 1))),
                   np.degrees(np.arccos(np.clip(np.dot(-t1, ch), -1, 1)))) > max_dev:
                ok = False
                break
            c = _hermite_curve(p0, t0, p1, -t1)
            iy = np.clip(np.rint(c[:, 0]).astype(int), 0, lab.shape[0] - 1)
            ix = np.clip(np.rint(c[:, 1]).astype(int), 0, lab.shape[1] - 1)
            if grown[iy, ix].mean() < 0.9:
                ok = False
                break
            curves.append(c)
        if not ok or _curves_touch(curves[0], curves[1]):
            continue
        ia = (a0 + np.arange(A[2])) % n
        ib = (b0 + np.arange(B[2])) % n
        poly = np.concatenate([pts[ia], curves[0], pts[ib], curves[1]]).astype(float)
        ty, tx = np.where(target)
        inside = _in_polygon(poly, ty + 0.0, tx + 0.0)
        if inside.sum() < 6 or inside.sum() > 0.6 * len(ty):
            continue
        out[ty[inside], tx[inside]] = j
        curves_all += curves
        zones.append(j)
        info.setdefault("bridged", []).append((j, int(inside.sum())))
    if not zones:
        return out, None, info
    comp = surf | target
    sdz = np.full(lab.shape, -cap)
    for j in zones:
        own = (out == j) & comp
        sd = ndimage.distance_transform_edt(own) - ndimage.distance_transform_edt(~own)
        sdz = np.maximum(sdz, np.clip(sd, -cap, cap))
    line = np.zeros(lab.shape, bool)
    for c in curves_all:
        line[np.clip(np.rint(c[:, 0]).astype(int), 0, lab.shape[0] - 1),
             np.clip(np.rint(c[:, 1]).astype(int), 0, lab.shape[1] - 1)] = True
    act = target & ((ndimage.distance_transform_edt(~line) <= margin)
                    | (np.isin(out, zones) & target))
    sdz = np.where(target & ~act, np.nan, sdz)
    info["zones"] = zones
    return out, sdz, info


def _texture_energy(feat, known, win=5):
    """Local variance of relief and colour over the occupied cells."""
    m = known.astype(float)
    den = np.maximum(ndimage.uniform_filter(m, win), 1e-9)
    E = np.zeros(known.shape)
    for c in range(4):
        mu = ndimage.uniform_filter(feat[..., c] * m, win) / den
        E += np.maximum(ndimage.uniform_filter(feat[..., c] ** 2 * m, win) / den - mu ** 2, 0)
    return E


def _smooth_band(target, known, sdz, lab, feat, sv, su, s, sur_idx, params):
    """Interior of a stamped smooth band, and the plain splats to scatter there.

    Returns (cells, pool, tree) or None. The border is as wide as the zone's
    own profile says: brightness by depth into the zone, against its interior
    level, and the deepest depth still deviating by `curve_border_thr` of the
    most. On the plaque that profile peaks at three cells in (0.46 against an
    interior of 0.37 and a lattice of 0.29) and the border came out 3.5 cells.

    Only a smooth zone qualifies -- median texture energy at most
    `curve_smooth_ratio` of the surface's; the plaque reads 0.71. The pool is
    its deep, plain cells' splats, the less elongated half, and a brightness
    window (10th to 55th percentile) that leaves out the pale arrow and the
    letters: a rigid copy of the whole zone tried first carried those in.
    """
    sd = np.where(np.isnan(sdz), -99.0, sdz)
    deep = target & (sd >= 1.5)
    j = int(np.bincount(lab[deep]).argmax()) if deep.any() else 0
    cap = float(np.nanmax(sdz))
    near = known & ~target & (lab == j) & (ndimage.distance_transform_edt(~target) <= 25)
    br = feat[..., 1:4].mean(-1)
    prof, se = [], []
    for d in range(0, int(cap)):
        m = near & (np.rint(sd) == d)
        prof.append(float(br[m].mean()) if m.sum() >= 8 else np.nan)
        se.append(float(br[m].std() / np.sqrt(m.sum())) if m.sum() >= 8 else np.nan)
    inner_ = near & (sd >= cap - 0.5)
    p_in = float(br[inner_].mean()) if inner_.sum() >= 8 else np.nan
    dev = np.abs(np.array(prof) - p_in)
    if np.isfinite(dev).any() and np.isfinite(p_in):
        # A depth is border only if it also stands out of the sampling noise
        # of the two means (2.5 standard errors): with the threshold alone a
        # few cells more or less in the zone moved the border from 3.5 to 5.5
        # cells, and the plaque came back needly.
        se_in = float(br[inner_].std() / np.sqrt(inner_.sum()))
        noise = 2.5 * np.sqrt(np.array(se) ** 2 + se_in ** 2)
        big = np.where((dev > params.curve_border_thr * np.nanmax(dev)) & (dev > noise))[0]
        d_in = float(np.clip((big.max() if len(big) else 1) + 0.5, 1.5, cap - 0.5))
    else:
        d_in = 2.5
    inner = target & (sd >= d_in)
    if inner.sum() < 20:
        return None
    E = _texture_energy(feat, known)
    zone_k = known & (lab == j) & (sd >= 3.0) & ~target
    if zone_k.sum() < 30:
        return None
    ratio = float(np.median(E[zone_k]) / max(np.median(E[known & ~target]), 1e-12))
    if ratio > params.curve_smooth_ratio:
        return None                        # a textured band keeps being copied
    cellok = zone_k & (E <= np.median(E[zone_k]))
    gi = np.asarray(sur_idx)
    sig = s.sigma[gi]
    an = sig.max(1) / np.maximum(sig.min(1), 1e-9)
    bri = s.rgb[gi].mean(1)
    inz = cellok[sv, su]
    if inz.sum() < 30:
        return None
    lo, hi = np.percentile(bri[inz], list(params.curve_pool_bright))
    pool = np.where(inz & (an <= np.percentile(an[inz], params.curve_pool_aniso))
                    & (bri >= lo) & (bri <= hi))[0]
    if len(pool) < 30:
        return None
    return inner, pool, cKDTree(np.stack([sv[pool], su[pool]], 1).astype(float))


def _smooth_band_donors(d2, gy2, gx2, smooth, rng, fy, fx):
    """Scattered splats in a smooth band take a plain donor near their source.

    One of the sixteen pool splats nearest the cell's source, at random, so no
    single splat is stamped across the band.
    """
    inner, pool, tree = smooth
    m = inner[gy2, gx2]
    if not m.any():
        return d2
    src = np.stack([gy2[m] + fy[gy2[m], gx2[m]], gx2[m] + fx[gy2[m], gx2[m]]], 1).astype(float)
    _, nb = tree.query(src, k=min(16, len(pool)))
    pick = nb[np.arange(len(nb)), rng.integers(0, nb.shape[1], len(nb))]
    d2 = d2.copy()
    d2[m] = pool[pick]
    return d2


def _dominant_offsets(feat, known, k=20, min_shift=3, smooth=1.2):
    """The translations by which this surface repeats itself.

    Where a pattern repeats, a copy of it shifted by one period lies almost
    exactly on top of itself, and the shifts for which that is true are the
    lattice vectors. Finding them costs four correlations over the known
    region, and they are worth far more than the translations that merely
    match the ring around the hole, because of one property: two cells
    filled from offsets that differ by a lattice vector place *the same
    content*. Their seam is invisible by construction rather than by luck,
    and the phase of the whole fill is then pinned by the cells at the rim,
    which are the only ones with a side already decided.

    Measured on the shoe, the sole's rows come out at six cells with a
    quarter of the error of anything else -- the tread's period. After
    Kaiming He and Jian Sun, "Statistics of Patch Offsets for Image
    Completion" (ECCV 2012), with their per-patch nearest-neighbour
    histogram replaced by the correlation form already used here.
    """
    nv, nu = known.shape
    M = known.astype(np.float64)
    if M.sum() < 64:
        return []
    jobs = []
    for ch in range(feat.shape[2]):
        I = feat[..., ch]
        jobs += [(M * I * I, M), (M * I, M * I), (M, M * I * I)]
    cr = _corr_many(jobs + [(M, M)])
    num = np.zeros((nv, nu))
    for ch in range(feat.shape[2]):
        num += (cr[3 * ch] - 2.0 * cr[3 * ch + 1] + cr[3 * ch + 2])
    den = cr[-1]
    good = den > 0.05 * M.sum()
    E = np.where(good, num / np.maximum(den, 1e-9), np.inf)

    yy, xx = np.mgrid[0:nv, 0:nu]
    dy, dx = yy - nv // 2, xx - nu // 2
    # A shift of nearly nothing always matches; it says only that the
    # surface is smooth.
    E = np.where((np.abs(dy) > min_shift) | (np.abs(dx) > min_shift), E, np.inf)
    if not np.isfinite(E).any():
        return []
    fill = float(np.max(E[np.isfinite(E)]))
    Es = np.where(np.isfinite(E), ndimage.gaussian_filter(
        np.where(np.isfinite(E), E, fill), smooth), np.inf)
    peaks = np.argwhere((Es == ndimage.minimum_filter(Es, size=7))
                        & np.isfinite(Es))
    if not len(peaks):
        return []
    order = np.argsort(Es[peaks[:, 0], peaks[:, 1]])[:k]
    return [(int(peaks[i, 0] - nv // 2), int(peaks[i, 1] - nu // 2))
            for i in order]


def _motif_map(feat, known, target, frac=0.25, jitter=1, sig=1.0, win=25,
               ring_w=6, reach=6.0):
    """How much of a motif each source cell sits in, and what the hole allows.

    A texture repeats itself a lattice vector away; a motif does not. The
    heel's circle, letters, a logo: shifted by one period of the surface's
    own lattice they land on something else. So per cell, the best agreement
    of the ``win`` x ``win`` neighbourhood with itself under the short
    lattice vectors (from `_dominant_offsets`, once and twice, each nudged by
    up to ``jitter`` cells because a curved sole bends its lattice), as a
    share of that neighbourhood's own variance: about 0.1 on the stand's
    tread, 0.6 on the heel's circle, high along a sole's border. One shift
    for the whole window: with small windows a ring of a concentric circle
    matched its neighbour ring and looked like texture.

    The hole allows what its ring has: the ring's values spread inwards
    (``reach`` cells), never below the ring's median. A hole in tread then
    refuses the circle; a hole on the border may take border; a hole inside
    something that repeats nowhere prices nothing. Returns ``(rare, allow)``
    or None when the surface has no short lattice to judge by.
    """
    nv, nu = known.shape
    if not target.any():
        return None
    lat = [o for o in _dominant_offsets(feat, known, k=12)
           if np.hypot(*o) <= frac * min(nv, nu)]
    if not lat:
        return None
    cand = set()
    for o in lat:
        for m in (1, 2):
            for a in range(-jitter, jitter + 1):
                for b in range(-jitter, jitter + 1):
                    cand.add((int(o[0] * m + a), int(o[1] * m + b)))
    M = known.astype(np.float32)
    den = np.maximum(ndimage.gaussian_filter(M, sig), 1e-6)
    fs = np.stack([ndimage.gaussian_filter(feat[..., c] * M, sig) / den
                   for c in range(feat.shape[2])], -1).astype(np.float32)
    best = np.full((nv, nu), np.inf, np.float32)
    for dy, dx in cand:
        both = M * _shift(M, dy, dx)
        d = ((fs - _shift(fs, dy, dx)) ** 2).sum(-1) * both
        nb = ndimage.uniform_filter(both, win)
        e = ndimage.uniform_filter(d, win) / np.maximum(nb, 1e-6)
        best = np.minimum(best, np.where(nb > 0.3, e, np.inf))
    dn = np.maximum(ndimage.uniform_filter(M, win), 1e-6)
    var = np.zeros((nv, nu), np.float32)
    for c in range(fs.shape[2]):
        mu = ndimage.uniform_filter(fs[..., c] * M, win) / dn
        var += np.maximum(ndimage.uniform_filter(fs[..., c] ** 2 * M, win) / dn - mu ** 2, 0.0)
    ok = known & np.isfinite(best)
    if ok.sum() < 64:
        return None
    rare = np.where(ok, best / np.maximum(2.0 * var, 1e-9), 0.0).astype(np.float64)
    rare = np.minimum(rare, float(np.percentile(rare[ok], 99.5)))
    ring = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=ring_w) & ~target & ok
    if ring.sum() < 12:
        return None
    floor = float(np.median(rare[ring]))
    wr = ndimage.gaussian_filter(ring.astype(np.float64), reach)
    spread = ndimage.gaussian_filter(np.where(ring, rare, 0.0), reach) / np.maximum(wr, 1e-9)
    spread = np.where(wr > 1e-3, spread, floor)
    allow = np.maximum(spread, floor)
    return rare, allow


def _motif_cost(rare, allow, sy, sx, ty, tx, ratio=1.5, cap=2.0):
    """Price of copying source cells ``(sy, sx)`` into ``(ty, tx)``; see `_motif_map`."""
    return np.clip(rare[sy, sx] / np.maximum(allow[ty, tx], 1e-9) - ratio, 0.0, cap)


def _lattice_multiples(feat, known, target, nv, nu, reach=1.6, min_cov=0.1):
    """Multiples of the surface's lattice vectors that reach across the hole.

    Each vector is repeated until it is `reach` times the hole's extent;
    shifts that leave the grid, or whose source covers less than `min_cov`
    of the hole with real surface, are dropped.
    """
    ty, tx = np.where(target)
    if len(ty) == 0:
        return []
    ext = max(np.ptp(ty), np.ptp(tx)) + 2
    out, seen = [], set()
    for o in _dominant_offsets(feat, known, k=12):
        for m in range(1, 40):
            dy, dx = int(o[0] * m), int(o[1] * m)
            if max(abs(dy), abs(dx)) > reach * ext:
                break
            if (dy, dx) in seen or abs(dy) >= nv - 1 or abs(dx) >= nu - 1:
                continue
            seen.add((dy, dx))
            if _shift(known, dy, dx, fill=False)[target].mean() >= min_cov:
                out.append(((dy, dx), 0.0))
    return out


def _offset_field(cands, target, known, feat, valid, nv, nu,
                  win=5, coherence=0.6, sweeps=6, region=None,
                  outlier=None, outlier_w=0.0, dzone=None, depth_w=0.0,
                  motif=None, motif_w=0.0):
    """One translation per cell, chosen so that neighbours agree.

    A single rigid translation cannot carry a tread across a large hole. The
    pattern is only quasi-periodic and it curves with the sole, so a shift
    that lines the ribs up on one side of the hole is half a rib out on the
    other, and the transplant reads as a smear. That is the "doesn't really
    understand patterns" complaint, and no amount of tuning the single best
    shift fixes it, because the problem is that there is only one.

    So let every cell pick among the best handful of shifts, pay a price for
    disagreeing with its neighbours, and settle. Where there is surviving
    surface to compare against, the data decides; deep inside the hole there
    is nothing to compare, and the coherence term carries the choice in from
    the rim. It is image quilting's idea without its seams, and it costs one
    shifted difference per candidate plus a few sweeps over the grid.
    """
    K = len(cands)
    offs = [c[0] if isinstance(c[0], tuple) else c for c in cands]
    reach = np.empty((K, nv, nu), bool)
    cost = np.zeros((K, nv, nu))
    pen_o = np.zeros((K, nv, nu)) if outlier is not None and outlier_w > 0 else None
    pen_d = np.zeros((K, nv, nu)) if dzone is not None and depth_w > 0 else None
    kvy, kvx = np.nonzero(known & valid)
    feat_kv = feat[kvy, kvx]
    for k, (dy, dx) in enumerate(offs):
        vs = _shift(valid, dy, dx, fill=False)
        ks = _shift(known if region is None else region, dy, dx, fill=False)
        reach[k] = ks                      # the source must be real surface
        if pen_o is not None:
            pen_o[k] = _shift(outlier, dy, dx)
        if pen_d is not None:
            pen_d[k] = np.nan_to_num(
                np.clip(np.abs(_shift(dzone, dy, dx) - dzone) / 2.0, 0.0, 3.0), nan=0.0)
        ok_ = vs[kvy, kvx]
        my, mx = kvy[ok_], kvx[ok_]
        m = np.zeros((nv, nu), bool)
        m[my, mx] = True
        d = np.zeros((nv, nu))
        d[my, mx] = ((feat_kv[ok_] - feat[my + dy, mx + dx]) ** 2).sum(-1)
        num = ndimage.uniform_filter(d, win, mode="constant")
        den = ndimage.uniform_filter(m.astype(float), win, mode="constant")
        # Where nothing can be compared the cost is zero for every candidate,
        # which is honest: the choice there belongs to the neighbours.
        cost[k] = np.where(den > 0.15, num / np.maximum(den, 1e-9), 0.0)
    # A label that would copy from inside the hole is no label at all.
    cost = np.where(reach, cost, np.inf)

    scale = cost[np.isfinite(cost) & (cost > 0)]
    lam = coherence * (float(np.median(scale)) if scale.size else 1.0)
    # A one-off source costs like disagreeing neighbours, in this stage's
    # own currency (see `_cell_outliers`).
    if pen_o is not None:
        cost = cost + outlier_w * lam * pen_o
    if pen_d is not None:
        cost = cost + depth_w * lam * pen_d
    # A source inside a motif the hole's ring does not have (`_motif_map`).
    if motif is not None and motif_w > 0:
        yy_, xx_ = np.mgrid[0:nv, 0:nu]
        for k, (dy, dx) in enumerate(offs):
            sy_, sx_ = np.clip(yy_ + dy, 0, nv - 1), np.clip(xx_ + dx, 0, nu - 1)
            cost[k] += motif_w * lam * _motif_cost(motif[0], motif[1], sy_, sx_, yy_, xx_)
    lab = _argmin0(np.where(np.isfinite(cost), cost, 1e18))

    # Neighbours are compared by whether they chose the same label.
    #
    # Comparing the *content* they would place is the better term in
    # principle (He and Sun), because two offsets a lattice vector apart
    # place the same thing and should cost nothing. Tried here it improved
    # every geometric number -- height at the larger hold-out from 2.66 to
    # 2.32 splat spacings, phase under deep extrapolation from nothing to
    # 47 percent of what the data allows -- and made the rendered sole
    # visibly worse: the ribs went soft. It is out until there is a measure
    # that would have caught that, which is now `bench_look.py`.
    costf = cost.reshape(K, -1)
    finf = np.isfinite(costf)
    base4 = np.where(finf, costf + lam * 4.0, 1e18)
    a0 = _argmin0(base4)
    v0 = base4[a0, np.arange(nv * nu)]
    del base4

    def choose(lab, idx):
        y, x = idx // nu, idx % nu
        lp = np.pad(lab, 1, constant_values=-1)
        nbl = np.stack([lp[y + 2, x + 1], lp[y, x + 1], lp[y + 1, x + 2], lp[y + 1, x]], 1)
        same = (nbl[:, :, None] == nbl[:, None, :]).sum(2)
        real = nbl >= 0
        safe = np.where(real, nbl, 0)
        vk = np.where(finf[safe, idx[:, None]],
                      costf[safe, idx[:, None]] + lam * (4.0 - same), 1e18)
        vals = np.concatenate([np.where(real, vk, np.inf), v0[idx][:, None]], 1)
        labs = np.concatenate([np.where(real, nbl, K), a0[idx][:, None]], 1)
        return np.where(vals == vals.min(1)[:, None], labs, K).min(1)

    prev = None
    for _ in range(sweeps):
        if prev is None:
            idx = np.arange(nv * nu)
        else:
            ch = lab != prev
            aff = np.zeros((nv, nu), bool)
            aff[1:] |= ch[:-1]
            aff[:-1] |= ch[1:]
            aff[:, 1:] |= ch[:, :-1]
            aff[:, :-1] |= ch[:, 1:]
            idx = np.flatnonzero(aff)
        nxt = lab.copy()
        nxt.ravel()[idx] = choose(lab, idx)
        prev = lab
        if np.array_equal(nxt, lab):
            break
        lab = nxt

    dys = np.array([o[0] for o in offs])
    dxs = np.array([o[1] for o in offs])
    return dys[lab], dxs[lab], lab


def _argmin0(a):
    """``np.argmin(a, 0)`` for NaN-free ``a``, without the strided reduction."""
    best = a[0].copy()
    arg = np.zeros(a.shape[1:], np.int64)
    for k in range(1, len(a)):
        lower = a[k] < best
        best[lower] = a[k][lower]
        arg[lower] = k
    return arg


def _reduce2(a, how):
    """Halve a grid by 2x2 blocks, dropping an odd last row or column."""
    nv, nu = a.shape[:2]
    a = a[: nv - nv % 2, : nu - nu % 2]
    sh = (a.shape[0] // 2, 2, a.shape[1] // 2, 2) + a.shape[2:]
    b = a.reshape(sh)
    if how == "mean":
        return b.mean((1, 3))
    if how == "any":
        return b.any((1, 3))
    return b.all((1, 3))


def _match_offsets(feat, target, known, init, rng, win, iters,
                   frontier=False, soft_vote=False, coherence=0.0, region=None,
                   outlier=None, outlier_w=0.0, dzone=None, depth_w=0.0,
                   motif=None, motif_w=0.0):
    """One resolution's worth of patch matching. See _synthesise_offsets.

    Two things here are not obvious and both matter more than the search.

    **Cells outside the hole are matched too.** Not just the hole: every cell
    within one window of it. A window centred on surviving surface is made
    almost entirely of real data, so where it matches is not in doubt -- and
    because that window also covers the first cells inside the hole, its
    opinion about them is pinned to the pattern that surrounds them. Matching
    only hole cells throws that away and leaves the rim cells, which are the
    ones that have to line up, as the least constrained in the picture.

    **Every window covering a cell votes, weighted.** The value written for a
    cell is the weighted mean over all the windows containing it, not the one
    centred on it: the weights are a falling function of distance into the
    hole and of how well each window matched, after Wexler, Shechtman and
    Irani's completion scheme. Taking only the centred window lets
    neighbouring cells answer to nothing but themselves, which converges on
    being self-consistent rather than on continuing what is around it.
    """
    nv, nu, _ = feat.shape
    if not target.any():
        return (np.asarray(init[0], np.int64).copy(),
                np.asarray(init[1], np.int64).copy())

    # Everything within a window of the hole takes part.
    active = (ndimage.binary_dilation(target, np.ones((3, 3)), iterations=win)
              if frontier else target)
    ty, tx = np.where(active)
    n = len(ty)
    dy = np.asarray(init[0], np.int64).copy()
    dx = np.asarray(init[1], np.int64).copy()

    oy, ox = np.mgrid[-win:win + 1, -win:win + 1]
    oy, ox = oy.ravel(), ox.ravel()
    W = oy.size

    work = feat.copy()
    # How far into the hole a cell is. Wexler weight a window by alpha to the
    # minus that distance, so the windows standing on real data decide and
    # the ones deep in the hole follow.
    depth = ndimage.distance_transform_edt(~known)
    conf = np.where(known, 1.0, 1.3 ** (-depth))

    rows, cols = np.mgrid[0:nv, 0:nu]
    centre = W // 2
    reg_ = known if region is None else region
    wlin = (np.clip(ty[:, None] + oy[None, :], 0, nv - 1) * nu
            + np.clip(tx[:, None] + ox[None, :], 0, nu - 1))
    feat_f = feat.reshape(nv * nu, -1)
    known_f = known.ravel()
    all_rows = np.arange(n)
    win_ = {}                      # this pass's target windows and confidence

    def gather():
        win_["work"] = work.reshape(nv * nu, -1)[wlin]
        win_["conf"] = conf.ravel()[wlin]

    def costs_rows(r, cdy, cdx):
        """Window cost of the cells ``r`` under the candidates ``cdy, cdx``."""
        TY, TX = ty[r], tx[r]
        sy = TY[:, None] + oy[None, :] + cdy[:, None]
        sx = TX[:, None] + ox[None, :] + cdx[:, None]
        inside = (sy >= 0) & (sy < nv) & (sx >= 0) & (sx < nu)
        sy, sx = np.clip(sy, 0, nv - 1), np.clip(sx, 0, nu - 1)
        slin = sy * nu + sx
        w = win_["conf"][r] * known_f[slin] * inside
        den = w.sum(1)
        # A cell must point somewhere else, and at real surface. Without the
        # first condition the offset (0, 0) is unbeatable wherever the window
        # holds known data -- source window equals target window, every term
        # is zero -- and the cell copies itself instead of continuing the
        # pattern. Measured, that was ninety percent of the hole's outer ring.
        far = (np.abs(cdy) > win) | (np.abs(cdx) > win)
        ok_centre = reg_[sy[:, centre], sx[:, centre]] & inside[:, centre]
        bad = (den < 0.12 * W) | ~ok_centre | ~far
        out = np.full(len(r), np.inf)
        g = np.flatnonzero(~bad)
        if not len(g):
            return out
        d = ((win_["work"][r[g]] - feat_f[slin[g]]) ** 2).sum(-1) * w[g]
        o = d.sum(1) / np.maximum(den[g], 1e-9)
        if med0[0] is not None and outlier is not None and outlier_w > 0:
            o = o + outlier_w * coherence * med0[0] * outlier[sy[g, centre], sx[g, centre]]
        if med0[0] is not None and motif is not None and motif_w > 0:
            o = o + motif_w * coherence * med0[0] * _motif_cost(
                motif[0], motif[1], sy[g, centre], sx[g, centre], TY[g], TX[g])
        if med0[0] is not None and dzone is not None and depth_w > 0:
            o = o + depth_w * coherence * med0[0] * np.clip(
                np.nan_to_num(np.abs(dzone[sy[g, centre], sx[g, centre]] - dzone[TY[g], TX[g]])
                              / 2.0, nan=0.0), 0.0, 3.0)
        out[g] = o
        return out

    def costs(cdy, cdx):
        return costs_rows(all_rows, cdy, cdx)

    # Neighbours should want the same source.
    #
    # Nothing here made them. `_offset_field` settles a coherent field over a
    # handful of candidates, and then this function takes every cell apart
    # again: each one answers to its own window and to nothing else. On the
    # shoe that came out as 482 distinct shifts over 3519 cells, and every
    # border between two of them is a place where the pattern restarts at a
    # new phase. From the outside that is exactly "the pattern still does not
    # repeat properly" -- not blur, but a mosaic of small correct pieces that
    # do not continue one another.
    #
    # A Potts penalty on disagreeing with the four neighbours buys fewer,
    # larger, rigid pieces. It is the same term `_offset_field` already uses,
    # and it is what a person does by hand with the stamp tool: drag one
    # patch across, do not re-pick the source every few millimetres.
    nbr = ((1, 0), (-1, 0), (0, 1), (0, -1))

    nb_ = []                       # this pass's four neighbours of every cell

    def neighbours(dy_, dx_, act):
        nb_[:] = [(_shift(act, a, b, fill=False)[ty, tx], _shift(dy_, a, b)[ty, tx],
                   _shift(dx_, a, b)[ty, tx]) for a, b in nbr] if coherence > 0 else []

    def penalty_rows(r, cdy, cdx):
        if coherence <= 0:
            return 0.0
        p = np.zeros(len(r))
        for a_, y_, x_ in nb_:
            p += a_[r] & ((y_[r] != cdy) | (x_[r] != cdx))
        return p

    cur_y, cur_x = dy[ty, tx].copy(), dx[ty, tx].copy()
    span = max(nv, nu) // 2
    # the outlier price in units of the initial field's own data cost, fixed
    # once so that it does not drift as the matching improves
    med0 = [None]
    if ((outlier is not None and outlier_w > 0)
            or (motif is not None and motif_w > 0)
            or (dzone is not None and depth_w > 0)) and coherence > 0:
        gather()
        b0 = costs(cur_y, cur_x)
        f0 = b0[np.isfinite(b0)]
        med0[0] = float(np.median(f0)) if f0.size else 1.0

    raw = None                     # window cost of every cell's current choice
    for it in range(iters):
        gather()
        if raw is None:
            base = costs(cur_y, cur_x)      # the vote moved `work` under it
        else:
            # only cells whose window the last pass wrote into are stale
            base = raw
            sr = np.flatnonzero(stale)
            if len(sr):
                base[sr] = costs_rows(sr, cur_y[sr], cur_x[sr])
        raw = base
        fin = base[np.isfinite(base)]
        lam = coherence * (float(np.median(fin)) if fin.size else 1.0)
        neighbours(dy, dx, active)
        best = base + lam * penalty_rows(all_rows, cur_y, cur_x)
        cands = []
        for step in (1, 3, 9):
            for sy_, sx_ in ((step, 0), (-step, 0), (0, step), (0, -step)):
                cands.append((_shift(dy, sy_, sx_)[ty, tx],
                              _shift(dx, sy_, sx_)[ty, tx]))
        r = max(2, int(span * (0.5 ** it)))
        for _ in range(3):
            cands.append((cur_y + rng.integers(-r, r + 1, n),
                          cur_x + rng.integers(-r, r + 1, n)))

        tried = [(cur_y.copy(), cur_x.copy())]
        for cdy, cdx in cands:
            new = (cdy != cur_y) | (cdx != cur_x)
            for py, px in tried:
                new &= (cdy != py) | (cdx != px)
            tried.append((cdy, cdx))
            r = np.flatnonzero(new)
            if not len(r):
                continue
            # The window cost is never negative, so a candidate whose
            # disagreement with its neighbours alone costs the current best
            # cannot beat it.
            pen_r = lam * penalty_rows(r, cdy[r], cdx[r])
            if coherence > 0:
                hope = pen_r < best[r]
                r, pen_r = r[hope], pen_r[hope]
                if not len(r):
                    continue
            c_raw = costs_rows(r, cdy[r], cdx[r])
            c = c_raw + pen_r
            take = c < best[r]
            rt = r[take]
            best[rt] = c[take]
            raw[rt] = c_raw[take]
            cur_y[rt] = cdy[rt]
            cur_x[rt] = cdx[rt]
        dy[ty, tx], dx[ty, tx] = cur_y, cur_x

        if not soft_vote:
            sy = np.clip(ty + cur_y, 0, nv - 1)
            sx = np.clip(tx + cur_x, 0, nu - 1)
            ok = np.isfinite(best) & target[ty, tx]
            new_w = feat[sy[ok], sx[ok]]
            moved = ((work[ty[ok], tx[ok]] != new_w).any(-1)
                     | (conf[ty[ok], tx[ok]] != 0.6))
            work[ty[ok], tx[ok]] = new_w
            conf[ty[ok], tx[ok]] = 0.6
            wrote = np.zeros(nv * nu, bool)
            wrote[(ty[ok] * nu + tx[ok])[moved]] = True
            stale = wrote[wlin].any(1)
            continue
        raw = None                     # the vote moves every window
        # Vote. sigma follows the distances actually seen, as Wexler set it.
        fin = best[np.isfinite(best)]
        sigma2 = 2.0 * max(float(np.percentile(fin, 75)), 1e-9) if fin.size else 1.0
        wmap = np.zeros((nv, nu))
        wmap[ty, tx] = np.where(np.isfinite(best),
                                conf[ty, tx] * np.exp(-best / sigma2), 0.0)
        acc = np.zeros_like(feat)
        tot = np.zeros((nv, nu))
        for oy_, ox_ in zip(oy, ox):
            oy_, ox_ = int(oy_), int(ox_)
            gy = _shift(dy, -oy_, -ox_)
            gx = _shift(dx, -oy_, -ox_)
            ww = _shift(wmap, -oy_, -ox_)
            syy = np.clip(rows + gy, 0, nv - 1)
            sxx = np.clip(cols + gx, 0, nu - 1)
            ww = np.where(known[syy, sxx], ww, 0.0)
            acc += ww[..., None] * feat[syy, sxx]
            tot += ww
        voted = target & (tot > 1e-9)
        work[voted] = acc[voted] / tot[voted][:, None]

    return dy, dx


def _synthesise_offsets(target, known, feat, init, rng,
                        win=2, iters=6, levels=1,
                        frontier=False, soft_vote=False, coherence=0.0, region=None,
                        outlier=None, outlier_w=0.0, dzone=None, depth_w=0.0,
                        motif=None, motif_w=0.0):
    """Give every cell in the hole its own source, coarse to fine.

    Patch matching can only judge a cell that already has something around
    it, so on one resolution it creeps inwards a couple of cells per pass and
    the middle of a large hole keeps whatever it started with. That is not a
    cosmetic limit. A sole is not one texture: it has a pebbled band round
    the rim, a field of diamonds, and a smooth plaque with a raised border,
    and the hole here spans all three. The rim knows which is which on every
    side; the interior never heard about it, so the fill ran diamonds over
    the plaque and over the pebbled band alike -- structurally wrong in a way
    no amount of edge blending can hide.

    Halving the grid halves the hole's depth with it. Four levels down a
    thirty-seven-cell hole is four cells deep, which the matching crosses in
    a pass or two, and at that scale the three zones are plainly different in
    colour and relief. The answer is then carried back up and refined, so the
    coarse level decides *what* goes where and the fine levels make it crisp.
    """
    nv, nu, _ = feat.shape
    # Only go as coarse as the hole is deep.
    #
    # The pyramid exists to bring the middle of a large hole within reach.
    # Taking a small one up the same number of levels shrinks it to two or
    # three cells, where there is nothing left to decide from -- and the
    # coarse guess then gets handed down to every finer level. Measured on
    # the hold-out discs, a fixed four levels more than doubled the error on
    # the small ones while helping the large one. Stop halving when the hole
    # is about four cells deep.
    #
    # Off by default, because measured it is worse. Against the single-level
    # result the pyramid changes twelve percent of the rendered pixels, and
    # the change is in the wrong direction: the lattice inside the hole comes
    # out shifted against the lattice outside it, so the ridges no longer
    # meet at the rim. The coarse level picks a translation from blurred
    # features and doubling it lands the fine pattern off-phase, and the fine
    # pass cannot recover because by then its own interior votes dominate the
    # cost. Left in, and reachable through `synth_levels`, because the idea
    # is right -- carrying structure into the middle of a large hole needs
    # it -- but it needs the fine level to re-search properly first.
    depth = float(ndimage.distance_transform_edt(target).max()) if target.any() else 0.0
    levels = int(np.clip(np.floor(np.log2(max(depth, 1.0) / 5.0)), 1, levels))
    pyr = [(feat, target, known, known if region is None else region, outlier)]
    while len(pyr) < levels and min(pyr[-1][0].shape[:2]) >= 32:
        f, t, k, r, o = pyr[-1]
        t2 = _reduce2(t, "any")
        # Majority, not unanimity. Demanding that all four children be known
        # squares the attrition at every halving: cells are empty at random
        # about one time in seven, so two levels up only a sixteenth of the
        # grid survived -- a hundred known cells out of seventeen hundred,
        # with nothing left to match against. The coarse level is where the
        # structure has to be decided, so it is the one that can least
        # afford to be starved.
        k2 = (_reduce2(k.astype(np.float64), "mean") >= 0.5) & ~t2
        r2 = (_reduce2(r.astype(np.float64), "mean") >= 0.5) & ~t2
        o2 = None if o is None else _reduce2(o, "mean")
        pyr.append((_reduce2(f, "mean"), t2, k2, r2, o2))

    dy = dx = None
    for lvl in range(len(pyr) - 1, -1, -1):
        f, t, k, r, o = pyr[lvl]
        dz_ = dzone if lvl == 0 else None
        if dy is None:
            iy, ix = np.asarray(init[0]), np.asarray(init[1])
            for _ in range(lvl):
                iy = _reduce2(iy.astype(np.float64), "mean")
                ix = _reduce2(ix.astype(np.float64), "mean")
                iy, ix = iy / 2.0, ix / 2.0
            iy = np.rint(iy).astype(np.int64)[: f.shape[0], : f.shape[1]]
            ix = np.rint(ix).astype(np.int64)[: f.shape[0], : f.shape[1]]
        else:
            iy = np.repeat(np.repeat(dy, 2, 0), 2, 1) * 2
            ix = np.repeat(np.repeat(dx, 2, 0), 2, 1) * 2
            iy = _fit(iy, f.shape[:2])
            ix = _fit(ix, f.shape[:2])
        dy, dx = _match_offsets(f, t, k, (iy, ix), rng, win, iters,
                                frontier, soft_vote, coherence, region=r,
                                outlier=o, outlier_w=outlier_w, dzone=dz_, depth_w=depth_w,
                                motif=motif if lvl == 0 else None, motif_w=motif_w)
    return dy, dx


def _fit(a, shape):
    """Crop or edge-pad an integer grid to an exact shape."""
    out = np.zeros(shape, a.dtype)
    v = min(a.shape[0], shape[0])
    u = min(a.shape[1], shape[1])
    out[:v, :u] = a[:v, :u]
    if v < shape[0]:
        out[v:, :u] = out[v - 1, :u]
    if u < shape[1]:
        out[:, u:] = out[:, u - 1][:, None]
    return out


def _donors_from_patch(offset, cell, nu_, nv_, uvh_sur, sur_idx, rgb_sur, relief,
                       target, sv, su, nv, nu, cy, cx, field=None, forced=None,
                       tone_smooth=6.0, tone_plate=False, level=None, ring_avoid=None,
                       seam_membrane=True):
    """Transplant a donor region: donor = nearest surface splat at the offset.

    With ``field`` the offset varies per cell, which is what lets a pattern
    bend to follow the one around it; without it the whole block moves by one
    fixed shift, which is all a small hole needs.
    """
    dyy, dxx = offset
    if field is not None:
        fy, fx = field
    if forced is not None:
        j = forced                       # the donors chose the positions
    else:
        tree = cKDTree(uvh_sur[:, :2])
        if field is None:
            q = np.stack([nu_ + dxx * cell, nv_ + dyy * cell], 1)
        else:
            q = np.stack([nu_ + fx[cy, cx] * cell, nv_ + fy[cy, cx] * cell], 1)
        _, j = tree.query(q, k=1)

    # match the donor block's rim tone to this rim's tone, so the patch lands in
    # the right exposure instead of reading as a pasted plate
    ring = ndimage.binary_dilation(target, np.ones((3, 3)), iterations=3) & ~target
    sumR, cnt = _accum(rgb_sur, sv, su, nv, nu)
    occ = cnt > 0
    # The seam is read where the brush never reached. Cells of the painted
    # footprint that still count as covered have lost their front layer to
    # the brush's edge and show the one behind it: on the toe cap that layer
    # sat 2-4 spacings under the face, the seam correction carried that
    # into the whole patch, and it sank by as much. Their colour is the
    # inner layer's too.
    if ring_avoid is not None:
        ring_c = ring & ~ring_avoid
        if (ring_c & occ).sum() >= 8:
            ring = (ndimage.binary_dilation(target | ring_avoid, np.ones((3, 3)), iterations=3)
                    & ~target & ~ring_avoid)
    cR = sumR / np.maximum(cnt, 1e-9)[..., None]
    ry, rx = np.where(ring & occ)
    if field is None:
        ry2, rx2 = ry + dyy, rx + dxx
    else:
        # The ring sits outside the target and has no offset of its own, so
        # it borrows its nearest filled neighbour's -- which is the one whose
        # seam it has to hide.
        fyr = _fill_nearest(np.where(target, fy, np.nan), target)
        fxr = _fill_nearest(np.where(target, fx, np.nan), target)
        ry2 = ry + np.rint(fyr[ry, rx]).astype(np.int64)
        rx2 = rx + np.rint(fxr[ry, rx]).astype(np.int64)
    ok = (ry2 >= 0) & (ry2 < nv) & (rx2 >= 0) & (rx2 < nu)
    if ok.any():
        ok[ok] &= occ[ry2[ok], rx2[ok]]
        if ring_avoid is not None:
            # ... and on the donor's side as well: a ring cell borrows its
            # neighbour's offset, which can land in the hole or its footprint
            ok[ok] &= ~(ring_avoid | target)[ry2[ok], rx2[ok]]
    # Tone: a reference surface for colour, exactly as `hf` is one for height.
    #
    # Relief is measured against a fitted surface, so a donor's relief means
    # the same thing wherever it came from. Colour had no such reference. It
    # was corrected instead from the mismatch around the rim, extended
    # inwards -- which is right only if the whole patch comes from one place.
    # With per-cell offsets it does not: every cell's donor carries its own
    # exposure error, and a field solved at the rim knows about none of them.
    # Measured on the shoe, the fill came out at 0.26 brightness against the
    # 0.38 of the surface it joined, a third too dark over the whole patch.
    # That is what the user was seeing as a dent: nothing about the geometry
    # was wrong -- the fill's outer face sat a fifth of a splat spacing
    # *outside* the surround -- but a patch that is uniformly darker than what
    # surrounds it reads as a hollow, because on a real surface that is what
    # being lower means. Raising the opacity threefold moved the brightness
    # by four percent, so it was never a question of too little material.
    #
    # So fit one smooth tone over the surviving surface and continue it
    # across the hole. Each donor then gives up its own local tone and takes
    # the tone that belongs where it lands, keeping everything finer than
    # `tone_smooth` cells -- which is the pattern. Textbook local mean
    # matching; the novelty here is only that colour deserved the same
    # treatment as height and had been getting a weaker one.
    tone = None
    kn_tone = occ & ~target
    if ring_avoid is not None and (kn_tone & ~ring_avoid).sum() >= 16:
        kn_tone = kn_tone & ~ring_avoid
    if kn_tone.sum() >= 16 and tone_smooth > 0:
        tone = fit_reference_surface(cR, kn_tone, smooth_cells=tone_smooth,
                                     plate=tone_plate, exact=False)
    shift = np.zeros((len(j), 3))
    if tone is not None:
        if field is None:
            sy_ = np.clip(cy + dyy, 0, nv - 1)
            sx_ = np.clip(cx + dxx, 0, nu - 1)
        else:
            sy_ = np.clip(cy + fy[cy, cx], 0, nv - 1)
            sx_ = np.clip(cx + fx[cy, cx], 0, nu - 1)
        shift = (tone[cy, cx] - tone[sy_, sx_]) / SH_C0

    # Seamless cloning, on the height field instead of on pixels.
    #
    # A donor's relief is measured against the reference surface over *there*,
    # and the reference is never exact, so taking it verbatim carries the
    # difference between its error there and its error here into every splat
    # the donor fathers. That difference is not a constant -- subtracting one
    # was tried and moved nothing -- it varies across the patch.
    #
    # So measure the mismatch where both sides are known, which is the ring of
    # surviving surface around the hole, and extend it harmonically inwards.
    # The correction then vanishes into the rim by construction, which is what
    # makes the seam disappear, and only bends the interior as much as the
    # boundary demands.
    sumH, _ = _accum(relief, sv, su, nv, nu)
    cH = sumH / np.maximum(cnt, 1e-9)
    cHt = cH
    corr = np.zeros((nv, nu))
    if level is not None:
        # relief local to each donor: the target's own level sets the height
        corr = level
    elif ok.sum() >= 8:
        ringok = np.zeros((nv, nu), bool)
        ringok[ry[ok], rx[ok]] = True
        mism = np.full((nv, nu, 1), np.nan)
        mism[ry[ok], rx[ok], 0] = cHt[ry[ok], rx[ok]] - cH[ry2[ok], rx2[ok]]
        corr = fit_reference_surface(mism, ringok, smooth_cells=4.0, exact=False,
                                     need=target, fast=True,
                                     plate=not seam_membrane)[..., 0]

    # No gain on the relief.
    #
    # Worth recording, because it looked obvious: the fill's tread measured
    # 1.8 splat spacings deep against the surroundings' 3.1, so scaling the
    # donor's relief to match seemed called for. It was a measurement error --
    # the fill was being compared against *unfiltered* surrounding splats,
    # haze included, while it is built from the cleaned surface. Compared
    # like for like at the seam the two are 2.47 and 2.55, and the ring's own
    # relief spread is the same on both sides to half a percent. Scaling
    # anyway made the fill worse, because the seam correction below is solved
    # before the scaling and a gain then pulls the rim back out of true.
    return sur_idx[j], shift, relief[j] + corr[cy, cx], {"tone": tone,
                                                        "height": corr}
