"""Bind an undistorted pinhole reconstruction and sampled optical-axis depths to a showroom bundle."""
import argparse
import base64
import json
from pathlib import Path

import numpy as np


def camera_record(frame, camera, transform, floor_y, xyz, grid_width):
    width, height = frame['width'], frame['height']
    sx, sy = width / camera['width'], height / camera['height']
    if abs(sx - sy) > 1 / min(camera['width'], camera['height']):
        raise ValueError('The frame must be an uncropped resize of its reconstruction image.')
    if len(camera['parameters']) != 3 or camera.get('model', 'SIMPLE_PINHOLE') != 'SIMPLE_PINHOLE':
        raise ValueError('An undistorted SIMPLE_PINHOLE reconstruction is required.')
    f, cx, cy = camera['parameters']
    extrinsic = np.asarray(camera['world_to_camera'], dtype=float)
    if extrinsic.shape != (3, 4) or not np.all(np.isfinite(extrinsic)) or not np.isfinite([f,cx,cy]).all() or f <= 0:
        raise ValueError('Invalid pinhole camera.')
    rotation, translation = extrinsic[:, :3], extrinsic[:, 3]
    if not np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-4) or np.linalg.det(rotation) <= 0:
        raise ValueError('The camera rotation must be orthonormal.')
    scale = np.linalg.norm(transform[:, 0])
    basis = rotation @ transform[:,:3].T / scale
    center = transform[:,:3] @ (-rotation.T @ translation) + transform[:,3]
    center[1] -= floor_y
    if frame.get('camera') is not None and not np.allclose(center[[0,2]], frame['camera'], atol=.005, rtol=0):
        raise ValueError('The camera center disagrees with the showroom floor position.')
    frame['camera'] = center[[0,2]].tolist()
    frame['pose'] = dict(eye=center.tolist(), right=basis[0].tolist(), down=basis[1].tolist(),
                         forward=basis[2].tolist(), intrinsics=[f*sx,f*sy,cx*sx,cy*sy])
    w = min(width, grid_width)
    h = max(1, round(w*height/width))
    if h > 256:
        raise ValueError('Use a smaller grid width to keep both depth dimensions within 256 pixels.')
    buffer = np.full(w*h, 65536, dtype=np.int32)
    for start in range(0,len(xyz),200_000):
        pts = xyz[start:start+200_000] @ rotation.T + translation
        pts = pts[(pts[:,2]*scale > .02) & (pts[:,2]*scale <= 65.535)]
        uv = (pts[:,:2] * f / pts[:,2,None] + [cx,cy]) * [w/camera['width'],h/camera['height']]
        visible = (uv[:,0]>=0) & (uv[:,0]<w) & (uv[:,1]>=0) & (uv[:,1]<h)
        u,v = uv[visible].astype(np.int32).T
        np.minimum.at(buffer, v*w+u, np.rint(pts[visible,2]*1000*scale).astype(np.int32))
    buffer[buffer > 65535] = 0
    frame['depth'] = dict(width=w, height=h, millimeters=base64.b64encode(buffer.astype('<u2').tobytes()).decode('ascii'))
    return int(np.count_nonzero(buffer)) / buffer.size


def prepare(bundle, cameras, alignment, xyz, grid_width):
    transform = np.asarray(alignment['fromSource'], dtype=float)
    if transform.shape != (3,4) or not np.isfinite(transform).all():
        raise ValueError('Expected a finite 3 by 4 source-to-room transform.')
    linear = transform[:,:3]
    scale = np.linalg.norm(linear[:,0])
    if scale <= 0 or not np.allclose(linear.T@linear/scale**2, np.eye(3), atol=1e-5):
        raise ValueError('The source-to-room transform must have one uniform scale.')
    floor_y = float(alignment['floorEstimate']['y'])
    if not np.isfinite(floor_y) or not 1 <= grid_width <= 256:
        raise ValueError('Invalid floor or depth grid.')
    if xyz.ndim != 2 or xyz.shape[1] != 3 or not len(xyz) or not np.isfinite(xyz).all():
        raise ValueError('Expected a finite, nonempty XYZ point cloud.')
    lookup = {c['image']: c for c in cameras}
    if len(lookup) != len(cameras):
        raise ValueError('Camera image IDs must be unique.')
    return [camera_record(fr,lookup[fr['id']],transform,floor_y,xyz,grid_width) for fr in bundle['frames']]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for arg in ('room','cameras','alignment','cloud','output'):
        parser.add_argument('--'+arg,required=True,type=Path)
    parser.add_argument('--grid-width',type=int,default=240)
    args=parser.parse_args()
    bundle=json.loads(args.room.read_text())
    with np.load(args.cloud,allow_pickle=False) as cloud:
        cover=prepare(bundle,json.loads(args.cameras.read_text())['cameras'],json.loads(args.alignment.read_text()),cloud['xyz'],args.grid_width)
    body=json.dumps(bundle,allow_nan=False,separators=(',',':'))
    if len(body.encode())>32*1024**2:
        raise ValueError('This bundle exceeds the showroom size limit. Choose a smaller depth grid.')
    with args.output.open('x',encoding='utf-8') as out:
        out.write(body)
    print(json.dumps({'frames':len(cover),'meanDepthCoverage':float(np.mean(cover)),'bytes':len(body.encode())}))


if __name__ == '__main__':
    main()
