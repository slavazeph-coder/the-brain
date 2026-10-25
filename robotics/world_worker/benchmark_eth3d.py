"""Scores a worker reconstruction against ETH3D ground truth: metric camera poses and a laser scan.

Works on any engine's output folder that has reconstruction.json (brainsnn.reconstruction.v1) and its preview PLY:
colmap-sparse (`image_000N.jpg` + camera_center) and mapanything-apache (view index + camera_to_world_y_up). Upload the
ETH3D photos with their original names (e.g. DSC_0219.jpg); cameras are matched to ground truth through `sources`.

    python -m robotics.world_worker.benchmark_eth3d --reconstruction JOB/output --eth3d office --out report.json

Reports, all in metres in the ground-truth frame:
- scale: metres per reconstruction unit from aligning cameras (about 1.0 for an engine that predicts metric scale),
  and the camera-centre RMS after that similarity;
- accuracy: distance from each reconstructed point to the nearest laser-scan point;
- completeness: share of the (2 cm voxelised) scan that has a reconstructed point within 5 / 10 cm.
ETH3D data is CC BY-NC-SA: use it for evaluation, never ship it. Needs numpy; scipy makes the nearest-neighbour search fast.
"""
from __future__ import annotations
import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path


def quaternion_matrix(q):
    import numpy as np
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def ground_truth_centres(images_txt: Path):
    """Camera centres by lower-case file stem from a COLMAP-format images.txt (ETH3D dslr_calibration_*)."""
    import numpy as np
    centres = {}
    # Image lines are IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME; the POINTS2D line after each may be empty, so match by shape.
    for line in images_txt.read_text().splitlines():
        parts = line.split()
        if line.startswith('#') or len(parts) != 10 or not re.search(r'\.(jpe?g|png)$', parts[9], re.I):
            continue
        rotation, translation = quaternion_matrix([float(v) for v in parts[1:5]]), np.array([float(v) for v in parts[5:8]])
        centres[Path(parts[9]).stem.lower()] = -rotation.T @ translation
    return centres


def reconstruction_centres(evidence: dict):
    """(source stem, camera centre) per registered camera, for colmap-sparse and mapanything-apache evidence."""
    import numpy as np
    names = [Path(source['name']).stem.lower() for source in evidence.get('sources', [])]
    pairs = []
    for camera in evidence.get('cameras', []):
        if 'camera_center' in camera and re.fullmatch(r'image_(\d{4})\.jpg', str(camera.get('image', ''))):
            index, centre = int(camera['image'][6:10]), np.array(camera['camera_center'], dtype=float)
        elif 'camera_to_world_y_up' in camera and isinstance(camera.get('view'), int):
            index, centre = camera['view'], np.array(camera['camera_to_world_y_up'], dtype=float)[:3, 3]
        else:
            continue
        if 0 <= index < len(names) and centre.shape == (3,) and np.isfinite(centre).all():
            pairs.append((names[index], centre))
    return pairs


def umeyama(source, target):
    """Similarity (s, R, t) minimising |target - (s R source + t)|."""
    import numpy as np
    mean_s, mean_t = source.mean(0), target.mean(0)
    xs, xt = source - mean_s, target - mean_t
    u, d, vt = np.linalg.svd(xt.T @ xs / len(source))
    sign = np.eye(3)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        sign[2, 2] = -1
    rotation = u @ sign @ vt
    scale = np.trace(np.diag(d) @ sign) / (xs ** 2).sum(1).mean()
    return scale, rotation, mean_t - scale * rotation @ mean_s


def read_ply_xyz(path: Path, step: int = 1):
    """x, y, z of an ASCII or binary little-endian PLY (vertex element first), every `step`-th vertex."""
    import numpy as np
    data = path.read_bytes()
    end = data.index(b'end_header\n') + len(b'end_header\n')
    header = data[:end].decode('ascii')
    count = int(re.search(r'element vertex (\d+)', header).group(1))
    props = re.findall(r'property (\w+) (\w+)', header.split('element vertex')[1].split('element')[0])
    if 'binary_little_endian' in header:
        kinds = {'float': '<f4', 'float32': '<f4', 'double': '<f8', 'float64': '<f8', 'uchar': 'u1', 'uint8': 'u1',
                 'char': 'i1', 'int': '<i4', 'uint': '<u4', 'short': '<i2', 'ushort': '<u2'}
        rows = np.frombuffer(data, dtype=np.dtype([(name, kinds[kind]) for kind, name in props]), count=count, offset=end)[::step]
        return np.stack([rows['x'], rows['y'], rows['z']], 1).astype(float)
    columns = [name for _, name in props]
    lines = data[end:].decode('ascii').split('\n')[:count][::step]
    return np.array([[float(v) for v in (line.split()[columns.index(axis)] for axis in 'xyz')] for line in lines])


def scan_points(scan_dir: Path, step: int):
    """ETH3D scan_clean points in the ground-truth frame, using the dataset's own scan_alignment.mlp."""
    import numpy as np
    clouds = []
    for mesh in ET.parse(scan_dir / 'scan_alignment.mlp').getroot().iter('MLMesh'):
        matrix = np.array([float(v) for v in mesh.find('MLMatrix44').text.split()]).reshape(4, 4)
        points = read_ply_xyz(scan_dir / mesh.get('filename'), step)
        clouds.append(points @ matrix[:3, :3].T + matrix[:3, 3])
    return np.concatenate(clouds)


def voxel_downsample(points, size):
    import numpy as np
    _, keep = np.unique(np.floor(points / size).astype(np.int64), axis=0, return_index=True)
    return points[np.sort(keep)]


def nearest_distances(query, reference, chunk=2048):
    """Distance from each query point to its nearest reference point."""
    import numpy as np
    try:
        from scipy.spatial import cKDTree
        return cKDTree(reference).query(query, k=1)[0]
    except ImportError:  # small inputs and tests only; install scipy for real scans
        out = np.empty(len(query))
        for start in range(0, len(query), chunk):
            block = query[start:start + chunk]
            out[start:start + chunk] = np.sqrt(((block[:, None, :] - reference[None, :, :]) ** 2).sum(-1).min(1))
        return out


def score(reconstruction: Path, eth3d: Path, *, scan_step: int = 15, voxel: float = 0.02):
    import numpy as np
    evidence = json.loads((reconstruction / 'reconstruction.json').read_text())
    calibration = next(p for p in [eth3d / 'dslr_calibration_jpg' / 'images.txt', eth3d / 'dslr_calibration_undistorted' / 'images.txt'] if p.is_file())
    truth = ground_truth_centres(calibration)
    pairs = [(name, centre) for name, centre in reconstruction_centres(evidence) if name in truth]
    if len(pairs) < 3:
        raise ValueError(f'Only {len(pairs)} cameras match ETH3D ground truth; upload the dataset photos with their original names.')
    source = np.array([centre for _, centre in pairs]); target = np.array([truth[name] for name, _ in pairs])
    scale, rotation, translation = umeyama(source, target)
    camera_error = np.linalg.norm(target - (scale * source @ rotation.T + translation), axis=1)
    ply = next(p for p in [reconstruction / 'dense-preview.ply', reconstruction / 'sparse-preview.ply'] if p.is_file())
    points = scale * read_ply_xyz(ply) @ rotation.T + translation
    scan = voxel_downsample(scan_points(eth3d / 'scan_clean', scan_step), voxel)
    accuracy = nearest_distances(points, scan)
    completeness = nearest_distances(scan, points)
    return {
        'schema': 'brainsnn.eth3d-benchmark.v1', 'pipeline': evidence.get('pipeline'), 'pointCloud': ply.name,
        'cameras': {'matched': len(pairs), 'groundTruth': len(truth), 'rmsMetres': float(np.sqrt((camera_error ** 2).mean()))},
        'scale': {'metresPerUnit': float(scale)},
        'accuracyMetres': {'points': int(len(points)), 'median': float(np.median(accuracy)), 'p90': float(np.percentile(accuracy, 90)),
                           'within5cm': float((accuracy < .05).mean()), 'within10cm': float((accuracy < .10).mean())},
        'completeness': {'scanVoxels': int(len(scan)), 'voxelMetres': voxel,
                         'within5cm': float((completeness < .05).mean()), 'within10cm': float((completeness < .10).mean())},
        'similarity': {'scale': float(scale), 'rotation': rotation.tolist(), 'translation': translation.tolist()},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--reconstruction', required=True, type=Path, help='worker output folder with reconstruction.json and a preview PLY')
    parser.add_argument('--eth3d', required=True, type=Path, help='ETH3D scene folder (dslr_calibration_jpg/ and scan_clean/)')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--scan-step', type=int, default=15, help='read every Nth laser-scan point (default 15)')
    args = parser.parse_args()
    report = score(args.reconstruction, args.eth3d, scan_step=args.scan_step)
    if args.out:
        args.out.write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k != 'similarity'}, indent=1))


if __name__ == '__main__':
    main()
