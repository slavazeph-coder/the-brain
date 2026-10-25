"""A still of a benchmark run: the true room's plan with the compiled walls, objects and cameras placed on it, and
the errors beneath. Drawn from truth.json and truth-score.json alone, so every line on it is a number in those files.

usage: python truth_card.py --truth truth.json --score truth-score.json [--measurements scene-measurements.json]
                            [--references references.json] --out card.png|chapter.mp4 [--size 1080x1350] [--seconds 6]
The card says it is a synthetic test room in its top line; keep it that way.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from score_against_truth import KIND, footprint, plan  # noqa: E402

AMBER, CYAN, WHITE, GREY, DIM, STEEL, MAGENTA = (255, 176, 32), (0, 229, 240), (238, 242, 248), (147, 161, 184), (98, 110, 132), (42, 58, 82), (255, 79, 154)
INTER = Path('/usr/share/fonts/opentype/inter')


def font(size, bold=False):
    path = INTER / ('Inter-SemiBold.otf' if bold else 'Inter-Regular.otf')
    if not path.is_file(): path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans' + ('-Bold' if bold else '') + '.ttf')
    return ImageFont.truetype(str(path), size) if path.is_file() else ImageFont.load_default(size)


def cm(metres, signed=True):
    return '—' if metres is None else (f'{metres * 100:+.1f} cm' if signed else f'{metres * 100:.1f} cm')


def dashed(draw, pts, colour, width=2, dash=10):
    for a, b in zip(pts, pts[1:] + pts[:1]):
        a, b = np.asarray(a, float), np.asarray(b, float); n = max(1, int(np.linalg.norm(b - a) / dash))
        for k in range(0, n, 2):
            draw.line([tuple(a + (b - a) * k / n), tuple(a + (b - a) * min(k + 1, n) / n)], fill=colour, width=width)


def layers(truth, score, measurements, size, references=None):
    """The card as transparent layers, in the order a viewer should see them: the heading and the true plan, the
    compiled model over it, then each row of numbers."""
    W, H = size; m = int(W * .083)
    blank = lambda: Image.new('RGBA', size, (0, 0, 0, 0))
    base, model = blank(), blank(); d, dm = ImageDraw.Draw(base, 'RGBA'), ImageDraw.Draw(model, 'RGBA')
    # Heading: what this is, before anything else.
    d.rounded_rectangle([m, 54, m + 330, 96], 8, fill=MAGENTA + (40,), outline=MAGENTA, width=2)
    d.text((m + 16, 62), 'SYNTHETIC TEST ROOM', font=font(22, True), fill=MAGENTA)
    d.text((m, 116), 'Model against exact truth', font=font(52, True), fill=WHITE)
    room = truth['room']
    # The spans the run used (references.json), which may differ from the ones the render wrote.
    spans = [{'role': r['role'], 'from': r['endpoints'][0], 'to': r['endpoints'][1], 'distanceMeters': r['trueMeters']}
             for r in references['spans']] if references else truth['spans']
    cal = next(s for s in spans if s['role'] == 'calibration')
    d.text((m, 184), f"Rendered meeting room, {room['width']:.1f} × {room['depth']:.1f} m by construction · "
                     f"scale from one {cal['distanceMeters']:.1f} m span", font=font(22), fill=GREY)
    # The plan, north up: x to the right, z down the page.
    box = (m, 240, W - m, int(H * .62)); T = room.get('wallThickness', .12)
    x0, x1, z0, z1 = -T - .3, room['width'] + T + .3, -T - .3, room['depth'] + T + .3
    s = min((box[2] - box[0]) / (x1 - x0), (box[3] - box[1]) / (z1 - z0))
    ox = box[0] + ((box[2] - box[0]) - s * (x1 - x0)) / 2 - s * x0; oz = box[1] + ((box[3] - box[1]) - s * (z1 - z0)) / 2 - s * z0
    px = lambda q: (ox + s * q[0], oz + s * q[1])
    for w in truth['walls']:
        d.polygon([px(q) for q in footprint(w['centre'], plan(w['yaw_degrees']), w['size'][0], w['size'][2])], fill=STEEL + (255,), outline=WHITE)
    for o in (o for o in truth['objects'] if o['label'] in KIND):  # the scored furniture, not the floor
        dashed(d, [px(q) for q in footprint(o['centre'], plan(o['yaw_degrees']), o['size'][0], o['size'][2])], GREY)
    for w in score['compiledWalls']:
        dm.polygon([px(q) for q in w['plan']], fill=AMBER + (150,), outline=AMBER)
    for o in score['objects']:
        dm.polygon([px(q) for q in o['plan']], outline=CYAN if o['true'] else MAGENTA, width=3)
    for q in score.get('cameras', []):
        u, v = px(q); dm.ellipse([u - 3, v - 3, u + 3, v + 3], fill=GREY + (200,))
    a, b = truth['landmarks'][cal['from']], truth['landmarks'][cal['to']]
    dm.line([px((a[0], a[2])), px((b[0], b[2]))], fill=MAGENTA, width=4)
    # Legend.
    y = box[3] + 18; f = font(20); x = m
    for colour, label, kind in ((WHITE, 'true walls and objects (exact)', 'line'), (AMBER, 'compiled walls', 'fill'),
                                (CYAN, 'compiled objects', 'box'), (GREY, 'cameras, as reconstructed', 'dot'), (MAGENTA, 'the one taped span', 'line')):
        if kind == 'fill': d.rectangle([x, y + 4, x + 22, y + 18], fill=colour)
        elif kind == 'box': d.rectangle([x, y + 4, x + 22, y + 18], outline=colour, width=3)
        elif kind == 'dot': d.ellipse([x + 7, y + 7, x + 15, y + 15], fill=colour)
        else: d.line([x, y + 11, x + 22, y + 11], fill=colour, width=4)
        d.text((x + 30, y), label, font=f, fill=GREY); x += 30 + d.textlength(label, font=f) + 26
        if x > W - m - 220: x, y = m, y + 30
    d.text((m, H - 64), 'A render, not a capture: real phones add lens, motion and lighting error this room does not.', font=font(19), fill=DIM)
    # The numbers.
    sm = score['summary']; r = score['room']; rows = [
        ('Room width', f"{r['width']['measuredMeters']:.3f} m" if r['width'].get('measuredMeters') is not None else 'not compiled', cm(sm['roomWidthErrorMeters'])),
        ('Room depth', f"{r['depth']['measuredMeters']:.3f} m" if r['depth'].get('measuredMeters') is not None else 'not compiled', cm(sm['roomDepthErrorMeters'])),
        ('Level', f"{sm['levelErrorDegrees']:.1f}° off true up", 'floor ' + cm(sm['floorHeightErrorMeters'])),
        # Stray: wall pieces off their wall's line, and pieces that match no wall at all (both are furniture taken for wall).
        ('Wall faces', f"{sm['wallsMatched']} found" + (lambda n: f" · {n} stray" if n else '')(sm.get('strayWallPieces', 0) + sm.get('unmatchedWallPieces', 0)),
         'median ' + cm(sm['wallFaceOffsetMedianMeters'], False)),
        ('Objects', f"{sm['objectsMatched']} found · {sm['spuriousObjects']} extra", 'median size ' + cm(sm['objectSizeErrorMedianMeters'], False))]
    if measurements and measurements.get('summary', {}).get('heldOutCount'):
        ms = measurements['summary']
        rows.append(('Withheld spans', f"{ms['heldOutWithinTolerance']} of {ms['heldOutCount']} within tolerance", 'worst ' + cm(ms['heldOutMaxAbsoluteErrorMeters'], False)))
    y = y + 50; label_f, value_f = font(26), font(26, True); out = [base, model]
    for label, value, error in rows:
        layer = blank(); dr = ImageDraw.Draw(layer, 'RGBA')
        dr.line([m, y - 12, W - m, y - 12], fill=STEEL, width=1)
        dr.text((m, y), label, font=label_f, fill=GREY); dr.text((m + 250, y), value, font=value_f, fill=WHITE)
        dr.text((W - m - dr.textlength(error, font=value_f), y), error, font=value_f, fill=AMBER); y += 48
        out.append(layer)
    return out


def compose(stack, alphas, size):
    img = Image.new('RGBA', size, (10, 16, 27, 255))
    for layer, a in zip(stack, alphas):
        if a >= 1: img.alpha_composite(layer)
        elif a > 0:
            faded = layer.copy(); faded.putalpha(layer.getchannel('A').point(lambda v: int(v * a))); img.alpha_composite(faded)
    return img.convert('RGB')


def card(truth, score, measurements, size, references=None):
    stack = layers(truth, score, measurements, size, references); return compose(stack, [1] * len(stack), size)


def clip(truth, score, measurements, size, out, seconds=6.0, fps=30, references=None):
    """The card as a chapter: the true plan, then the compiled model over it, then the rows one by one, then a hold.
    Written as H.264 with a silent stereo track, so feeds that expect audio accept it."""
    stack = layers(truth, score, measurements, size, references); n = int(round(seconds * fps))
    ease = lambda u: 0 if u <= 0 else 1 if u >= 1 else 1 - (1 - u) ** 3
    proc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{size[0]}x{size[1]}',
                             '-r', str(fps), '-i', '-', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
                             '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-c:a', 'aac', '-b:a', '128k', str(out)],
                            stdin=subprocess.PIPE)
    for f in range(n):
        t = f / fps
        alphas = [ease(t / .5), ease((t - .7) / .7)] + [ease((t - 1.9 - .45 * k) / .35) for k in range(len(stack) - 2)]
        proc.stdin.write(compose(stack, alphas, size).tobytes())
    proc.stdin.close()
    if proc.wait(): raise RuntimeError('ffmpeg failed writing the clip')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--truth', type=Path, required=True); ap.add_argument('--score', type=Path, required=True)
    ap.add_argument('--measurements', type=Path); ap.add_argument('--out', type=Path, required=True); ap.add_argument('--size', default='1080x1350')
    ap.add_argument('--seconds', type=float, help='write an animated chapter of this length (.mp4) instead of a still')
    ap.add_argument('--references', type=Path, help="the run's references.json, for the spans it actually used")
    a = ap.parse_args(); size = tuple(int(v) for v in a.size.lower().split('x'))
    measurements = json.loads(a.measurements.read_text()) if a.measurements else None
    truth, score = json.loads(a.truth.read_text()), json.loads(a.score.read_text())
    references = json.loads(a.references.read_text()) if a.references else None
    if a.seconds: clip(truth, score, measurements, size, a.out, a.seconds, references=references)
    else: card(truth, score, measurements, size, references).save(a.out)
    print(a.out)


if __name__ == '__main__':
    main()
