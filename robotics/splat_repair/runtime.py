"""Pinned upstream CPU engine, resource screening and source-index provenance."""
from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
from pathlib import Path

import numpy as np

REVISION = '8487b80bdb512650a7cbc1a8165af62c34b9567d'
MAX_GRID_CELLS = 65_536
MAX_GENERATED = 50_000


def verify_vendor():
    root = Path(__file__).resolve().parent
    lock = json.loads((root / 'UPSTREAM.json').read_text())
    if lock['revision'] != REVISION:
        raise RuntimeError('Unexpected Splat Repair upstream revision.')
    for row in lock['files']:
        path = root / row['local']
        if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise RuntimeError('Pinned Splat Repair source integrity check failed.')
    return lock


def fast_fill(source, options):
    lock = verify_vendor()
    from ._vendor.repair import RepairParams, repair, _rim_band
    field = '__brainsnn_donor_index'
    while field in source.records.dtype.names:
        field += '_'
    splats = source.splats(field)
    knobs = options['parameters']
    params = RepairParams(mode=knobs['mode'], density=knobs['density'],
                          roughness=knobs['roughness'], color_smooth=knobs['colorSmooth'], seed=knobs['seed'])
    selected = np.asarray(options['selection']['indices'], dtype=np.int64)
    mask = np.zeros(splats.n, bool); mask[selected] = True
    alpha = 1.0 / (1.0 + np.exp(-np.clip(splats.opacity, -80, 80)))
    _, _, _, spacing, candidates, _ = _rim_band(splats.xyz, mask, alpha, params, np.random.default_rng(params.seed))
    # The upstream engine builds surface grids. Bound the enclosing 3-D
    # diameter in grid cells before it allocates one, including any orientation.
    # This intentionally rejects huge/dispersed selections rather than thinning
    # the original file or silently changing the selected region.
    local = splats.xyz[np.concatenate([selected, candidates])].astype(np.float64)
    diameter = float(np.linalg.norm(np.ptp(local, axis=0)))
    if not np.isfinite(spacing) or spacing <= 0 or not np.isfinite(diameter):
        raise ValueError('The selection needs a finite, nondegenerate local splat spacing.')
    side = int(np.ceil(diameter / (2 * spacing))) + 4
    if side * side > MAX_GRID_CELLS:
        raise ValueError('The repair region exceeds the bounded surface grid; select a smaller compact region.')
    result = repair(splats, selected, params)
    removed = np.asarray(result.removed)
    if removed.ndim != 1 or removed.dtype.kind not in 'iu' or not len(removed) \
            or np.any(removed < 0) or np.any(removed >= splats.n) or len(np.unique(removed)) != len(removed):
        raise RuntimeError('Upstream returned an invalid removed-index mapping.')
    if not 1 <= result.added.n <= MAX_GENERATED:
        raise ValueError('No bounded generated fill was produced; the original source was not changed.')
    if field not in result.added.extra:
        raise RuntimeError('Upstream did not retain the generated donor mapping.')
    donors = np.asarray(result.added.extra[field])
    if donors.shape != (result.added.n,) or donors.dtype.kind not in 'iu' \
            or np.any(donors < 0) or np.any(donors >= splats.n):
        raise RuntimeError('Upstream returned an invalid donor-index mapping.')
    keep = np.ones(splats.n, bool); keep[removed] = False
    kept = np.flatnonzero(keep)
    if len(kept) + result.added.n > 200_000:
        raise ValueError('The repaired result exceeds 200,000 splats; use a smaller source or region.')
    backing = np.zeros(result.added.n, bool) if result.backing is None else np.asarray(result.backing)
    if backing.shape != (result.added.n,) or backing.dtype.kind != 'b':
        raise RuntimeError('Upstream returned an invalid generated backing mask.')
    return result, kept, donors, backing, {'upstream': lock, 'effectiveParameters': asdict(params),
                                         'screening': {'localSpacing': float(spacing), 'gridCellUpperBound': side * side,
                                                       'maxGridCells': MAX_GRID_CELLS, 'maxGenerated': MAX_GENERATED}}
