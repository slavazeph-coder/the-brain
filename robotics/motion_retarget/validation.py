"""Validate untrusted BVH before importing GPU/native libraries. No network access."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re

MAX_BVH_BYTES = 8 * 1024 * 1024
MAX_OPTIONS_BYTES = 16384
MAX_FRAMES = 1800
MAX_JOINTS = 128
MAX_SECONDS = 60
SCHEMA = 'brainsnn.motion-retarget-options.v1'
CHANNELS = {'Xposition', 'Yposition', 'Zposition', 'Xrotation', 'Yrotation', 'Zrotation'}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_regular(path: Path, limit: int) -> bytes:
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError(f'Expected a nonempty regular file no larger than {limit} bytes.')
    data = path.read_bytes()
    if len(data) > limit:
        raise ValueError('Input grew beyond its size budget.')
    return data


def strict_json(raw: bytes):
    def unique(pairs):
        out = {}
        for key, val in pairs:
            if key in out:
                raise ValueError(f'Duplicate JSON key: {key}')
            out[key] = val
        return out
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON number.')))


def options_from_bytes(raw: bytes) -> dict:
    if not 0 < len(raw) <= MAX_OPTIONS_BYTES:
        raise ValueError('Motion options exceed the 16 KiB budget.')
    opts = strict_json(raw)
    allowed = {'schema', 'target', 'source_units', 'source_up_axis', 'source_facing', 'fps'}
    if not isinstance(opts, dict) or set(opts) - allowed or opts.get('schema') != SCHEMA:
        raise ValueError(f'Expected {SCHEMA} with only documented fields.')
    if opts.get('target') != 'unitree_g1':
        raise ValueError('This qualified profile supports unitree_g1 only.')
    if opts.get('source_units') not in ('cm', 'm') or opts.get('source_up_axis') != 'Y':
        raise ValueError('Declare source_units cm or m and source_up_axis Y; no axis inference is performed.')
    if opts.get('source_facing') not in ('Mujoco', 'Maya'):
        raise ValueError('Explicit upstream source_facing Mujoco or Maya is required.')
    if 'fps' in opts:
        fps = opts['fps']
        if type(fps) not in (int, float) or not math.isfinite(fps) or not 1 <= fps <= 240:
            raise ValueError('Optional fps must be finite and between 1 and 240.')
    return dict(opts)


@dataclass
class BVH:
    joints: list[dict]
    frames: list[list[float]]
    frame_time: float

    @property
    def fps(self):
        return 1 / self.frame_time

    def topology(self):
        return [(j['name'], self.joints[j['parent']]['name'] if j['parent'] >= 0 else None)
                for j in self.joints]

    def canonical_bytes(self, source_units='cm') -> bytes:
        """Canonical line layout understood by upstream; only length values are normalized."""
        scale = 100 if source_units == 'm' else 1
        lines = ['HIERARCHY']
        def emit(index, depth):
            j = self.joints[index]
            pad = '  ' * depth
            lines.extend([pad + ('ROOT ' if j['parent'] < 0 else 'JOINT ') + j['name'], pad + '{',
                          pad + '  OFFSET ' + ' '.join(format(v * scale, '.12g') for v in j['offset']),
                          pad + '  CHANNELS ' + str(len(j['channels'])) + ' ' + ' '.join(j['channels'])])
            children = [i for i, child in enumerate(self.joints) if child['parent'] == index]
            for i in children:
                emit(i, depth + 1)
            if not children:
                lines.extend([pad + '  End Site', pad + '  {', pad + '    OFFSET 0 0 0', pad + '  }'])
            lines.append(pad + '}')
        emit(0, 0)
        lines += ['MOTION', f'Frames: {len(self.frames)}', f'Frame Time: {self.frame_time:.15g}']
        channels = [c for j in self.joints for c in j['channels']]
        for row in self.frames:
            lines.append(' '.join(format(v * scale if c.endswith('position') else v, '.12g')
                                  for c, v in zip(channels, row)))
        return ('\n'.join(lines) + '\n').encode()


def parse_bvh(raw: bytes, *, qualification_reference=False) -> BVH:
    """Strict line-oriented BVH, including SOMA's six-number OFFSET extension.

    The last three OFFSET numbers are ignored by upstream too; the animation's
    rotation channels are authoritative. Namespace stripping is not allowed.
    """
    if not 0 < len(raw) <= MAX_BVH_BYTES:
        raise ValueError('BVH exceeds the 8 MiB budget.')
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeError as exc:
        raise ValueError('BVH must be UTF-8 text.') from exc
    if '\x00' in text:
        raise ValueError('Binary BVH is not supported.')
    lines = [s.strip() for s in text.splitlines() if s.strip()]
    cursor = 0
    def take():
        nonlocal cursor
        if cursor >= len(lines):
            raise ValueError('Truncated BVH.')
        line = lines[cursor]; cursor += 1
        return line
    def expect(expected):
        if take() != expected:
            raise ValueError(f'Expected BVH {expected}.')
    def numbers(tokens, bound=1e6):
        try:
            vals = [float(t) for t in tokens]
        except ValueError as exc:
            raise ValueError('Invalid BVH number.') from exc
        if any(not math.isfinite(v) or abs(v) > bound for v in vals):
            raise ValueError('BVH numbers must be finite and bounded.')
        return vals
    expect('HIERARCHY')
    joints, names = [], set()
    def node(parent, depth):
        if depth > 32 or len(joints) >= MAX_JOINTS:
            raise ValueError('BVH hierarchy exceeds the supported size.')
        declaration = take().split()
        keyword = 'ROOT' if parent < 0 else 'JOINT'
        if len(declaration) != 2 or declaration[0] != keyword or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', declaration[1]):
            raise ValueError('Expected an unnamespaced BVH joint name.')
        name = declaration[1]
        if name in names:
            raise ValueError('Duplicate BVH joint name.')
        names.add(name); expect('{')
        offset = take().split()
        if offset[0] != 'OFFSET' or len(offset) not in (4, 7):
            raise ValueError('Expected three or six OFFSET values.')
        values = numbers(offset[1:])
        ch = take().split()
        if len(ch) < 2 or ch[0] != 'CHANNELS' or ch[1] not in ('3', '6') or len(ch) != int(ch[1]) + 2:
            raise ValueError('Expected three rotation or six position/rotation channels.')
        channels = ch[2:]
        if len(set(channels)) != len(channels) or set(channels) - CHANNELS or not {'Xrotation', 'Yrotation', 'Zrotation'} <= set(channels):
            raise ValueError('Unsupported or duplicate BVH channels.')
        if parent < 0 and len(channels) != 6:
            raise ValueError('BVH root requires translation and rotation channels.')
        index = len(joints)
        joints.append({'name': name, 'parent': parent, 'offset': values[:3], 'channels': channels})
        end_seen = False
        while cursor < len(lines) and lines[cursor] != '}':
            if lines[cursor] == 'End Site':
                if end_seen:
                    raise ValueError('Duplicate End Site.')
                end_seen = True; take(); expect('{')
                end = take().split()
                if len(end) not in (4, 7) or end[0] != 'OFFSET':
                    raise ValueError('Malformed End Site.')
                numbers(end[1:]); expect('}')
            else:
                if end_seen:
                    raise ValueError('Joint cannot follow its End Site.')
                node(index, depth + 1)
        expect('}')
    node(-1, 0)
    expect('MOTION')
    f = take().split(); t = take().split()
    if len(f) != 2 or f[0] != 'Frames:' or not f[1].isdigit():
        raise ValueError('Invalid declared BVH frame count.')
    count = int(f[1])
    if not (1 if qualification_reference else 2) <= count <= MAX_FRAMES:
        raise ValueError(f'Expected 2 to {MAX_FRAMES} motion frames.')
    if len(t) != 3 or t[:2] != ['Frame', 'Time:']:
        raise ValueError('Explicit BVH Frame Time is required.')
    dt = numbers(t[2:])[0]
    if not 1/240 <= dt <= 1 or (count - 1) * dt > MAX_SECONDS:
        raise ValueError('Motion must be 1–240 FPS and no more than 60 seconds.')
    if len(lines) - cursor != count:
        raise ValueError('Declared BVH frame count does not match its rows.')
    width = sum(len(j['channels']) for j in joints)
    frames = []
    for line in lines[cursor:]:
        row = numbers(line.split())
        if len(row) != width:
            raise ValueError('BVH frame width does not match its channels.')
        frames.append(row)
    return BVH(joints, frames, dt)


def validate_source(raw: bytes, opts: dict, reference: BVH | None = None) -> BVH:
    motion = parse_bvh(raw)
    if 'fps' in opts and not math.isclose(opts['fps'], motion.fps, rel_tol=1e-5):
        raise ValueError('Declared FPS disagrees with BVH Frame Time; no silent resampling.')
    if reference is not None and motion.topology() != reference.topology():
        raise ValueError('BVH must use the pinned SOMA base joint names, hierarchy and order.')
    scale = .01 if opts['source_units'] == 'cm' else 1
    if any(abs(v) * scale > 1000 for j in motion.joints for v in j['offset']):
        raise ValueError('Skeleton dimensions exceed 1000 metres.')
    channels = [c for j in motion.joints for c in j['channels']]
    if any(abs(v) * scale > 1000 for row in motion.frames for c, v in zip(channels, row) if c.endswith('position')):
        raise ValueError('Motion translation exceeds 1000 metres.')
    return motion
