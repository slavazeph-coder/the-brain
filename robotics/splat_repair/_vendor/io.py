"""Reading and writing 3D Gaussian Splatting PLY files.

Handles the INRIA/original-3DGS property layout, which is what Postshot,
nerfstudio, gsplat and SuperSplat all emit:

    x y z
    f_dc_0..2                     SH band 0 (DC), one per colour channel
    f_rest_0..(3*K-1)             SH bands 1..deg, CHANNEL-MAJOR:
                                  [R_0..R_K-1][G_0..G_K-1][B_0..B_K-1]
    opacity                       pre-sigmoid logit
    scale_0..2                    log-space
    rot_0..3                      quaternion, (w, x, y, z), unnormalised

Everything is float32 and binary_little_endian in practice. We keep the raw
storage-space values as the source of truth and expose activated views, so a
load/save round trip is bit-exact when nothing was edited.
"""
from __future__ import annotations

import contextlib
import os

import numpy as np
from dataclasses import dataclass, field

SH_C0 = 0.28209479177387814


@contextlib.contextmanager
def replacing(path):
    """Write a file next to ``path`` and swap it in once it is whole.

    Yields the name to write to (``path`` + ".tmp", same folder, so the swap
    is a rename on one volume). An export that fails halfway -- disk full,
    an error in the writer -- used to leave a truncated file where the last
    good one was; now the old file stays and the half-written one is removed.
    """
    path = os.fspath(path)
    tmp = path + ".tmp"
    try:
        yield tmp
        os.replace(tmp, path)
    except BaseException as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        if isinstance(e, OSError) and e.filename == tmp:
            e.filename = path          # the message names the file that was asked for
        raise


def sh_coeffs_for_degree(deg: int) -> int:
    """Number of SH coefficients per channel in bands 1..deg (DC excluded)."""
    return (deg + 1) ** 2 - 1


def degree_for_rest(n_rest: int) -> int:
    """SH degree implied by an f_rest_* count (which spans all three channels)."""
    if n_rest % 3:
        raise ValueError("f_rest count %d is not divisible by 3" % n_rest)
    per_channel = n_rest // 3
    for deg in range(4):
        if sh_coeffs_for_degree(deg) == per_channel:
            return deg
    raise ValueError("%d SH coefficients per channel match no degree 0-3" % per_channel)


@dataclass
class SplatSet:
    """A Gaussian splat cloud. Arrays are (N, ...) and always float32."""

    xyz: np.ndarray            # (N, 3)    world position
    f_dc: np.ndarray           # (N, 3)    SH DC per channel
    f_rest: np.ndarray         # (N, K, 3) SH bands 1.., coeff-major, channel last
    opacity: np.ndarray        # (N,)      logit
    scale: np.ndarray          # (N, 3)    log-space
    rot: np.ndarray            # (N, 4)    quaternion (w, x, y, z)
    extra: dict = field(default_factory=dict)   # unrecognised vertex properties

    @property
    def n(self) -> int:
        return len(self.xyz)

    @property
    def sh_degree(self) -> int:
        return degree_for_rest(self.f_rest.shape[1] * 3)

    @property
    def alpha(self) -> np.ndarray:
        """Opacity in [0, 1]."""
        return 1.0 / (1.0 + np.exp(-self.opacity.astype(np.float64)))

    @property
    def sigma(self) -> np.ndarray:
        """Gaussian scale in world units."""
        return np.exp(self.scale.astype(np.float64))

    @property
    def rgb(self) -> np.ndarray:
        """View-independent base colour in [0, 1] (SH DC only)."""
        return np.clip(0.5 + SH_C0 * self.f_dc.astype(np.float64), 0.0, 1.0)

    @property
    def quat(self) -> np.ndarray:
        """Unit quaternion (w, x, y, z)."""
        q = self.rot.astype(np.float64)
        return q / np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)

    def take(self, idx) -> "SplatSet":
        """Subset by index array or boolean mask."""
        return SplatSet(
            xyz=self.xyz[idx], f_dc=self.f_dc[idx], f_rest=self.f_rest[idx],
            opacity=self.opacity[idx], scale=self.scale[idx], rot=self.rot[idx],
            extra={k: v[idx] for k, v in self.extra.items()},
        )

    def concat(self, other: "SplatSet") -> "SplatSet":
        if other.f_rest.shape[1] != self.f_rest.shape[1]:
            raise ValueError("the splat sets have different SH degrees")
        # in this set's order, not a set's: the order is the column order of
        # the next export, and a set's changes from run to run
        keys = [k for k in self.extra if k in other.extra]
        return SplatSet(
            xyz=np.concatenate([self.xyz, other.xyz]),
            f_dc=np.concatenate([self.f_dc, other.f_dc]),
            f_rest=np.concatenate([self.f_rest, other.f_rest]),
            opacity=np.concatenate([self.opacity, other.opacity]),
            scale=np.concatenate([self.scale, other.scale]),
            rot=np.concatenate([self.rot, other.rot]),
            extra={k: np.concatenate([self.extra[k], other.extra[k]]) for k in keys},
        )

    def copy(self) -> "SplatSet":
        """A genuine deep copy.

        Not ``take(slice(None))``: basic slicing returns *views*, so that
        version handed back something that shared storage with the original
        and silently wrote through to it.
        """
        return SplatSet(
            xyz=self.xyz.copy(), f_dc=self.f_dc.copy(), f_rest=self.f_rest.copy(),
            opacity=self.opacity.copy(), scale=self.scale.copy(),
            rot=self.rot.copy(),
            extra={k: v.copy() for k, v in self.extra.items()},
        )


def _parse_header(path):
    with open(path, "rb") as f:
        chunk = b""
        while b"end_header" not in chunk:
            more = f.read(8192)
            if not more:
                raise ValueError("not a PLY file: end_header is missing")
            chunk += more
            if len(chunk) > 1048576:
                raise ValueError("PLY header is implausibly large")
    end = chunk.index(b"end_header")
    end = chunk.index(b"\n", end) + 1
    lines = chunk[:end].decode("ascii", "replace").splitlines()
    if not lines or lines[0].strip() != "ply":
        raise ValueError("not a PLY file: wrong magic number")

    fmt, count, props, in_vertex = None, None, [], False
    for ln in lines[1:]:
        parts = ln.split()
        if not parts:
            continue
        if parts[0] == "format":
            fmt = parts[1]
        elif parts[0] == "element":
            in_vertex = parts[1] == "vertex"
            if in_vertex:
                count = int(parts[2])
        elif parts[0] == "property" and in_vertex:
            if parts[1] == "list":
                raise ValueError("list properties on the vertex element are not supported")
            props.append((parts[1], parts[2]))
    if fmt != "binary_little_endian":
        raise ValueError("PLY format %r is not supported; expected binary_little_endian" % fmt)
    if count is None:
        raise ValueError("PLY without a vertex element")
    return count, props, end


_NP = {"float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8",
       "uchar": "u1", "uint8": "u1", "char": "i1", "int8": "i1",
       "ushort": "<u2", "uint16": "<u2", "short": "<i2", "int16": "<i2",
       "uint": "<u4", "uint32": "<u4", "int": "<i4", "int32": "<i4"}


def load_ply(path) -> SplatSet:
    """Load a 3DGS PLY into a SplatSet."""
    count, props, offset = _parse_header(path)
    dtype = np.dtype([(name, _NP[ty]) for ty, name in props])
    raw = np.fromfile(path, dtype=dtype, count=count, offset=offset)
    if len(raw) != count:
        raise ValueError("PLY truncated: header says %d, read %d" % (count, len(raw)))

    names = {name for _, name in props}
    need = {"x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2",
            "rot_0", "rot_1", "rot_2", "rot_3"}
    missing = need - names
    if missing:
        raise ValueError("the PLY lacks required properties: %s" % sorted(missing))

    def col(*keys):
        return np.stack([raw[k].astype(np.float32) for k in keys], axis=-1)

    xyz = col("x", "y", "z")
    f_dc = (col("f_dc_0", "f_dc_1", "f_dc_2") if "f_dc_0" in names
            else np.zeros((count, 3), np.float32))
    n_rest = sum(1 for n in names if n.startswith("f_rest_"))
    if n_rest:
        flat = np.stack([raw["f_rest_%d" % i].astype(np.float32)
                         for i in range(n_rest)], -1)
        # storage is channel-major -> (N, 3, K) -> transpose to (N, K, 3)
        f_rest = flat.reshape(count, 3, n_rest // 3).transpose(0, 2, 1).copy()
    else:
        f_rest = np.zeros((count, 0, 3), np.float32)

    consumed = {"x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
                "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"}
    consumed |= {"f_rest_%d" % i for i in range(n_rest)}
    extra = {n: raw[n].copy() for _, n in props if n not in consumed}

    return SplatSet(
        xyz=xyz, f_dc=f_dc, f_rest=f_rest,
        opacity=raw["opacity"].astype(np.float32),
        scale=col("scale_0", "scale_1", "scale_2"),
        rot=col("rot_0", "rot_1", "rot_2", "rot_3"),
        extra=extra,
    )


_PLY = {"f4": "float", "f8": "double", "u1": "uchar", "i1": "char",
        "u2": "ushort", "i2": "short", "u4": "uint", "i4": "int"}


def save_ply(path, s: SplatSet, write_normals: bool = True) -> None:
    """Write a SplatSet as a binary little-endian 3DGS PLY.

    Property order matches the original 3DGS writer, which several loaders
    quietly depend on. nx/ny/nz are the file's own where it had them and
    zeros otherwise: the reference implementation writes zeros, and some
    viewers reject files without them.

    Vertex properties this engine does not know (``SplatSet.extra``: a
    segment id, a confidence) follow the standard ones, each in the type it
    was read in. They used to be dropped, so an export lost them without a
    word. Only what every splat still has is there to write: `concat` keeps
    the properties both sides share, and the splats a fill generates carry
    none (the copies a stamp or a move makes keep theirs).
    """
    n, K = s.n, s.f_rest.shape[1]
    extra = {k: np.asarray(v) for k, v in s.extra.items()}
    extra = {k: v for k, v in extra.items() if v.shape == (n,) and v.dtype.kind in "fiub"
             and k.isascii() and len(k.split()) == 1}       # a name the header can carry
    normals = [extra.pop(k, None) for k in ("nx", "ny", "nz")]
    cols = [("x", s.xyz[:, 0]), ("y", s.xyz[:, 1]), ("z", s.xyz[:, 2])]
    if write_normals:
        z = np.zeros(n, np.float32)
        cols += [(k, z if v is None else v) for k, v in zip(("nx", "ny", "nz"), normals)]
    cols += [("f_dc_%d" % i, s.f_dc[:, i]) for i in range(3)]
    rest = s.f_rest.transpose(0, 2, 1).reshape(n, 3 * K)   # back to channel-major
    cols += [("f_rest_%d" % i, rest[:, i]) for i in range(3 * K)]
    cols += [("opacity", s.opacity)]
    cols += [("scale_%d" % i, s.scale[:, i]) for i in range(3)]
    cols += [("rot_%d" % i, s.rot[:, i]) for i in range(4)]

    # the standard columns are float32, as every reader expects; an extra
    # one keeps its own type where PLY has a name for it
    types = ["f4"] * len(cols)
    for name, data in extra.items():
        key = "%s%d" % (data.dtype.kind, data.dtype.itemsize)
        types.append(key if key in _PLY else "f4")
        cols.append((name, data))

    dtype = np.dtype([(name, "<" + ty) for (name, _), ty in zip(cols, types)])
    arr = np.empty(n, dtype=dtype)
    for (name, data), ty in zip(cols, types):
        arr[name] = data.astype("<" + ty, copy=False)

    header = ["ply", "format binary_little_endian 1.0", "element vertex %d" % n]
    header += ["property %s %s" % (_PLY[ty], name) for (name, _), ty in zip(cols, types)]
    header += ["end_header", ""]
    with replacing(path) as tmp:
        with open(tmp, "wb") as f:
            f.write("\n".join(header).encode("ascii"))
            arr.tofile(f)
