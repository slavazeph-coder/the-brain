"""The feed film of a benchmark run with its truth chapter: compose_film.py's cut up to its end card, then
truth_card.py's chapter (the model against the exact room), then the end card. Also writes captions and a thumbnail.

usage: python film_with_truth.py FILM.mp4 CHAPTER.mp4 OUT.mp4 --cut check [--dimensions] [--captions OUT.srt]
                                 [--thumbnail OUT.png]
CHAPTER.mp4 is truth_card.py's chapter made with --reserve 170, so the film's evidence strip, copied onto it, covers
nothing.
FILM.mp4 is compose_film.py's output for --cut; --dimensions says the run had a measurement report, so the cut has its
dimensions chapter. The film's chapter lengths are restated here and checked against its duration, so a change in
compose_film.py stops this script instead of cutting a chapter in half.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

# compose_film.py's chapter lengths (seconds) and order; the duration check below keeps them honest.
LENGTHS = {'hook': 3.0, 'walk': 2.4, 'points': 2.8, 'model': 3.6, 'check': 4.8, 'dimensions': 6.0, 'plan': 4.4, 'files': 3.6,
           'takeoff': 3.2, 'route': 3.8, 'uses': 3.0, 'end': 3.6}
CAPTIONS = {
    'hook': 'A synthetic test: a meeting room rendered with exact dimensions.',
    'walk': 'In: a walkthrough of rendered frames, like a phone video.',
    'points': 'Camera poses and 3D points, recovered from the frames alone.',
    'model': 'Out: walls, floor and furniture as a model.',
    'check': 'Every point checked against the model it built.',
    'dimensions': 'Spans the scale never saw, checked on the points.',
    'plan': 'A dimensioned floor plan from the same model.',
    'files': 'IFC, USD, GLB, DXF, Rhino and CSV from one run.',
    'takeoff': 'A quantity takeoff from the same model.',
    'route': 'A robot route planned in the same model.',
    'uses': 'Floor plans, estimates, BIM drafts and robot routes from one model.',
    'truth': 'Then the whole model, scored against the room it came from.',
    'end': 'BrainSNN World Builder. Synthetic test room; scale from one taped span.'}
XFADE = 0.3
STRIP_Y = 1180  # compose_film.py's evidence strip (capture credit and scale status) runs from here to the bottom


def order(cut, dimensions):
    return (['hook', 'walk', 'points', 'model'] + (['check'] if cut == 'check' else []) + (['dimensions'] if dimensions else [])
            + ['plan', 'files', 'takeoff'] + (['route'] if cut == 'master' else []) + ['uses', 'end'])


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)], check=True, capture_output=True)
    return float(json.loads(out.stdout)['format']['duration'])


def stamp(t):
    ms = int(round(t * 1000)); return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('film', type=Path); ap.add_argument('chapter', type=Path); ap.add_argument('out', type=Path)
    ap.add_argument('--cut', choices=('master', 'commercial', 'check'), required=True); ap.add_argument('--dimensions', action='store_true')
    ap.add_argument('--captions', type=Path); ap.add_argument('--thumbnail', type=Path)
    a = ap.parse_args()
    chapters = order(a.cut, a.dimensions); film, chapter = duration(a.film), duration(a.chapter)
    expected = sum(LENGTHS[c] for c in chapters)
    if abs(film - expected) > 0.1:
        raise SystemExit(f'{a.film} is {film:.2f} s; the {a.cut} cut should be {expected:.2f} s. compose_film.py changed: update LENGTHS here.')
    end = film - LENGTHS['end']
    # The film's evidence strip is drawn alike on every frame; the chapter carries the same strip, taken from the film.
    strip = a.out.with_suffix('.strip.png')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{end - 1:.2f}', '-i', str(a.film), '-frames:v', '1',
                    '-vf', f'crop=iw:ih-{STRIP_Y}:0:{STRIP_Y}', str(strip)], check=True)
    graph = (f'[0:v]trim=0:{end},setpts=PTS-STARTPTS[a];[0:v]trim={end},setpts=PTS-STARTPTS[c];'
             f'[1:v]setpts=PTS-STARTPTS[t];[t][3:v]overlay=0:{STRIP_Y}[b];'
             f'[a][b]xfade=transition=fade:duration={XFADE}:offset={end - XFADE}[ab];'
             f'[ab][c]xfade=transition=fade:duration={XFADE}:offset={end + chapter - 2 * XFADE}[v]')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(a.film), '-i', str(a.chapter),
                    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-i', str(strip), '-filter_complex', graph,
                    '-map', '[v]', '-map', '2:a', '-shortest', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
                    '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(a.out)], check=True)
    total = duration(a.out); strip.unlink()
    if a.captions:  # chapter by chapter, shifted by the two crossfades either side of the truth chapter
        rows, t = [], 0.0
        for c in chapters[:-1]: rows.append((c, t, t + LENGTHS[c])); t += LENGTHS[c]
        t -= XFADE; rows.append(('truth', t, t + chapter - XFADE)); t += chapter - XFADE; rows.append(('end', t, total))
        a.captions.write_text(''.join(f'{k}\n{stamp(s)} --> {stamp(e - .05)}\n{CAPTIONS[c]}\n\n' for k, (c, s, e) in enumerate(rows, 1)))
    if a.thumbnail:  # the truth chapter's held frame: the plan, the model on it and every number
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', str(a.chapter), '-frames:v', '1', str(a.thumbnail)], check=True)
    print(json.dumps({'out': str(a.out), 'seconds': round(total, 2), 'truthChapterStarts': round(end - XFADE, 2)}))


if __name__ == '__main__':
    main()
