"""A ray-cast room whose truth is authored, for the "one robot sees, another adapts" loop.

The room, its textures and the five level as-is cameras match test_native_capture.rendered_capture, so the default
as-is scan reconstructs the same way. Boxes (textured or plain) can stand in the room before and after, and cameras can
turn, tilt and zoom like a phone carried on a walk; walk frames can be degraded (exposure, noise, blur, JPEG).

Renderer frame: x right, y down, z forward. The capture bundle states poses in the ARKit frame (y up, z back), and the
worker writes the aligned reconstruction in its output basis (arkit_world_to_output_basis, diag(1, -1, -1)), which is
the renderer frame again: model coordinates are renderer coordinates, up is -y, and floor coordinates are (x, z).
"""
import hashlib
import io
import json
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H, F = 800, 600, 650.
CX, CY = (W - 1) / 2, (H - 1) / 2
FLIP = np.diag([1., -1., -1.])  # renderer -> ARKit capture frame (the bundle only)
FLOOR_Y = 1.5  # renderer y of the floor: 1.5 m below the cameras
# axis, plane position, (u axis, low, high), (v axis, low, high), texture
ROOM = [(2, 4, 0, -2, 2, 1, -1.5, 1.5, 0), (0, -2, 2, 0, 4, 1, -1.5, 1.5, 1), (0, 2, 2, 0, 4, 1, -1.5, 1.5, 2),
        (1, 1.5, 0, -2, 2, 2, 0, 4, 3), (1, -1.5, 0, -2, 2, 2, 0, 4, 4), (2, 2.5, 0, -.65, .5, 1, -.4, .65, 5)]
# Floor-plan truth of the fixed room, as (x range, z range, bottom height, top height) above the floor.
ROOM_SOLIDS = [((-2.05, -2.), (0., 4.), 0., 3.), ((2., 2.05), (0., 4.), 0., 3.), ((-2., 2.), (4., 4.05), 0., 3.),
               ((-.65, .5), (2.5, 2.52), .85, 1.9)]  # the hanging panel


def box(x, z, height, *, lift=0., texture=741, colour=(150, 150, 150)):
    """A box standing on the floor (or lifted): x and z are floor ranges in metres, height above the floor."""
    return {'x': tuple(x), 'z': tuple(z), 'y': (FLOOR_Y - lift - height, FLOOR_Y - lift), 'texture': texture,
            'colour': tuple(colour)}


# The crate set down in the aisle: x -0.9..0.3, z 1.9..2.4, 0.8 m tall (renderer y 0.7..1.5).
CRATE = box((-.9, .3), (1.9, 2.4), .8)


def heights(item):
    """(bottom, top) above the floor."""
    return FLOOR_Y - item['y'][1], FLOOR_Y - item['y'][0]


@lru_cache(maxsize=16)
def textures(seed, count):
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(count):
        tex = Image.new('RGB', (1024, 1024), (120, 120, 130))
        draw = ImageDraw.Draw(tex)
        for _ in range(6000):
            x, y = rng.integers(0, 1024, 2)
            r = int(rng.integers(3, 15))
            draw.rectangle((int(x), int(y), int(x + r), int(y + r)), fill=tuple(map(int, rng.integers(15, 245, 3))))
        out.append(np.asarray(tex))
    return tuple(out)


def box_faces(item):
    (x0, x1), (y0, y1), (z0, z1) = item['x'], item['y'], item['z']
    # front, back, left, right, top, underside (a lifted slab shows it)
    return [(2, z0, 0, x0, x1, 1, y0, y1), (2, z1, 0, x0, x1, 1, y0, y1), (0, x0, 2, z0, z1, 1, y0, y1),
            (0, x1, 2, z0, z1, 1, y0, y1), (1, y0, 0, x0, x1, 2, z0, z1), (1, y1, 0, x0, x1, 2, z0, z1)]


SHADE = [1., .8, .9, .85, 1.1, .6]  # plain boxes: one flat colour per face, as if lit from above and in front
BOX_TEXELS_PER_M = 256.  # boxes are textured at a physical scale (the walls get about this), so small faces do not alias


def rotation(yaw=0., pitch=0.):
    """Camera-to-renderer rotation: turned right by `yaw` and down by `pitch` degrees."""
    a, b = np.radians(pitch), np.radians(yaw)
    down = np.array([[1, 0, 0], [0, np.cos(a), np.sin(a)], [0, -np.sin(a), np.cos(a)]])
    right = np.array([[np.cos(b), 0, np.sin(b)], [0, 1, 0], [-np.sin(b), 0, np.cos(b)]])
    return right @ down


class Scene:
    def __init__(self):
        self.room = textures(740, 6)

    def render(self, centre, pitch_degrees=0., crate=False, *, yaw=0., focal=F, objects=None, supersample=2):
        """RGB image from a camera at `centre` (renderer frame). Each pixel averages supersample x supersample rays, as
        a real sensor integrates over its pixel: without it, surfaces seen at a grazing angle alias into noise."""
        items = list(objects or []) + ([CRATE] if crate else [])
        R = rotation(yaw, pitch_degrees)
        n = supersample
        f, cx, cy = focal * n, CX * n + (n - 1) / 2, CY * n + (n - 1) / 2
        yy, xx = np.mgrid[:H * n, :W * n]
        ray = np.stack(((xx - cx) / f, (yy - cy) / f, np.ones_like(xx, dtype=float)), axis=-1) @ R.T
        C = np.asarray(centre, dtype=float)
        best = np.full((H * n, W * n), np.inf)
        rgb = np.zeros((H * n, W * n, 3), dtype=np.uint8)
        surfaces = [(*s[:8], self.room[s[8]], None, False) for s in ROOM]
        for item in items:
            tex = textures(item['texture'], 6) if item['texture'] is not None else None
            for index, face in enumerate(box_faces(item)):
                colour = None if tex else np.clip(np.array(item['colour']) * SHADE[index], 0, 255).astype(np.uint8)
                surfaces.append((*face, tex[index] if tex else None, colour, True))
        for axis, pos, ua, lo, hi, va, vlo, vhi, tex, colour, physical in surfaces:
            with np.errstate(divide='ignore', invalid='ignore'):
                t = (pos - C[axis]) / ray[:, :, axis]
                P = C + t[:, :, None] * ray
            valid = (t > 1e-6) & (t < best) & (P[:, :, ua] >= lo) & (P[:, :, ua] <= hi) & (P[:, :, va] >= vlo) & (P[:, :, va] <= vhi)
            if tex is None:
                rgb[valid] = colour
            elif physical:
                u = (np.nan_to_num(P[:, :, ua] - lo, nan=0, posinf=0, neginf=0) * BOX_TEXELS_PER_M).astype(int) % 1024
                v = (np.nan_to_num(P[:, :, va] - vlo, nan=0, posinf=0, neginf=0) * BOX_TEXELS_PER_M).astype(int) % 1024
                rgb[valid] = tex[v[valid], u[valid]]
            else:
                u = np.clip(np.nan_to_num((P[:, :, ua] - lo) / (hi - lo), nan=0, posinf=0, neginf=0) * 1023, 0, 1023).astype(int)
                v = np.clip(np.nan_to_num((P[:, :, va] - vlo) / (vhi - vlo), nan=0, posinf=0, neginf=0) * 1023, 0, 1023).astype(int)
                rgb[valid] = tex[v[valid], u[valid]]
            best[valid] = t[valid]
        if n > 1:
            rgb = rgb.reshape(H, n, W, n, 3).mean(axis=(1, 3)).round().astype(np.uint8)
        return rgb, R

    def capture(self, root, cameras, objects=()):
        """An as-is walkthrough with native (ARKit-style) poses, as an adapter request. Cameras: dicts with
        centre, and optional yaw and pitch in degrees."""
        root.mkdir(parents=True)
        frames = []
        for i, camera in enumerate(cameras):
            rgb, R = self.render(camera['centre'], camera.get('pitch', 0.), yaw=camera.get('yaw', 0.), objects=objects)
            path = root / f'frame-{i}.png'
            Image.fromarray(rgb).save(path)
            pose = np.eye(4)
            pose[:3, :3] = FLIP @ R @ FLIP  # renderer camera/world -> ARKit camera/world
            pose[:3, 3] = FLIP @ np.asarray(camera['centre'], dtype=float)
            frames.append({'id': str(i), 'image': path.name, 'image_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                           'image_size': [W, H], 'timestamp_seconds': i * .4, 'tracking_state': 'normal',
                           'intrinsics': [[F, 0, CX], [0, F, CY], [0, 0, 1]], 'camera_to_world': pose.tolist()})
        bundle = {'schema': 'brainsnn.capture.v1', 'pose_convention': 'arkit-camera-to-world', 'units': 'm',
                  'pixel_convention': 'integer-centres', 'frames': frames}
        (root / 'capture.json').write_text(json.dumps(bundle))
        inputs = [{'name': 'capture.json', 'kind': 'capture', 'path': str(root / 'capture.json')}]
        inputs += [{'name': f['image'], 'kind': 'image', 'path': str(root / f['image'])} for f in frames]
        return {'schema': 'brainsnn.adapter.v1', 'inputs': inputs, 'output_dir': str(root / 'job' / 'artifacts')}

    def before_capture(self, root, objects=(), rich=False):
        """The as-is walkthrough: five level frames; `rich` adds five frames 0.5 m further in, tilted 20 degrees down,
        as a phone scan that also looks at the floor."""
        cameras = [{'centre': [x, 0., 0.]} for x in (-1., -.5, 0., .5, 1.)]
        if rich:
            cameras += [{'centre': [x, 0., .5], 'pitch': 20.} for x in (-1., -.5, 0., .5, 1.)]
        return self.capture(root, cameras, objects)

    def walk(self, root, cameras, objects=(), *, focal=F, gain=1., noise=0., blur=0., jpeg=None, seed=0):
        """Robot A's camera on its next pass. Returns frame paths and true camera centres (model coordinates)."""
        root.mkdir(parents=True)
        rng = np.random.default_rng(seed)
        paths, centres = [], []
        for i, camera in enumerate(cameras):
            rgb, _ = self.render(camera['centre'], camera.get('pitch', 15.), yaw=camera.get('yaw', 0.), focal=focal,
                                 objects=objects)
            image = rgb.astype(float) * gain
            if noise:
                image += rng.normal(0, noise, image.shape)
            photo = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
            if blur:
                photo = photo.filter(ImageFilter.GaussianBlur(blur))
            path = root / (f'after-{i}.jpg' if jpeg else f'after-{i}.png')
            if jpeg:
                buffer = io.BytesIO()
                photo.save(buffer, format='JPEG', quality=jpeg)
                path.write_bytes(buffer.getvalue())
            else:
                photo.save(path)
            paths.append(path)
            centres.append(list(camera['centre']))
        return paths, np.array(centres, dtype=float)

    def after_walk(self, root, crate=True, xs=(-.75, -.25, .25, .75), z=.2, pitch=15.):
        """The default walk: four frames across the room near its entrance, tilted down, with or without the crate."""
        return self.walk(root, [{'centre': [x, 0., z], 'pitch': pitch} for x in xs], [CRATE] if crate else [])


def solids(objects, robot_height):
    """Floor rectangles a robot of this height would hit: room walls, the panel if it is tall enough, and boxes."""
    out = []
    for (x, z, bottom, top) in ROOM_SOLIDS:
        if bottom < robot_height:
            out.append((x, z))
    for item in objects:
        bottom, _ = heights(item)
        if bottom < robot_height:
            out.append((item['x'], item['z']))
    return out


def clearance(waypoints, rectangles):
    """Smallest floor distance from a polyline to any rectangle."""
    best = np.inf
    for a, b in zip(waypoints, waypoints[1:]):
        for t in np.linspace(0, 1, max(2, int(np.hypot(b[0] - a[0], b[1] - a[1]) / .01))):
            px, pz = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            for (x0, x1), (z0, z1) in rectangles:
                best = min(best, np.hypot(max(x0 - px, 0, px - x1), max(z0 - pz, 0, pz - z1)))
    return float(best)
