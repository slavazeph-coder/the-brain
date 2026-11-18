"""Bounded Gaussian PLY I/O retaining every original scalar vertex field.

Original records stay in their declared types. Only generated Gaussian fields
are computed by the upstream float32 engine; retained rows are never cast.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re

import numpy as np

MAX_BYTES = 64 * 1024**2
MAX_VERTICES = 200_000
MAX_PROPERTIES = 96
MAX_HEADER = 64 * 1024
TYPES = {'char': 'i1', 'int8': 'i1', 'uchar': 'u1', 'uint8': 'u1',
         'short': '<i2', 'int16': '<i2', 'ushort': '<u2', 'uint16': '<u2',
         'int': '<i4', 'int32': '<i4', 'uint': '<u4', 'uint32': '<u4',
         'float': '<f4', 'float32': '<f4', 'double': '<f8', 'float64': '<f8'}
REQUIRED = ('x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
            'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3')
NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')


def regular_bytes(path, maximum=MAX_BYTES):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise ValueError('Use a nonempty bounded regular input file.')
    with path.open('rb') as stream:
        raw = stream.read(maximum + 1)
    if not 0 < len(raw) <= maximum:
        raise ValueError('Input exceeds its byte limit.')
    return raw


@dataclass
class GaussianPLY:
    raw: bytes
    records: np.ndarray
    properties: list[tuple[str, str]]
    format: str
    rest_count: int

    @property
    def sha256(self):
        return hashlib.sha256(self.raw).hexdigest()

    def splats(self, donor_field):
        from ._vendor.io import SplatSet
        data = self.records
        def cols(names):
            return np.stack([data[n] for n in names], axis=-1).astype(np.float32)
        rest = cols([f'f_rest_{i}' for i in range(self.rest_count)]) if self.rest_count else np.empty((len(data), 0), np.float32)
        consumed = set(REQUIRED) | {f'f_rest_{i}' for i in range(self.rest_count)}
        extras = {n: data[n].copy() for _, n in self.properties if n not in consumed}
        extras[donor_field] = np.arange(len(data), dtype=np.int32)
        return SplatSet(xyz=cols(('x', 'y', 'z')), f_dc=cols(('f_dc_0', 'f_dc_1', 'f_dc_2')),
                        f_rest=rest.reshape(len(data), 3, self.rest_count // 3).transpose(0, 2, 1).copy(),
                        opacity=data['opacity'].astype(np.float32), scale=cols(('scale_0', 'scale_1', 'scale_2')),
                        rot=cols(('rot_0', 'rot_1', 'rot_2', 'rot_3')), extra=extras)


def validate_records(records, rest_count):
    for name in records.dtype.names:
        if not np.isfinite(records[name]).all():
            raise ValueError('PLY scalar properties must all be finite.')
    limits = {'x': 1e6, 'y': 1e6, 'z': 1e6, 'opacity': 80.0}
    limits.update({f'f_dc_{i}': 100.0 for i in range(3)})
    limits.update({f'f_rest_{i}': 100.0 for i in range(rest_count)})
    for name, bound in limits.items():
        if np.any(np.abs(records[name].astype(np.float64)) > bound):
            raise ValueError('Gaussian coordinates or appearance exceed the bounded repair profile.')
    scale = np.stack([records[f'scale_{i}'] for i in range(3)], axis=-1)
    if np.any(scale < -16) or np.any(scale > 8):
        raise ValueError('Gaussian log scales must be between -16 and 8.')
    rotations = np.stack([records[f'rot_{i}'] for i in range(4)], axis=-1).astype(np.float64)
    norm = np.linalg.norm(rotations, axis=1)
    if np.any(norm < 1e-8) or np.any(norm > 1e8):
        raise ValueError('Gaussian rotations need a finite nonzero quaternion.')


def read_ply(path):
    raw = regular_bytes(path)
    offset = 0; lines = []
    while offset < min(len(raw), MAX_HEADER):
        end = raw.find(b'\n', offset, min(len(raw), MAX_HEADER))
        if end < 0:
            break
        try:
            line = raw[offset:end].decode('ascii').strip()
        except UnicodeDecodeError as error:
            raise ValueError('PLY header must be ASCII.') from error
        lines.append(line); offset = end + 1
        if line == 'end_header':
            break
    if not lines or lines[0] != 'ply' or lines[-1] != 'end_header':
        raise ValueError('Use a PLY with a complete header under 64 KiB.')
    fmt = None; count = None; props = []; names = set()
    for line in lines[1:-1]:
        parts = line.split()
        if not parts or parts[0] in ('comment', 'obj_info'):
            continue
        if parts[0] == 'format' and len(parts) == 3 and fmt is None and count is None and parts[2] == '1.0':
            fmt = parts[1]
            if fmt not in ('ascii', 'binary_little_endian'):
                raise ValueError('Use ASCII or binary little-endian Gaussian PLY.')
        elif parts[0] == 'element' and len(parts) == 3 and parts[1] == 'vertex' and count is None and fmt:
            if not parts[2].isdigit():
                raise ValueError('Invalid PLY vertex count.')
            count = int(parts[2])
            if not 120 <= count <= MAX_VERTICES:
                raise ValueError('Repair accepts 120 to 200,000 Gaussian vertices without thinning.')
        elif parts[0] == 'property' and len(parts) == 3 and count is not None:
            ty, name = parts[1:]
            if ty not in TYPES or not NAME.fullmatch(name) or name in names or len(props) >= MAX_PROPERTIES:
                raise ValueError('PLY needs unique bounded scalar properties; lists are not supported.')
            props.append((ty, name)); names.add(name)
        else:
            raise ValueError('Unsupported or repeated PLY header declaration; only one vertex element is supported.')
    if count is None or not set(REQUIRED) <= names:
        raise ValueError('Use a complete Gaussian PLY including DC colour, opacity, log scales and quaternion.')
    rest_names = {name for name in names if name.startswith('f_rest_')}
    n_rest = len(rest_names)
    if n_rest not in (0, 9, 24, 45) or rest_names != {f'f_rest_{i}' for i in range(n_rest)}:
        raise ValueError('SH coefficients must be contiguous channel-major degree 0 to 3.')
    dtype = np.dtype([(name, TYPES[ty]) for ty, name in props])
    if any(dtype[n].kind != 'f' for n in set(REQUIRED) | rest_names):
        raise ValueError('Gaussian parameters must be float32 or float64.')
    if count * dtype.itemsize > MAX_BYTES:
        raise ValueError('Decoded Gaussian records exceed 64 MiB.')
    body = raw[offset:]
    if fmt == 'binary_little_endian':
        if len(body) != count * dtype.itemsize:
            raise ValueError('PLY body does not match its declared vertex count and properties.')
        records = np.frombuffer(body, dtype=dtype, count=count).copy()
    else:
        rows = body.splitlines()
        if len(rows) != count:
            raise ValueError('ASCII PLY needs exactly one complete line per vertex.')
        records = np.empty(count, dtype=dtype)
        for i, row in enumerate(rows):
            if len(row) > 16384:
                raise ValueError('ASCII PLY vertex line is oversized.')
            fields = row.split()
            if len(fields) != len(props):
                raise ValueError('ASCII PLY vertex property count mismatch.')
            for (ty, name), token in zip(props, fields):
                kind = dtype[name].kind
                try:
                    if kind in 'iu':
                        if not re.fullmatch(rb'[+-]?\d+', token):
                            raise ValueError('Invalid integer scalar.')
                        value = int(token); info = np.iinfo(dtype[name])
                        if not info.min <= value <= info.max:
                            raise ValueError('Integer scalar out of range.')
                    else:
                        value = float(token)
                        if not np.isfinite(value) or abs(value) > np.finfo(dtype[name]).max:
                            raise ValueError('Invalid float scalar.')
                    records[name][i] = value
                except (ValueError, OverflowError) as error:
                    raise ValueError('Invalid or out-of-range ASCII PLY scalar.') from error
    validate_records(records, n_rest)
    return GaussianPLY(raw, records, props, fmt, n_rest)


def encode_repaired(source, kept, added, donor_ids):
    generated = source.records[donor_ids].copy()
    for group, values in [(('x', 'y', 'z'), added.xyz), (tuple(f'f_dc_{i}' for i in range(3)), added.f_dc),
                          (tuple(f'scale_{i}' for i in range(3)), added.scale), (tuple(f'rot_{i}' for i in range(4)), added.rot)]:
        for i, name in enumerate(group):
            generated[name] = values[:, i]
    generated['opacity'] = added.opacity
    rest = added.f_rest.transpose(0, 2, 1).reshape(added.n, source.rest_count)
    for i in range(source.rest_count):
        generated[f'f_rest_{i}'] = rest[:, i]
    # Retained source records, including doubles, extra attributes and signed
    # zero bits, are copied directly; the upstream float32 view is never used.
    records = np.concatenate([source.records[kept], generated])
    validate_records(records, source.rest_count)
    lines = ['ply', 'format binary_little_endian 1.0',
             'comment BrainSNN generated appearance repair; not measured or collision geometry',
             'comment parent_sha256 ' + source.sha256, 'element vertex ' + str(len(records)),
             *[f'property {ty} {name}' for ty, name in source.properties], 'end_header', '']
    raw = '\n'.join(lines).encode('ascii') + records.tobytes()
    if len(raw) > MAX_BYTES:
        raise ValueError('Repaired output exceeds the 64 MiB profile; reduce the source or repair region.')
    return raw
