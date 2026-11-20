"""Recover exact source presentation times for retained stills by matching decoded pixels.

Usage: python match_showroom_frames.py --source capture.mov --frames-dir images
       [--receipt receipt.json] [--output frame-matches.json]

Requires ffmpeg, ffprobe, NumPy and Pillow. A receipt's images array selects the
retained filenames. Each match competes with every decoded source frame.
"""
import argparse
from collections import defaultdict
from contextlib import contextmanager
from fractions import Fraction
import hashlib
import json
from itertools import islice
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageOps

WIDTH, HEIGHT, BATCH = 96, 54, 32
PIXELS = WIDTH * HEIGHT
MAX_FRAMES, MAX_VIEWS = 250_000, 256
FORMATS = {'.png', '.jpg', '.jpeg', '.webp'}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as reader:
        for block in iter(lambda: reader.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def normalize(rows):
    floats = rows.astype(np.float32)
    return (floats - floats.mean(axis=1, keepdims=True)) / np.maximum(floats.std(axis=1, keepdims=True), 1)


def query_images(folder, receipt):
    if receipt is None:
        images = (p.name for p in folder.iterdir() if p.suffix.lower() in FORMATS and p.is_file())
        names = sorted(islice(images, MAX_VIEWS + 1))
    else:
        if receipt.stat().st_size > 4 * 1024 * 1024:
            raise ValueError('Receipt is too large.')
        manifest = json.loads(receipt.read_text())
        names = manifest.get('images') if isinstance(manifest, dict) else None
    if not isinstance(names, list) or not 1 <= len(names) <= MAX_VIEWS:
        raise ValueError(f'Select 1–{MAX_VIEWS} retained images.')
    folder = folder.resolve(strict=True)
    rows, digests, seen = [], [], set()
    for name in names:
        if (not isinstance(name, str) or Path(name).name != name or Path(name).suffix.lower() not in FORMATS
                or name in seen):
            raise ValueError('Choose distinct image filenames within the frames directory.')
        path = (folder / name).resolve(strict=True)
        if path.parent != folder:
            raise ValueError('A retained image points outside the frames directory.')
        seen.add(name)
        digests.append(sha256(path))
        with Image.open(path) as im:
            if im.width * im.height > 40_000_000:
                raise ValueError(f'Still is too large: {name}')
            small = ImageOps.exif_transpose(im).convert('L').resize((WIDTH, HEIGHT), Image.Resampling.BOX)
            rows.append(np.asarray(small).reshape(PIXELS))
    return names, digests, normalize(np.stack(rows))


@contextmanager
def output_stream(args, cwd):
    # Keep diagnostics out of the data stream. Always reap producers if a limit or validation fails.
    with tempfile.TemporaryFile() as errors:
        proc = subprocess.Popen(args, cwd=cwd, stdout=subprocess.PIPE, stderr=errors)
        try:
            yield proc.stdout
            proc.stdout.close()
            if proc.wait() != 0:
                errors.seek(0)
                message = errors.read(1200).decode(errors='replace').strip()
                raise ValueError(f'{Path(args[0]).name} failed: {message}')
        finally:
            proc.stdout.close()
            if proc.poll() is None:
                proc.kill()
            proc.wait()


def best_two(source, folder, queries):
    # Both tee outputs come from the same packet. The framecrc file carries each thumbnail's integer PTS.
    args = ['ffmpeg', '-nostdin', '-hide_banner', '-v', 'error', '-copyts', '-protocol_whitelist', 'file,pipe',
            '-i', str(source), '-map', '0:v:0', '-vf', f'scale={WIDTH}:{HEIGHT}:flags=area,format=gray',
            '-c:v', 'rawvideo', '-threads:v', '1', '-enc_time_base', 'demux', '-fps_mode', 'passthrough',
            '-f', 'tee', '[f=rawvideo]pipe:1|[f=framecrc]decoded.crc']
    count = 0
    # Work on a bounded batch. Retain only the two best candidates per query across all batches.
    best = [[] for _ in queries]
    query_norms = np.mean(queries * queries, axis=1)
    with output_stream(args, folder) as stream:
        while raw := stream.read(BATCH * PIXELS):
            if len(raw) % PIXELS:
                raise ValueError('Decoder produced an incomplete thumbnail.')
            n = len(raw) // PIXELS
            if count + n > MAX_FRAMES:
                raise ValueError(f'Video exceeds {MAX_FRAMES} decoded frames.')
            block = normalize(np.frombuffer(raw, np.uint8).reshape(n, PIXELS))
            mses = query_norms[:, None] + np.mean(block * block, axis=1) - (2 / PIXELS) * (queries @ block.T)
            for i, distances in enumerate(mses):
                # Only two new candidates can displace the previous top two. Stable index breaks exact ties.
                order = np.argsort(distances, kind='stable')[:2]
                additions = [(math.sqrt(max(0, float(distances[j]))), count + int(j)) for j in order]
                best[i] = sorted(best[i] + additions)[:2]
            count += n
    if count < 2:
        raise ValueError('At least two source frames are needed to test ambiguity.')
    return count, best


def source_times(source, folder, count, wanted):
    inputs = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0']
    info = subprocess.run(['ffprobe', *inputs, '-show_entries', 'stream=time_base,start_pts',
                           '-of', 'json', str(source)], check=True, capture_output=True)
    stream = json.loads(info.stdout)['streams'][0]
    time_base = Fraction(stream['time_base'])
    if time_base <= 0:
        raise ValueError('The video stream has no usable time base.')
    start_pts = stream.get('start_pts')
    # ffprobe exposes decoded presentation order including B frames, edits and variable cadence.
    args = ['ffprobe', *inputs, '-show_entries', 'frame=pts:frame_side_data=', '-of', 'flat', str(source)]
    retained = {}
    first_pts = last_pts = encoded_base = None
    index = 0
    with output_stream(args, folder) as probed, (folder / 'decoded.crc').open() as checks:
        for line in checks:
            if line.startswith('#tb 0:'):
                encoded_base = Fraction(line.split(':', 1)[1].strip())
            if line.startswith('#') or not line.strip():
                continue
            fields = line.split(',')
            match = re.fullmatch(rb'frames\.frame\.(\d+)\.pts=(-?\d+)\s*', probed.readline())
            if not match or int(match[1]) != index or len(fields) < 6 or encoded_base is None:
                raise ValueError(f'Missing or unpaired presentation timestamp at frame {index}.')
            pts = int(match[2])
            if int(fields[0]) != 0 or int(fields[4]) != PIXELS or int(fields[2]) * encoded_base != pts * time_base:
                raise ValueError(f'Decoder timestamp mismatch at frame {index}.')
            if last_pts is not None and pts <= last_pts:
                raise ValueError(f'Duplicate or non-increasing presentation timestamp at frame {index}.')
            if index == 0:
                first_pts = pts
            last_pts = pts
            if index in wanted:
                retained[index] = pts
            index += 1
        if index != count or probed.readline():
            raise ValueError('Decoded image and presentation timestamp counts differ.')
    return time_base, start_pts, first_pts, last_pts, retained


def match_frames(source, frames_dir, receipt=None, max_rmse=.12, min_gap=.04):
    if not (0 < max_rmse <= 2 and 0 < min_gap <= 2):
        raise ValueError('Error and separation thresholds must be greater than zero and at most two.')
    source = source.resolve(strict=True)
    before = fingerprint(source)
    source_digest = sha256(source)
    names, digests, queries = query_images(frames_dir, receipt)
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        count, best = best_two(source, folder, queries)
        wanted = {index for pair in best for _, index in pair}
        base, start_pts, first, last, times = source_times(source, folder, count, wanted)
    if before != fingerprint(source):
        raise ValueError('The source video changed during matching.')
    matches, misses = {}, {}
    claimed = defaultdict(list)
    for name, digest, pair in zip(names, digests, best):
        (error, i), (runner, j) = pair
        record = {'imageSha256': digest, 'sourceDisplayFrameIndex': i, 'pts': times[i],
                  'timeSeconds': float(times[i] * base), 'rmsNormalizedLumaDifference': round(error, 6),
                  'runnerUpIndex': j, 'runnerUpPts': times[j], 'runnerUpDifference': round(runner, 6)}
        if error > max_rmse or runner - error < min_gap:
            reason = 'source image differs' if error > max_rmse else 'ambiguous source frames'
            misses[name] = {'reason': reason, 'closestCandidate': record}
        else:
            matches[name] = record
            claimed[i].append(name)
    for group in claimed.values():
        if len(group) > 1:
            for name in group:
                misses[name] = {'reason': 'multiple retained views claim this source frame',
                                'closestCandidate': matches.pop(name)}
    return {'sourceSha256': source_digest, 'timeBase': str(base), 'streamStartPts': start_pts,
            'firstPts': first, 'lastPts': last, 'sourceFrames': count, 'width': WIDTH, 'height': HEIGHT,
            'maxRmse': max_rmse, 'minRunnerUpGap': min_gap, 'matches': matches, 'misses': misses}


def fingerprint(path):
    s = path.stat()
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--frames-dir', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, help='JSON with an images array of retained filenames')
    parser.add_argument('--output', type=Path, help='Write the JSON report here (default: stdout)')
    parser.add_argument('--max-rmse', type=float, default=.12)
    parser.add_argument('--min-gap', type=float, default=.04)
    args = parser.parse_args()
    try:
        if args.output:
            target = args.output.resolve()
            inputs = {args.source.resolve()}
            if args.receipt:
                inputs.add(args.receipt.resolve())
            if target.suffix.lower() != '.json' or target in inputs:
                raise ValueError('Choose a JSON report path separate from the inputs.')
        result = match_frames(args.source, args.frames_dir, args.receipt, args.max_rmse, args.min_gap)
        data = json.dumps(result, indent=2, allow_nan=False) + '\n'
        if args.output:
            args.output.write_text(data)
        else:
            sys.stdout.write(data)
        return 2 if result['misses'] else 0
    except (OSError, ValueError, IndexError, KeyError, subprocess.SubprocessError) as exc:
        parser.exit(1, f'Frame match failed: {exc}\n')


if __name__ == '__main__':
    sys.exit(main())
