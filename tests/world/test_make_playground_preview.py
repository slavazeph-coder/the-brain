import hashlib
import importlib.util
import json
from pathlib import Path
import struct

import pytest


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/world-open4dgs/make_playground_preview.py'
SPEC = importlib.util.spec_from_file_location('make_playground_preview', SCRIPT)
PREVIEW = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREVIEW)

FIELDS = ('x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'f_rest_0',
          'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3')
ROW = struct.Struct('<' + 'f' * len(FIELDS))


def source_frames(directory):
    directory.mkdir()
    metadata = {'source_checkpoint': '/private/source/run/ckpt.pt', 'fps': 30000 / 1001, 'start_frame': 17,
                'n_frames': 3, 'n_primitives_total': 9, 'per_frame_counts': [5, 9, 8]}
    (directory / 'export_meta.json').write_text(json.dumps(metadata), encoding='utf-8')
    for frame, count in enumerate(metadata['per_frame_counts'], metadata['start_frame']):
        body = b''.join(ROW.pack(row, frame, 0, 0, 0, 0, 0, 0.1, 0, row * 0.2, 1, -3, -2, -1, 1, 0, 0, 0)
                        for row in range(count))
        headers = ['ply', 'format binary_little_endian 1.0', f'element vertex {count}',
                   *[f'property float {name}' for name in FIELDS], 'end_header', '']
        (directory / f'frame_{frame:06}.ply').write_bytes('\r\n'.join(headers).encode() + body)
    return metadata


def body(path):
    return path.read_bytes().split(b'end_header\r\n', 1)[1]


def test_consecutive_previews_preserve_fps_and_every_retained_gaussian_attribute(tmp_path):
    source, target = tmp_path / 'upstream', tmp_path / 'preview'
    metadata = source_frames(source)
    report = PREVIEW.make_preview(source, target, start_frame=18, frames=2, max_points=4)
    prepared = json.loads((target / 'export_meta.json').read_bytes())
    assert prepared == {'fps': metadata['fps'], 'start_frame': 18, 'n_frames': 2, 'per_frame_counts': [4, 4]}
    assert report['source_metadata_sha256'] == hashlib.sha256((source / 'export_meta.json').read_bytes()).hexdigest()
    assert '/private/' not in json.dumps(report)
    for receipt in report['frames']:
        original = body(source / receipt['file'])
        expected = b''.join(original[index * ROW.size:(index + 1) * ROW.size] for index in [0, 2, 4, 6])
        assert body(target / receipt['file']) == expected
        assert receipt['preview_sha256'] == hashlib.sha256((target / receipt['file']).read_bytes()).hexdigest()
        assert receipt['source_sha256'] == hashlib.sha256((source / receipt['file']).read_bytes()).hexdigest()


def test_missing_truncated_or_occupied_inputs_leave_output_unpublished(tmp_path):
    source, target = tmp_path / 'upstream', tmp_path / 'preview'
    source_frames(source)
    target.mkdir()
    with pytest.raises(ValueError, match='already exists'):
        PREVIEW.make_preview(source, target)
    assert not list(target.iterdir())
    target.rmdir()

    damaged = source / 'frame_000018.ply'
    damaged.write_bytes(damaged.read_bytes()[:-1])
    with pytest.raises(ValueError, match='payload length'):
        PREVIEW.make_preview(source, target)
    assert not target.exists()
    damaged.unlink()
    with pytest.raises(ValueError, match='Missing regular source'):
        PREVIEW.make_preview(source, target)
    assert not target.exists()
