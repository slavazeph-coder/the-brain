"""Offline pixel-to-PTS association on authored variable-frame-rate media."""
from fractions import Fraction
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image
import pytest

TOOL = Path(__file__).resolve().parents[2] / 'scripts/world-demo/match_showroom_frames.py'
SPEC = importlib.util.spec_from_file_location('match_showroom_frames', TOOL)
matcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matcher)

pytestmark = pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'), reason='FFmpeg tools required')


def test_vfr_timing_includes_all_candidates_and_rejects_ambiguous_or_missing_views(tmp_path):
    rng = np.random.default_rng(19)
    folder = tmp_path / 'images'
    folder.mkdir()
    for name in ['one', 'two', 'repeated', 'three', 'unrelated']:
        data = rng.integers(0, 256, size=(matcher.HEIGHT, matcher.WIDTH), dtype=np.uint8)
        Image.fromarray(data).save(folder / f'{name}.png')
    manifest = tmp_path / 'sequence.ffconcat'
    manifest.write_text("ffconcat version 1.0\nfile 'images/one.png'\nduration 0.08\n"
                        "file 'images/two.png'\nduration 0.24\nfile 'images/repeated.png'\nduration 0.04\n"
                        "file 'images/repeated.png'\nduration 0.16\nfile 'images/three.png'\n")
    movie = tmp_path / 'capture.mkv'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'concat', '-i', str(manifest), '-fps_mode', 'passthrough',
                    '-output_ts_offset', '3', '-c:v', 'ffv1', str(movie)], check=True)
    shutil.copyfile(folder / 'one.png', folder / 'another-one.png')
    result = matcher.match_frames(movie, folder)
    assert result['sourceSha256'] == hashlib.sha256(movie.read_bytes()).hexdigest()
    assert result['sourceFrames'] == 5
    assert set(result['matches']) == {'two.png', 'three.png'}
    for name, ordinal, wanted_pts in [('two.png', 1, Fraction(308, 100)), ('three.png', 4, Fraction(352, 100))]:
        record = result['matches'][name]
        assert record['sourceDisplayFrameIndex'] == ordinal
        assert record['pts'] * Fraction(result['timeBase']) == wanted_pts
    assert result['misses']['repeated.png']['reason'] == 'ambiguous source frames'
    assert result['misses']['unrelated.png']['reason'] == 'source image differs'
    assert 'multiple retained' in result['misses']['another-one.png']['reason']
    assert 'one.png' in result['misses']

    receipt = tmp_path / 'receipt.json'
    receipt.write_text(json.dumps({'images': ['one.png']}))
    report = tmp_path / 'results.json'
    subprocess.run([sys.executable, str(TOOL), '--source', str(movie), '--frames-dir', str(folder),
                    '--receipt', str(receipt), '--output', str(report)], check=True)
    assert json.loads(report.read_text())['matches']['one.png']['timeSeconds'] == 3


def test_mismatched_decoded_timestamps_are_rejected(tmp_path):
    movie = tmp_path / 'source.mkv'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=size=96x54:rate=10',
                    '-frames:v', '2', '-c:v', 'ffv1', str(movie)], check=True)
    crc = tmp_path / 'decoded.crc'
    crc.write_text('#tb 0: 1/1000\n0,0,0,100,5184,0x123\n0,100,150,100,5184,0x456\n')
    with pytest.raises(ValueError, match='timestamp mismatch'):
        matcher.source_times(movie, tmp_path, 2, {0, 1})
