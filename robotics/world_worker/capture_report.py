"""Where the walk registered and where it did not, in the walker's own terms: seconds of video, not image ids.

From reconstruction.json alone (sampled frames in capture.frames, registered images in cameras) this builds a timeline
of the capture, finds the stretches that joined the model and the stretches that did not, measures each dropped frame's
sharpness when the prepared images are still on the worker, and says, per stretch, what the data supports: motion blur
(the frames are much softer than the registered ones), or no overlap with the model (sharp frames that still did not
join: a fast turn, a featureless surface, or a part of the room filmed only once). Advice is tied to those stretches.

This is a report on the capture, not on the room: it never changes geometry, scale or review flags, and the longest
registered stretch is the part of the walk the scene actually comes from.
"""
from __future__ import annotations

import json
from pathlib import Path

SCHEMA = 'brainsnn.capture-report.v1'
MIN_STRETCH_SECONDS = 3.0      # shorter gaps are reported inside the timeline but get no advice of their own
BLUR_RATIO = 0.5               # a dropped frame this much softer than the registered median is called motion blur


def sharpness(image_path):
    """Variance of a Laplacian on the grey image at ≤640 px wide: higher is sharper. None when unreadable."""
    try:
        import numpy as np
        from PIL import Image
        with Image.open(image_path) as source:
            grey = source.convert('L')
            if grey.width > 640:
                grey = grey.resize((640, max(1, round(grey.height * 640 / grey.width))))
            a = np.asarray(grey, np.float32)
        lap = -4 * a[1:-1, 1:-1] + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:]
        return float(lap.var())
    except Exception:
        return None


def timeline(reconstruction, images_dir=None):
    """One row per sampled frame: second, registered, sharpness (when measurable)."""
    capture = reconstruction.get('capture') or {}
    frames = capture.get('frames') or []
    registered = {c.get('image') for c in reconstruction.get('cameras') or []}
    fps = capture.get('sample_fps') or 1.0
    rows = []
    for n, frame in enumerate(frames):
        image = frame.get('image')
        index = frame.get('resampledOutputIndex', n)
        second = (index / fps) if fps else float(n)
        path = (Path(images_dir) / image) if images_dir and image else None
        rows.append({'image': image, 'second': round(float(second), 2), 'registered': image in registered,
                     'sharpness': sharpness(path) if path is not None and path.is_file() else None})
    return rows


def stretches(rows, fps):
    """Consecutive runs of registered / dropped frames as [start, end] seconds."""
    runs, step = [], (1.0 / fps) if fps else 1.0
    for row in rows:
        if runs and runs[-1]['registered'] == row['registered']:
            runs[-1]['end'] = row['second'] + step; runs[-1]['frames'] += 1
        else:
            runs.append({'start': row['second'], 'end': row['second'] + step, 'registered': row['registered'], 'frames': 1})
    for r in runs:
        r['seconds'] = round(r['end'] - r['start'], 1); r['start'] = round(r['start'], 1); r['end'] = round(r['end'], 1)
    return runs


def diagnose(run, rows, sharp_median):
    """What the data supports for a dropped stretch."""
    inside = [r for r in rows if run['start'] <= r['second'] < run['end']]
    measured = [r['sharpness'] for r in inside if r['sharpness'] is not None]
    if sharp_median and measured:
        soft = sum(1 for s in measured if s < BLUR_RATIO * sharp_median)
        if soft >= max(1, len(measured) // 2):
            return 'motion-blur', f'{soft} of {len(measured)} frames are much softer than the registered ones: the phone was moving too fast.'
        return 'no-overlap', 'The frames are sharp but none joined the model: a fast turn, a blank or glossy surface, or a part of the room seen only here.'
    return 'no-overlap', 'No frame here joined the model: a fast turn, a blank or glossy surface, or a part of the room seen only here.'


def advice_for(cause):
    return {'motion-blur': 'Walk at half the speed through this part and pause for a second at turns.',
            'no-overlap': 'Film this part again, turning slowly and keeping something you already filmed in view.'}[cause]


def build(reconstruction, images_dir=None):
    rows = timeline(reconstruction, images_dir)
    if not rows:
        return {'schema': SCHEMA, 'status': 'no-frames', 'verdict': 'The reconstruction records no sampled frames, so there is no capture to report on.'}
    capture = reconstruction.get('capture') or {}
    fps = capture.get('sample_fps') or 1.0
    runs = stretches(rows, fps)
    registered = [r for r in rows if r['registered']]
    sharp = sorted(r['sharpness'] for r in registered if r['sharpness'] is not None)
    sharp_median = sharp[len(sharp) // 2] if sharp else None
    total = round(len(rows) / fps, 1) if fps else float(len(rows))
    reg_seconds = round(sum(r['seconds'] for r in runs if r['registered']), 1)
    longest = max((r for r in runs if r['registered']), key=lambda r: r['seconds'], default=None)
    dropped = []
    for run in runs:
        if run['registered'] or run['seconds'] < MIN_STRETCH_SECONDS:
            continue
        cause, reason = diagnose(run, rows, sharp_median)
        dropped.append({**run, 'cause': cause, 'reason': reason, 'advice': advice_for(cause)})
    share = (reg_seconds / total) if total else 0.0
    if share >= 0.9:
        verdict = f'{reg_seconds:.0f} of {total:.0f} seconds registered. The whole walk is in the model.'
    elif share >= 0.5:
        verdict = f'{reg_seconds:.0f} of {total:.0f} seconds registered. Most of the walk is in the model; the dropped parts are listed below.'
    else:
        verdict = (f'{reg_seconds:.0f} of {total:.0f} seconds registered. Most of the walk did not join the model; the scene comes from the '
                   f'{longest["seconds"]:.0f}-second stretch at {longest["start"]:.0f}–{longest["end"]:.0f} s.' if longest else
                   f'0 of {total:.0f} seconds registered.')
    general = []
    if share < 0.9:
        general.append('Hold the phone level at chest height, walk slowly, and finish where you started so the end overlaps the beginning.')
    if any(d['cause'] == 'motion-blur' for d in dropped):
        general.append('Turns are where frames blur: slow down into them.')
    return {'schema': SCHEMA, 'status': 'ok', 'sample_fps': fps, 'seconds_total': total, 'seconds_registered': reg_seconds,
            'registered_share': round(share, 3), 'frames_sampled': len(rows), 'frames_registered': len(registered),
            'longest_registered': longest, 'stretches': runs, 'dropped': dropped, 'verdict': verdict, 'advice': general,
            'sharpness': {'measured': bool(sharp), 'registered_median': sharp_median, 'blur_ratio': BLUR_RATIO},
            'timeline': [{'second': r['second'], 'registered': r['registered']} for r in rows],
            'scope': 'A report on the capture only. It changes no geometry, scale or review flag.'}


def write(out_dir, reconstruction, images_dir=None):
    report = build(reconstruction, images_dir)
    path = Path(out_dir) / 'capture-report.json'
    path.write_text(json.dumps(report, indent=2, allow_nan=False))
    return path, report


if __name__ == '__main__':
    import sys
    rec = json.loads(Path(sys.argv[1]).read_text())
    _, report = write(Path(sys.argv[1]).parent, rec, sys.argv[2] if len(sys.argv) > 2 else None)
    print(report['verdict'])
    for d in report.get('dropped', []):
        print(f"  {d['start']:.0f}–{d['end']:.0f} s ({d['seconds']:.0f} s): {d['reason']} → {d['advice']}")
