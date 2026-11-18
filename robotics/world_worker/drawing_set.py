"""Drawing set of a compiled metric scene: one PDF with a plan, four interior elevations, two sections and schedules.

Every sheet is drawn from scene.json through cad_export.elements, the geometry behind scene.ifc, scene-plan.dxf and
quantities.csv, so a length on a sheet is the length in those files. Nothing is traced and nothing is added: a wall the
compiler did not find is not on the plan, and an object is the box the compiler placed, not its real outline.

The PDF is vector, A3 landscape, drawn at a standard scale (1:50, 1:100 and so on), so it measures true when printed at
100%. It is written directly as PDF 1.4 with the standard Helvetica and Courier fonts, with no PDF library, so it runs
wherever the worker does. The same scene always gives the same bytes: no clock, no random identifier.

What the set does not claim. Dimensions follow the scene's scale, which is self-reported or estimated and never
verified here; every sheet carries that note. Elevations and sections show boxes, with heights from the floor estimate.
There is no north point (the scan has no compass), no room boundary, no material and no level datum. Plant items such as
pipes, valves and steel members are not modelled; the object register lists what the compiler separated.
"""
from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import math
import os
from pathlib import Path
import tempfile
import zlib

try:
    from . import cad_export
    from .geometry import _finite
except ImportError:  # Direct worker/script execution.
    import cad_export
    from geometry import _finite

from component_graph import ensure_component_ids, scene_sha256, MAX_SCENE_BYTES

SCHEMA = 'brainsnn.drawing-set.v1'
PDF_NAME = 'drawing-set.pdf'
PREVIEW_NAME = 'drawing-preview.json'
MAX_PREVIEW_BYTES = 4 * 1024 * 1024
MAX_PREVIEW_OPS = 30_000
MAX_PREVIEW_SHEETS = 256
SHEET_W, SHEET_H = 420.0, 297.0   # A3 landscape, millimetres
MARGIN, TITLE_H = 10.0, 24.0
AREA = (MARGIN + 6, MARGIN + 6, SHEET_W - MARGIN - 6, SHEET_H - MARGIN - TITLE_H - 6)  # where a drawing may sit
SCALES = (10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000)
MAX_ELEMENTS = 20_000             # a refusal, not a target: far beyond any scene the compiler writes
ROWS_PER_SHEET = 34
HATCH_LINES = 20_000              # per sheet; past it an area keeps its tint and loses its hatch
ORDER_CHECKS = 200_000            # pairs of shapes a view compares to order them; past it, nearest point first
INDEX_ROWS, INDEX_MORE = 27, 108  # sheet-index rows in a cover column, and entries on a continuation sheet
INK, GREY, LIGHT, PALE = (.11, .15, .21), (.42, .47, .54), (.74, .78, .83), (.93, .94, .96)
BLUE, PINK, PINK_LINE, RED, WHITE = (0, .44, .70), (.97, .86, .91), (.70, .41, .54), (.72, .22, .12), (1, 1, 1)
PT = 72 / 25.4
FONTS = {'H': 'Helvetica', 'HB': 'Helvetica-Bold', 'C': 'Courier', 'CB': 'Courier-Bold'}
# Helvetica advance widths for ASCII 32 to 126, in thousandths of the font size (Adobe core font metrics).
_HELVETICA = (278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
              556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
              500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
              556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
              278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584)


def clean(value, limit=200):
    """Text a standard PDF font can show: Windows-1252, no control characters, bounded length."""
    text = ''.join(c if c.isprintable() else ' ' for c in str(value))[:limit]
    return text.encode('cp1252', 'replace').decode('cp1252')


def text_width(text, size, font='H'):
    """Width in millimetres. Exact for Courier; for Helvetica bold it is the regular width plus 6%."""
    if font in ('C', 'CB'):
        return len(text) * .6 * size
    units = sum(_HELVETICA[ord(c) - 32] if 32 <= ord(c) <= 126 else 556 for c in text)
    return units / 1000 * size * (1.06 if font == 'HB' else 1)


def fit_text(text, size, font, width):
    """The text, shortened with an ellipsis if it would overrun the width."""
    text = clean(text)
    if text_width(text, size, font) <= width:
        return text
    while text and text_width(text + '...', size, font) > width:
        text = text[:-1]
    return text + '...'


def wrap(text, size, font, width):
    """The text broken at spaces into lines no wider than the width."""
    lines, current = [], ''
    for word in clean(text, 600).split():
        trial = (current + ' ' + word).strip()
        if current and text_width(trial, size, font) > width:
            lines.append(current); current = word
        else:
            current = trial
    return lines + ([current] if current else [])


class Sheet:
    """One page as a list of drawing operations in millimetres, origin top left, y down."""

    def __init__(self, number, title, scale=None):
        self.number, self.title, self.scale, self.ops = number, title, scale, []

    def line(self, x0, y0, x1, y1, *, width=.18, colour=INK, dash=None):
        self.ops.append(('line', (x0, y0, x1, y1), width, colour, dash))

    def poly(self, points, *, fill=None, stroke=INK, width=.18, dash=None):
        self.ops.append(('poly', tuple((float(x), float(y)) for x, y in points), width, stroke, fill, dash))

    def rect(self, x, y, w, h, **style):
        self.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], **style)

    def text(self, x, y, text, *, size=2.6, font='H', anchor='l', colour=INK, angle=0):
        text = clean(text)
        if text:
            self.ops.append(('text', (x, y), text, size, font, anchor, colour, angle))

    def texts(self):
        return [op[2] for op in self.ops if op[0] == 'text']


def _pdf_string(text):
    raw = text.encode('cp1252', 'replace')
    return b'(' + raw.replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)') + b')'


def _info_string(text):
    """A document-information string. The page fonts are Windows-1252; metadata is not, so anything past ASCII is
    written as UTF-16 with a byte-order mark."""
    if all(32 <= ord(c) < 127 for c in text):
        return _pdf_string(text)
    return b'<' + ('\ufeff' + text).encode('utf-16-be').hex().upper().encode('ascii') + b'>'


def _content(sheet):
    """The page's PDF content stream. PDF y runs up, so every y is mirrored."""
    out = []
    X, Y = (lambda v: v * PT), (lambda v: (SHEET_H - v) * PT)
    def colour(c, op):
        return '%.3f %.3f %.3f %s' % (*c, op)
    def dashed(dash):
        return '[%s] 0 d' % ' '.join('%.2f' % (v * PT) for v in dash) if dash else '[] 0 d'
    for op in sheet.ops:
        if op[0] == 'line':
            _, (x0, y0, x1, y1), width, stroke, dash = op
            out.append('%s %.2f w %s %.2f %.2f m %.2f %.2f l S' % (colour(stroke, 'RG'), width * PT, dashed(dash), X(x0), Y(y0), X(x1), Y(y1)))
        elif op[0] == 'poly':
            _, points, width, stroke, fill, dash = op
            path = ' '.join('%.2f %.2f %s' % (X(x), Y(y), 'm' if n == 0 else 'l') for n, (x, y) in enumerate(points)) + ' h'
            paint = 'B' if fill and stroke else 'f' if fill else 'S'
            out.append(' '.join(filter(None, [colour(fill, 'rg') if fill else '', colour(stroke, 'RG') if stroke else '',
                                               '%.2f w' % (width * PT), dashed(dash), path, paint])))
        else:
            _, (x, y), text, size, font, anchor, fill, angle = op
            shift = {'l': 0, 'c': .5, 'r': 1}[anchor] * text_width(text, size, font)
            a = math.radians(angle); c, s = math.cos(a), math.sin(a)
            # The anchor shift runs along the text's own baseline, which on paper (y down) is (cos, -sin).
            px, py = x - shift * c, y + shift * s
            out.append('BT %s /%s %.2f Tf %.4f %.4f %.4f %.4f %.2f %.2f Tm ' % (colour(fill, 'rg'), font, size * PT, c, s, -s, c, X(px), Y(py))
                       + _pdf_string(text).decode('latin-1') + ' Tj ET')
    return '\n'.join(out).encode('latin-1')


def write_pdf(sheets, title):
    """PDF 1.4 bytes for the sheets. Deterministic: no dates and no document identifier."""
    objects = [b'', b'']  # 1: catalog, 2: page tree; filled in once the pages are known
    def add(body):
        objects.append(body)
        return len(objects)
    fonts = {key: add(('<< /Type /Font /Subtype /Type1 /BaseFont /%s /Encoding /WinAnsiEncoding >>' % name).encode()) for key, name in FONTS.items()}
    resources = '<< /Font << %s >> >>' % ' '.join('/%s %d 0 R' % item for item in fonts.items())
    kids = []
    for sheet in sheets:
        stream = zlib.compress(_content(sheet), 9)
        content = add(b'<< /Length %d /Filter /FlateDecode >>\nstream\n' % len(stream) + stream + b'\nendstream')
        kids.append(add(('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources %s /Contents %d 0 R >>'
                         % (SHEET_W * PT, SHEET_H * PT, resources, content)).encode()))
    objects[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[1] = ('<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join('%d 0 R' % k for k in kids), len(kids))).encode()
    info = add(b'<< /Title ' + _info_string(clean(title)) + b' /Producer (BrainSNN World Builder drawing_set) >>')
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % number + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offsets)
    out += b'trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, info, xref)
    return bytes(out)


def to_svg(sheet):
    """The sheet as SVG in millimetres: a preview and a second, independently readable form of the same operations."""
    def rgb(c):
        return 'rgb(%d,%d,%d)' % tuple(round(v * 255) for v in c)
    def esc(text):
        return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%gmm" height="%gmm">' % (SHEET_W, SHEET_H, SHEET_W, SHEET_H),
             '<rect width="100%" height="100%" fill="white"/>']
    for op in sheet.ops:
        if op[0] == 'line':
            _, (x0, y0, x1, y1), width, stroke, dash = op
            parts.append('<line x1="%.3f" y1="%.3f" x2="%.3f" y2="%.3f" stroke="%s" stroke-width="%.3f"%s/>'
                         % (x0, y0, x1, y1, rgb(stroke), width, ' stroke-dasharray="%s"' % ' '.join('%g' % v for v in dash) if dash else ''))
        elif op[0] == 'poly':
            _, points, width, stroke, fill, dash = op
            parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="%.3f"%s/>'
                         % (' '.join('%.3f,%.3f' % p for p in points), rgb(fill) if fill else 'none', rgb(stroke) if stroke else 'none', width,
                            ' stroke-dasharray="%s"' % ' '.join('%g' % v for v in dash) if dash else ''))
        else:
            _, (x, y), text, size, font, anchor, fill, angle = op
            family = ('Courier, monospace' if font in ('C', 'CB') else 'Helvetica, Arial, sans-serif')
            parts.append('<text x="%.3f" y="%.3f" font-family="%s" font-size="%.3f"%s text-anchor="%s" fill="%s"%s>%s</text>'
                         % (x, y, family, size, ' font-weight="bold"' if font in ('HB', 'CB') else '', {'l': 'start', 'c': 'middle', 'r': 'end'}[anchor],
                            rgb(fill), ' transform="rotate(%g %.3f %.3f)"' % (-angle, x, y) if angle else '', esc(text)))
    return '\n'.join(parts + ['</svg>'])


# ---------------------------------------------------------------- the model, read once

def scale_sentence(scene):
    """How the scene got its scale, in words for a title block. It never says the scale was checked: nothing here checks it."""
    scale = scene.get('scale') if isinstance(scene.get('scale'), dict) else {}
    source, distance = scale.get('source'), scale.get('distance')
    if source == 'user-measured':
        basis = f'Scale set from one entered distance of {distance:g} m' if _finite(distance) else 'Scale set from one entered distance'
    elif source == 'model-metric-estimate':
        basis = 'Scale estimated by the reconstruction model'
    elif source == 'scan-file':
        basis = 'Scale taken from the scan file as declared'
    else:
        basis = f'Scale source: {clean(source, 40)}' if isinstance(source, str) and source.strip() else 'Scale source not recorded'
    return basis + '. Not verified.'


def _metric_reason(scene):
    if scene.get('units') != 'm':
        return 'A drawing set needs a metric scene: drawings are to scale. Set a measured scale in World Builder first.'
    return None


def square_angle(walls):
    """The turn, in radians, that squares the walls to the sheet: their length-weighted direction, modulo a right angle."""
    c = s = 0.0
    for wall in walls:
        (ax, ay), (bx, by) = wall['corners'][0], wall['corners'][1]
        a = math.atan2(by - ay, bx - ax)
        c += wall['length'] * math.cos(4 * a); s += wall['length'] * math.sin(4 * a)
    turn = math.atan2(s, c) / 4 if math.hypot(c, s) > 1e-9 else 0.0
    return turn if abs(turn) >= math.radians(.5) else 0.0


def _model(scene):
    """Elements with their sheet tags, in the order the other exports use (W1 is the building schedule's W1).

    Plan points are turned so the walls run square to the sheet. A turn keeps every length; the schedules still give
    positions in the scan frame, the frame of scene-plan.dxf."""
    if not _finite(scene.get('floor_y')):
        raise ValueError('The scene needs a finite floor elevation.')
    items = cad_export.elements(scene)
    if len(items) > MAX_ELEMENTS:
        raise ValueError('The scene has too many elements to draw.')
    for item in items:
        values = [v for p in item['corners'] for v in p] + [item[k] for k in ('length', 'width', 'height', 'base')]
        if not all(_finite(v) and abs(v) <= 10_000_000 for v in values):
            raise ValueError('Drawing coordinates must be finite and bounded.')
        if item['kind'] != 'floor' and any(item[k] <= 0 for k in ('length', 'width', 'height')):
            raise ValueError('Drawing dimensions must be positive.')
    walls = [i for i in items if i['kind'] == 'wall']; objects = [i for i in items if i['kind'] == 'object']
    for n, wall in enumerate(walls, 1):
        wall['tag'] = f'W{n}'
    for n, item in enumerate(objects, 1):
        item['tag'] = f'O{n}'
    if not walls and not objects:
        raise ValueError('There is no placed geometry to draw.')
    by_name = {w['name']: w for w in walls}; source = {w['name']: w for w in scene.get('walls', [])}
    openings = []
    for n, o in enumerate(scene.get('openings', []), 1):
        wall = source[o['hostWall']]; angle = math.radians(wall.get('yaw_degrees', 0)); start = o['offsetMeters'] - wall['size'][0] / 2
        ends = [(wall['centre'][0] + along * math.cos(angle), -(wall['centre'][2] + along * math.sin(angle))) for along in (start, start + o['widthMeters'])]
        openings.append({'tag': f'P{n}', 'id': o['id'], 'kind': o['kind'], 'host': by_name[o['hostWall']]['tag'], 'ends': ends,
                         'width': o['widthMeters'], 'height': o['heightMeters'], 'sill': o['sillMeters'], 'offset': o['offsetMeters'],
                         'provenance': o.get('provenance', 'operator-reviewed-reference')})
    floor = next((i for i in items if i['kind'] == 'floor'), None)
    floor_y = scene['floor_y']
    totals = cad_export.quantities(scene, items)[1]   # before the turn: quantities.csv is counted in the scan frame
    turn = square_angle(walls); cos, sin = math.cos(turn), math.sin(turn)
    def turned(points):
        return [(x * cos + y * sin, -x * sin + y * cos) for x, y in points]
    for item in items:
        item['scan_centre'] = (sum(p[0] for p in item['corners']) / 4, sum(p[1] for p in item['corners']) / 4)
        item['corners'] = turned(item['corners'])
        if item['kind'] == 'wall':
            item['plan_parts'] = [turned(part) for part in item['plan_parts']]
            item['solid_parts'] = [{**part, 'corners': turned(part['corners'])} for part in item['solid_parts']]
    for opening in openings:
        opening['ends'] = turned(opening['ends'])
    boxes = []  # everything with a height, heights measured up from the floor estimate
    for item in items:
        if item['kind'] == 'wall':
            boxes += [{'kind': 'wall', 'tag': item['tag'], 'corners': part['corners'], 'z0': part['base'] - floor_y, 'z1': part['base'] + part['height'] - floor_y}
                      for part in item['solid_parts']]
        elif item['kind'] in ('object', 'door'):
            boxes.append({'kind': item['kind'], 'tag': item.get('tag', ''), 'corners': item['corners'], 'z0': item['base'] - floor_y, 'z1': item['base'] + item['height'] - floor_y})
    points = [p for i in items if i['kind'] != 'unknown' for p in i['corners']]
    bounds = (min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points))
    if bounds[2] - bounds[0] < .001 or bounds[3] - bounds[1] < .001:
        raise ValueError('The plan footprint is degenerate.')
    solid = [p for i in (walls or objects) for p in i['corners']]   # what the overall dimensions measure
    measured = (min(p[0] for p in solid), min(p[1] for p in solid), max(p[0] for p in solid), max(p[1] for p in solid))
    return {'totals': totals, 'items': items, 'walls': walls, 'objects': objects, 'openings': openings, 'floor': floor, 'boxes': boxes, 'bounds': bounds,
            'measured': measured, 'measured_what': 'walls' if walls else 'objects', 'turn_degrees': math.degrees(turn), 'unknown': [i for i in items if i['kind'] == 'unknown'], 'doors': [i for i in items if i['kind'] == 'door']}


def pick_scale(width_m, height_m, width_mm, height_mm):
    """The first standard scale at which the extent fits the space."""
    need = max(width_m * 1000 / width_mm, height_m * 1000 / height_mm)
    for n in SCALES:
        if n >= need:
            return n
    return int(math.ceil(need / 1000) * 1000)


# ---------------------------------------------------------------- sheet furniture

def _frame(sheet, meta, index, total):
    """Border, title block and the review note every sheet carries."""
    x0, y0, x1, y1 = MARGIN, MARGIN, SHEET_W - MARGIN, SHEET_H - MARGIN; ty = y1 - TITLE_H
    sheet.rect(x0, y0, x1 - x0, y1 - y0, width=.5)
    sheet.line(x0, ty, x1, ty, width=.5)
    cols = [x0, x0 + 78, x0 + 196, x0 + 290, x1 - 46, x1]
    for x in cols[1:-1]:
        sheet.line(x, ty, x, y1, width=.25)
    def cell(n, label, value, *, size=3.6, font='HB', row=0):
        y = ty + 5 + row * 11
        sheet.text(cols[n] + 3, y, label, size=1.9, colour=GREY)
        sheet.text(cols[n] + 3, y + 5.2, fit_text(value, size, font, cols[n + 1] - cols[n] - 6), size=size, font=font)
    sheet.text(cols[0] + 3, ty + 8.5, 'BrainSNN World Builder', size=4.4, font='HB')
    sheet.text(cols[0] + 3, ty + 13.6, 'Drawing set from the compiled model', size=2.5, colour=GREY)
    sheet.text(cols[0] + 3, ty + 19.6, 'FOR REVIEW - DIMENSIONS UNVERIFIED', size=2.7, font='HB', colour=RED)
    cell(1, 'PROJECT', meta['name']); cell(1, 'SOURCE', f"cloud {meta['source'][:12]}  revision {meta['revision']}", size=2.7, font='C', row=1)
    cell(2, 'SHEET TITLE', sheet.title); cell(2, 'SCALE BASIS', meta['scale_note'], size=2.3, font='H', row=1)
    cell(3, 'SCALE', f'1:{sheet.scale} at A3' if sheet.scale else 'Not to scale'); cell(3, 'UNITS', 'metres', size=2.9, font='H', row=1)
    sheet.text(cols[4] + 23, ty + 12.5, sheet.number, size=7.5, font='HB', anchor='c')
    sheet.text(cols[4] + 23, ty + 19.6, f'sheet {index} of {total}', size=2.5, anchor='c', colour=GREY)


def _dimension(sheet, a, b, offset, label, *, vertical=False):
    """A dimension string between two paper points, drawn `offset` millimetres away from them."""
    if vertical:
        x = a[0] + offset
        sheet.line(a[0], a[1], x + math.copysign(1.5, offset), a[1], width=.1, colour=GREY); sheet.line(b[0], b[1], x + math.copysign(1.5, offset), b[1], width=.1, colour=GREY)
        sheet.line(x, a[1], x, b[1], width=.13)
        for y in (a[1], b[1]):
            sheet.line(x - 1, y + 1, x + 1, y - 1, width=.3)
        sheet.text(x - 1.2 if offset < 0 else x + 3.2, (a[1] + b[1]) / 2, label, size=2.6, font='C', anchor='c', angle=90)
    else:
        y = a[1] + offset
        sheet.line(a[0], a[1], a[0], y + math.copysign(1.5, offset), width=.1, colour=GREY); sheet.line(b[0], b[1], b[0], y + math.copysign(1.5, offset), width=.1, colour=GREY)
        sheet.line(a[0], y, b[0], y, width=.13)
        for x in (a[0], b[0]):
            sheet.line(x - 1, y + 1, x + 1, y - 1, width=.3)
        sheet.text((a[0] + b[0]) / 2, y - 1.2 if offset < 0 else y + 3.2, label, size=2.6, font='C', anchor='c')


def _scale_bar(sheet, x, y, scale):
    """A bar of round metres, so a print at the wrong size still shows its own scale."""
    metres = next((m for m in (.5, 1, 2, 5, 10, 20, 50, 100, 200, 500) if m * 1000 / scale >= 28), 1000)
    unit = metres * 1000 / scale / 4
    for n in range(4):
        sheet.rect(x + n * unit, y, unit, 1.6, fill=INK if n % 2 == 0 else WHITE, width=.13)
    for n in (0, 2, 4):
        sheet.text(x + n * unit, y + 5, f'{metres * n / 4:g}', size=2.3, font='C', anchor='c')
    sheet.text(x + 4 * unit + 3, y + 5, 'm', size=2.3, font='C')


def _clip_rect(points, box):
    """A convex polygon clipped to a paper rectangle; empty when nothing of it is inside."""
    for axis, bound, below in ((0, box[0], False), (0, box[2], True), (1, box[1], False), (1, box[3], True)):
        out = []
        for n, p in enumerate(points):
            q = points[(n + 1) % len(points)]
            p_in = p[axis] <= bound if below else p[axis] >= bound; q_in = q[axis] <= bound if below else q[axis] >= bound
            if p_in:
                out.append(p)
            if p_in != q_in:
                t = (bound - p[axis]) / (q[axis] - p[axis]); out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
        points = out
        if len(points) < 3:
            return []
    return points


def _hatch(sheet, points, spacing, *, colour, width=.08, budget=HATCH_LINES):
    """Hatch lines at 45 degrees, clipped to a convex polygon and anchored to the sheet so neighbours line up.

    Returns the number of lines drawn, or None, drawing nothing, when the polygon needs more than the budget."""
    keys = [x + y for x, y in points]
    if (max(keys) - min(keys)) / spacing > budget:
        return None
    c = (math.floor(min(keys) / spacing) + 1) * spacing; drawn = 0
    while c < max(keys):
        hits = []
        for n, (x0, y0) in enumerate(points):
            x1, y1 = points[(n + 1) % len(points)]; k0, k1 = x0 + y0 - c, x1 + y1 - c
            if (k0 < 0) != (k1 < 0):
                t = k0 / (k0 - k1); hits.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
        if len(hits) >= 2:
            sheet.line(*hits[0], *hits[1], width=width, colour=colour); drawn += 1
        c += spacing
    return drawn


class _Labels:
    """Greedy label placement: a label that would cover another label or leave the drawing is not drawn."""

    def __init__(self, sheet, area):
        self.sheet, self.area, self.taken, self.omitted = sheet, area, [], 0

    def free(self, box):
        x0, y0, x1, y1 = box
        if x0 < self.area[0] or y0 < self.area[1] or x1 > self.area[2] or y1 > self.area[3]:
            return False
        return not any(x0 < b[2] and b[0] < x1 and y0 < b[3] and b[1] < y1 for b in self.taken)

    def block(self, box):
        self.taken.append(box)

    def place(self, candidates, text, *, size=2.4, font='CB', colour=INK, plate=True, leader=None):
        """Draw the text at the first free candidate. With a leader point, a hairline ties a tag that sits away from
        its element back to it."""
        w, h = text_width(text, size, font), size * .74
        for cx, cy in candidates:
            box = (cx - w / 2 - .7, cy - h / 2 - .7, cx + w / 2 + .7, cy + h / 2 + .7)
            if self.free(box):
                if leader and not (box[0] <= leader[0] <= box[2] and box[1] <= leader[1] <= box[3]):
                    edge = (min(max(leader[0], box[0]), box[2]), min(max(leader[1], box[1]), box[3]))
                    if math.dist(edge, leader) > 1.2:
                        self.sheet.line(*edge, *leader, width=.08, colour=GREY)
                if plate:
                    self.sheet.rect(box[0], box[1], box[2] - box[0], box[3] - box[1], fill=WHITE, stroke=None)
                self.sheet.text(cx, cy + h / 2, text, size=size, font=font, anchor='c', colour=colour)
                self.taken.append(box)
                return True
        self.omitted += 1
        return False


# ---------------------------------------------------------------- plan

def _plan(model, meta, cuts):
    x0, y0, x1, y1 = model['bounds']
    left, top, right, bottom = AREA[0] + 22, AREA[1] + 12, AREA[2] - 62, AREA[3] - 22
    scale = pick_scale(x1 - x0, y1 - y0, right - left, bottom - top); k = 1000 / scale
    ox = left + ((right - left) - (x1 - x0) * k) / 2; oy = top + ((bottom - top) - (y1 - y0) * k) / 2
    P = lambda p: (ox + (p[0] - x0) * k, oy + (y1 - p[1]) * k)   # plan Y up is paper y up
    sheet = Sheet('A-101', 'Floor plan', scale)
    window = (AREA[0], AREA[1], AREA[2] - 60, AREA[3]); budget = HATCH_LINES; plain = 0
    for cell in model['unknown']:   # where no reconstructed point reached: hatched, never drawn as free floor
        pts = _clip_rect([P(p) for p in cell['corners']], window)   # the cells do not set the scale, so one can leave the sheet
        if not pts:
            continue
        sheet.poly(pts, fill=PINK, stroke=None)
        drawn = _hatch(sheet, pts, 1.6, colour=PINK_LINE, budget=budget)
        if drawn is None:
            plain += 1
        else:
            budget -= drawn
    if model['floor']:
        pts = [P(p) for p in model['floor']['corners']]
        sheet.poly(pts, stroke=GREY, width=.13, dash=(1.6, 1.2))
    for item in model['objects']:
        sheet.poly([P(p) for p in item['corners']], fill=PALE, stroke=GREY, width=.18)
    for wall in model['walls']:
        for part in wall['plan_parts']:
            sheet.poly([P(p) for p in part], fill=INK, stroke=INK, width=.1)
    for door in model['doors']:
        sheet.poly([P(p) for p in door['corners']], fill=WHITE, stroke=BLUE, width=.25)
    for opening in model['openings']:
        a, b = (P(p) for p in opening['ends'])
        sheet.line(*a, *b, width=.5, colour=BLUE, dash=(1.2, .8))
    labels = _Labels(sheet, window)
    # Section lines and the elevation key first, so tags give way to them.
    (ay, bx) = cuts
    a0, a1 = P((x0, ay)), P((x1, ay)); b0, b1 = P((bx, y0)), P((bx, y1))
    sheet.line(a0[0] - 8, a0[1], a1[0] + 8, a1[1], width=.35, colour=BLUE, dash=(6, 1.2, 1, 1.2))
    sheet.line(b0[0], b0[1] + 8, b1[0], b1[1] - 8, width=.35, colour=BLUE, dash=(6, 1.2, 1, 1.2))
    for x in (a0[0] - 8, a1[0] + 8):     # A-A looks toward the top of the plan
        sheet.poly([(x - 1.6, a0[1]), (x + 1.6, a0[1]), (x, a0[1] - 3.4)], fill=BLUE, stroke=None)
        sheet.text(x, a0[1] + 4.6, 'A', size=3.6, font='HB', anchor='c', colour=BLUE)
        labels.block((x - 3, a0[1] - 4, x + 3, a0[1] + 6))
    labels.block((a0[0] - 8, a0[1] - .6, a1[0] + 8, a0[1] + .6)); labels.block((b0[0] - .6, b1[1] - 8, b0[0] + .6, b0[1] + 8))
    for wall in model['walls']:   # tags stay off every wall, not only their own
        for part in wall['plan_parts']:
            pts = [P(p) for p in part]; a, b = ((pts[0][0] + pts[3][0]) / 2, (pts[0][1] + pts[3][1]) / 2), ((pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2)
            half = max(.5, math.dist(pts[0], pts[3]) / 2); steps = max(1, int(math.dist(a, b) / 1.5))
            for n in range(steps + 1):
                px, py = a[0] + (b[0] - a[0]) * n / steps, a[1] + (b[1] - a[1]) * n / steps
                labels.block((px - half, py - half, px + half, py + half))
    for y in (b0[1] + 8, b1[1] - 8):     # B-B looks toward the right of the plan
        sheet.poly([(b0[0], y - 1.6), (b0[0], y + 1.6), (b0[0] + 3.4, y)], fill=BLUE, stroke=None)
        sheet.text(b0[0] - 4.2, y + 1.3, 'B', size=3.6, font='HB', anchor='c', colour=BLUE)
        labels.block((b0[0] - 7, y - 3, b0[0] + 4, y + 3))
    for item in model['objects']:
        pts = [P(p) for p in item['corners']]; cx, cy = sum(p[0] for p in pts) / 4, sum(p[1] for p in pts) / 4
        bw, bh = max(p[0] for p in pts) - min(p[0] for p in pts), max(p[1] for p in pts) - min(p[1] for p in pts)
        rx, ry = bw / 2 + text_width(item['tag'], 2.1, 'CB') / 2 + 1.4, bh / 2 + 2.2
        beside = [(cx + dx * rx * far, cy + dy * ry * far) for far in (1, 1.9, 2.8)
                  for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (-1, 1), (1, 1), (-1, -1))]
        inside = bw > text_width(item['tag'], 2.1, 'CB') + 2.4 and bh > 3.4   # the tag goes in the box only when the box holds it
        labels.place(([(cx, cy)] if inside else []) + beside, item['tag'], size=2.1, colour=GREY, plate=not inside, leader=(cx, cy))
    for wall in model['walls']:
        pts = [P(p) for p in wall['corners']]; cx, cy = sum(p[0] for p in pts) / 4, sum(p[1] for p in pts) / 4
        span = math.dist(pts[0], pts[1]) or 1; nx, ny = -(pts[1][1] - pts[0][1]) / span, (pts[1][0] - pts[0][0]) / span
        reach = wall['width'] * k / 2 + 2.8; ax, ay = (pts[1][0] - pts[0][0]) / span, (pts[1][1] - pts[0][1]) / span
        labels.place([(cx + along * span * ax + s * nx * (reach + e), cy + along * span * ay + s * ny * (reach + e))
                      for e in (0, 3.5, 7, 11) for along in (0, .25, -.25, .42, -.42) for s in (1, -1)], wall['tag'], leader=(cx, cy))
    for opening in model['openings']:
        a, b = (P(p) for p in opening['ends']); mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        span = math.dist(a, b) or 1; nx, ny = -(b[1] - a[1]) / span, (b[0] - a[0]) / span
        ux, uy = (b[0] - a[0]) / span, (b[1] - a[1]) / span   # along the wall too: a section line may run through the opening
        labels.place([(mx + along * ux + s * nx * e, my + along * uy + s * ny * e) for e in (3.2, 6.4, 9.6) for along in (0, 6, -6, 12, -12) for s in (1, -1)],
                     opening['tag'], colour=BLUE, leader=(mx, my))
    mx0, my0, mx1, my1 = model['measured']; low, far = P((x0, y0))[1], P((x0, y0))[0]
    (wx0, wy0), (wx1, _), (_, wy1) = P((mx0, my0)), P((mx1, my0)), P((mx0, my1))   # extension lines start at the walls they measure
    _dimension(sheet, (wx0, wy0), (wx1, wy0), low - wy0 + 12, f'{mx1 - mx0:.2f}')
    _dimension(sheet, (wx0, wy1), (wx0, wy0), far - wx0 - 12, f'{my1 - my0:.2f}', vertical=True)
    # Key, legend and notes down the right side.
    kx, ky = AREA[2] - 54, AREA[1] + 4
    sheet.text(kx, ky + 2, 'ELEVATION KEY', size=2.2, font='HB', colour=GREY)
    ex, ey = kx + 22, ky + 24
    sheet.poly([(ex + 5 * math.cos(t / 12 * math.pi), ey + 5 * math.sin(t / 12 * math.pi)) for t in range(24)], width=.25)
    for n, (dx, dy) in enumerate(((0, -1), (1, 0), (0, 1), (-1, 0)), 1):   # 1 looks up the sheet, then clockwise
        tip = (ex + dx * 10.5, ey + dy * 10.5); base = (ex + dx * 6.2, ey + dy * 6.2)
        sheet.poly([tip, (base[0] - dy * 2.4, base[1] + dx * 2.4), (base[0] + dy * 2.4, base[1] - dx * 2.4)], fill=INK, stroke=None)
        sheet.text(ex + dx * 15, ey + dy * 15 + 1.3, str(n), size=3.6, font='HB', anchor='c')
    sheet.text(kx, ky + 48, 'Views look outward from the', size=2.1, colour=GREY); sheet.text(kx, ky + 51.4, 'centre of the plan: sheets A-201 to A-204.', size=2.1, colour=GREY)
    ly = ky + 62
    sheet.text(kx, ly, 'LEGEND', size=2.2, font='HB', colour=GREY)
    rows = [row for row, shown in ((('wall', 'Wall found in the scan (W)'), model['walls']), (('object', 'Object box, not its outline (O)'), model['objects']),
                                   (('extent', 'Floor bounding extent, not a room'), model['floor']), (('unknown', 'Not seen: unknown, not free'), model['unknown']),
                                   (('opening', 'Reviewed opening (P)'), model['openings']), (('cut', 'Section line, arrows show the view'), True)) if shown]
    for n, (kind, label) in enumerate(rows):
        y = ly + 5.5 + n * 6
        if kind == 'wall': sheet.rect(kx, y - 2.2, 9, 2.2, fill=INK, stroke=None)
        elif kind == 'object': sheet.rect(kx, y - 2.8, 9, 2.8, fill=PALE, stroke=GREY)
        elif kind == 'extent': sheet.line(kx, y - 1.2, kx + 9, y - 1.2, colour=GREY, width=.13, dash=(1.6, 1.2))
        elif kind == 'unknown': sheet.rect(kx, y - 2.8, 9, 2.8, fill=PINK, stroke=PINK_LINE, width=.1)
        elif kind == 'opening': sheet.line(kx, y - 1.2, kx + 9, y - 1.2, colour=BLUE, width=.5, dash=(1.2, .8))
        else: sheet.line(kx, y - 1.2, kx + 9, y - 1.2, colour=BLUE, width=.35, dash=(6, 1.2, 1, 1.2))
        sheet.text(kx + 11.5, y - .4, label, size=2.3)
    ny = ly + 11 + len(rows) * 6
    sheet.text(kx, ny, 'NOTES', size=2.2, font='HB', colour=GREY)
    turn = model['turn_degrees']
    notes = [f"Overall dimensions run across the {model['measured_what']} found, outside to outside, in metres. They follow the scene's scale: check them on site.",
             'There is no north point: the scan has no compass.',
             (f'The plan is turned {abs(turn):.1f} degrees {"clockwise" if turn > 0 else "anticlockwise"} from the scan frame, so most walls run square to the sheet.'
              if turn else 'Plan top is the scan frame.'),
             'Wall and object tags match the schedules.']
    if labels.omitted:
        notes.append(f'{labels.omitted} tag(s) left off where they would overlap. Every element is scheduled.')
    if plain:
        notes.append(f'{plain} unknown area(s) are tinted without hatching: too many lines to draw.')
    lines = [line for note in notes for line in wrap(note, 2.2, 'H', 52)]
    for n, line in enumerate(lines):
        sheet.text(kx, ny + 5 + n * 3.6, line, size=2.2)
    _scale_bar(sheet, AREA[0] + 2, AREA[3] - 6, scale)
    return sheet, labels.omitted


# ---------------------------------------------------------------- elevations and sections

def _clip(polygon, d, plane):
    """The part of a convex plan polygon at or beyond the plane (Sutherland-Hodgman), and the points on the plane."""
    out, on = [], []
    for n, p in enumerate(polygon):
        q = polygon[(n + 1) % len(polygon)]; sp, sq = p[0] * d[0] + p[1] * d[1] - plane, q[0] * d[0] + q[1] * d[1] - plane
        if sp >= 0:
            out.append(p)
        if (sp < 0) != (sq < 0) and sp != sq:
            t = sp / (sp - sq); hit = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t); out.append(hit); on.append(hit)
    return out, on


def _entry(polygon, d, r, u):
    """How far along d a sight line at u first meets the polygon; None when it misses."""
    best = None
    for n, p in enumerate(polygon):
        q = polygon[(n + 1) % len(polygon)]; up, uq = p[0] * r[0] + p[1] * r[1], q[0] * r[0] + q[1] * r[1]
        if min(up, uq) <= u <= max(up, uq) and abs(uq - up) > 1e-12:
            t = (u - up) / (uq - up); depth = (p[0] + (q[0] - p[0]) * t) * d[0] + (p[1] + (q[1] - p[1]) * t) * d[1]
            best = depth if best is None else min(best, depth)
    return best


def _overlapping(shapes):
    """Index pairs of shapes whose spans along the view overlap, by a sweep; None past ORDER_CHECKS pairs."""
    order = sorted(range(len(shapes)), key=lambda n: shapes[n]['u0']); pairs = []
    for at, i in enumerate(order):
        for j in order[at + 1:]:
            if shapes[j]['u0'] >= shapes[i]['u1'] - 1e-9:
                break
            pairs.append((i, j))
            if len(pairs) > ORDER_CHECKS:
                return None
    return pairs


def _far_to_near(shapes, d, r):
    """The shapes in an order that paints nearer over farther, and whether that order is exact.

    The nearest point of a turned box says little about where it sits at one place along the view, so two shapes that
    overlap are compared on a sight line through the middle of their overlap. Boxes that do not intersect always have
    such an order. Boxes that do, or a view with more pairs than ORDER_CHECKS, fall back to nearest point first."""
    shapes = sorted(shapes, key=lambda s: (-s['depth'], s['tag'], s['u0'])); pairs = _overlapping(shapes)
    if pairs is None:
        return shapes, False
    after = [set() for _ in shapes]; waits = [0] * len(shapes)   # after[i]: shapes that must be painted after i
    for i, j in pairs:
        if shapes[i]['z0'] >= shapes[j]['z1'] or shapes[j]['z0'] >= shapes[i]['z1']:
            continue   # one is above the other: neither can hide the other
        u = (max(shapes[i]['u0'], shapes[j]['u0']) + min(shapes[i]['u1'], shapes[j]['u1'])) / 2
        di, dj = _entry(shapes[i]['plan'], d, r, u), _entry(shapes[j]['plan'], d, r, u)
        if di is None or dj is None or abs(di - dj) < 1e-9:
            continue
        far, near = (i, j) if di > dj else (j, i)
        if near not in after[far]:
            after[far].add(near); waits[near] += 1
    ready = [n for n in range(len(shapes)) if not waits[n]]; heapq.heapify(ready); out = []; exact = True
    left = set(range(len(shapes)))
    while left:
        if not ready:   # a ring: boxes that pass through each other have no order
            exact = False; n = min(left); waits[n] = 0
        else:
            n = heapq.heappop(ready)
            if n not in left:
                continue
        left.discard(n); out.append(shapes[n])
        for m in sorted(after[n]):
            waits[m] -= 1
            if waits[m] == 0 and m in left:
                heapq.heappush(ready, m)
    return out, exact


def _mark_seen(shapes):
    """Give each shape the largest part of its rectangle that nothing painted later covers, or None when hidden."""
    order = sorted(range(len(shapes)), key=lambda n: shapes[n]['u0']); checks = 0
    for i, shape in enumerate(shapes):
        shape['seen'] = (shape['u0'], shape['u1'], shape['z0'], shape['z1'])
    for i, shape in enumerate(shapes):
        pieces = [shape['seen']]
        for j in order:
            if shapes[j]['u0'] >= shape['u1']:
                break
            other = shapes[j]
            if j <= i or other['u1'] <= shape['u0'] or other['z1'] <= shape['z0'] or other['z0'] >= shape['z1']:
                continue
            checks += 1; rest = []
            for u0, u1, z0, z1 in pieces:
                if other['u0'] >= u1 or other['u1'] <= u0 or other['z0'] >= z1 or other['z1'] <= z0:
                    rest.append((u0, u1, z0, z1)); continue
                if other['u0'] > u0: rest.append((u0, other['u0'], z0, z1))
                if other['u1'] < u1: rest.append((other['u1'], u1, z0, z1))
                low, high = max(u0, other['u0']), min(u1, other['u1'])
                if other['z0'] > z0: rest.append((low, high, z0, other['z0']))
                if other['z1'] < z1: rest.append((low, high, other['z1'], z1))
            pieces = [p for p in rest if p[1] - p[0] > 1e-6 and p[3] - p[2] > 1e-6]
            if not pieces or len(pieces) > 64 or checks > ORDER_CHECKS:
                break
        if checks > ORDER_CHECKS:
            return   # too many to work out: the rest keep their whole rectangle
        shape['seen'] = max(pieces, key=lambda p: ((p[1] - p[0]) * (p[3] - p[2]), -p[0], -p[2])) if pieces else None


def view_shapes(boxes, d, plane, *, cut, report=None):
    """What a viewer standing on the plane and looking along d sees, far to near, then what the plane cuts.

    Each shape is a rectangle in view coordinates: u along the viewer's right, z up from the floor estimate. Its
    'seen' is the largest part nothing nearer covers, None when it is hidden. report, a dict, is told whether the
    order is exact."""
    r = (d[1], -d[0])
    beyond, faces = [], []
    for box in boxes:
        kept, on = _clip(list(box['corners']), d, plane)
        if len(kept) < 3:
            continue   # behind the viewer
        us = [p[0] * r[0] + p[1] * r[1] for p in kept]; depths = [p[0] * d[0] + p[1] * d[1] for p in kept]
        if max(us) - min(us) < 1e-9:
            continue
        nearest = min(range(len(kept)), key=lambda n: depths[n])
        shape = {'kind': box['kind'], 'tag': box['tag'], 'u0': min(us), 'u1': max(us), 'z0': box['z0'], 'z1': box['z1'], 'depth': min(depths), 'plan': kept,
                 'edge': us[nearest] if min(us) + 1e-6 < us[nearest] < max(us) - 1e-6 and depths[nearest] > plane + 1e-6 else None}
        beyond.append(shape)
        if cut and len(on) >= 2:
            cu = [p[0] * r[0] + p[1] * r[1] for p in on]
            if max(cu) - min(cu) > 1e-6:
                faces.append({'kind': box['kind'], 'tag': box['tag'], 'u0': min(cu), 'u1': max(cu), 'z0': box['z0'], 'z1': box['z1'], 'cut': True})
    beyond, exact = _far_to_near(beyond, d, r)
    shapes = beyond + faces
    _mark_seen(shapes)
    for shape in shapes:
        shape.pop('plan', None)
    if report is not None:
        report['exact'] = exact
    return shapes


def pick_cut(boxes, d, low, high):
    """Of nine evenly spaced planes across the plan, the one that passes through the most elements; ties go to the
    middle. A plane between two of the nine can pass through more."""
    best = None
    for n in range(1, 10):
        plane = low + (high - low) * n / 10; crossed = set()
        for box in boxes:
            depths = [p[0] * d[0] + p[1] * d[1] for p in box['corners']]
            if min(depths) < plane < max(depths):
                crossed.add((box['kind'], box['tag']))
        key = (len(crossed), -abs(n - 5), -n)
        if best is None or key > best[0]:
            best = (key, plane)
    return best[1]


def _views(model):
    """The six views: four interior elevations from the plan centre and two sections on the chosen cut planes."""
    x0, y0, x1, y1 = model['bounds']; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    cut_a = pick_cut(model['boxes'], (0, 1), y0, y1); cut_b = pick_cut(model['boxes'], (1, 0), x0, x1)
    views = [('A-201', 'Elevation 1, looking to plan top', (0, 1), cy, False), ('A-202', 'Elevation 2, looking to plan right', (1, 0), cx, False),
             ('A-203', 'Elevation 3, looking to plan bottom', (0, -1), -cy, False), ('A-204', 'Elevation 4, looking to plan left', (-1, 0), -cx, False),
             ('A-301', 'Section A-A, looking to plan top', (0, 1), cut_a, True), ('A-302', 'Section B-B, looking to plan right', (1, 0), cut_b, True)]
    built = []
    for number, title, d, plane, cut in views:
        r = (d[1], -d[0]); corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        span = [p[0] * r[0] + p[1] * r[1] for p in corners]
        report = {}; shapes = view_shapes(model['boxes'], d, plane, cut=cut, report=report)
        drawn = [s for s in shapes if s['kind'] == 'wall'] or shapes   # the width dimension runs across what this view draws
        built.append({'number': number, 'title': title, 'd': d, 'plane': plane, 'cut': cut, 'exact': report['exact'], 'u0': min(span), 'u1': max(span), 'shapes': shapes,
                      'm0': min((s['u0'] for s in drawn), default=min(span)), 'm1': max((s['u1'] for s in drawn), default=max(span))})
    return built, (cut_a, cut_b)


def _elevation(view, scale, top, low=0.0):
    left, right, bottom, ceiling = AREA[0] + 22, AREA[2] - 30, AREA[3] - 30, AREA[1] + 22
    k = 1000 / scale; sheet = Sheet(view['number'], view['title'], scale)
    width = (view['u1'] - view['u0']) * k; ox = left + ((right - left) - width) / 2
    ground = min(bottom + low * k, (ceiling + bottom) / 2 + (top + low) * k / 2)   # the drawing, down to anything below the floor, sits in the middle
    U = lambda u: ox + (u - view['u0']) * k; Z = lambda z: ground - z * k
    labels = _Labels(sheet, (AREA[0], AREA[1] + 14, AREA[2], AREA[3])); budget = HATCH_LINES
    for shape in view['shapes']:
        x, y, w, h = U(shape['u0']), Z(shape['z1']), (shape['u1'] - shape['u0']) * k, (shape['z1'] - shape['z0']) * k
        if shape.get('cut'):   # what the section plane passes through: heavy outline, hatched
            sheet.rect(x, y, w, h, fill=LIGHT, stroke=None)
            budget -= _hatch(sheet, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], 1.4, colour=GREY, budget=budget) or 0
            sheet.rect(x, y, w, h, stroke=INK, width=.5)
        else:
            sheet.rect(x, y, w, h, fill=WHITE if shape['kind'] == 'wall' else PALE, stroke=INK if shape['kind'] == 'wall' else GREY, width=.2 if shape['kind'] == 'wall' else .18)
            if shape['edge'] is not None:
                sheet.line(U(shape['edge']), y, U(shape['edge']), y + h, width=.1, colour=GREY)
    sheet.line(U(view['u0']) - 6, ground, U(view['u1']) + 6, ground, width=.5)
    if top > 0:
        labels.block((U(view['u0']) - 6, Z(top) - .5, U(view['u1']) + 8, Z(top) + .5))
    tagged = {s_['tag'] for s_ in view['shapes'] if s_['tag']}; seen = set()
    for shape in reversed(view['shapes']):   # nearest first, so the tag of what is in front wins the space
        part = shape.get('seen')
        if not shape['tag'] or shape['tag'] in seen or part is None:
            continue   # a tag points at something the sheet shows: a hidden element gets none
        seen.add(shape['tag'])
        cx = (U(part[0]) + U(part[1])) / 2; wide = (part[1] - part[0]) * k > text_width(shape['tag'], 2.1, 'CB') + 2.4
        above = [(cx + dx, Z(part[3]) - dy) for dy in (2.4, 5.6, 8.8, 12) for dx in (0, 5, -5)]
        middle = [(cx, (Z(part[2]) + Z(part[3])) / 2)] if wide and (part[3] - part[2]) * k > 3.4 else []
        labels.place(middle + above, shape['tag'], size=2.1, colour=INK, leader=(cx, Z(part[3])))
    hidden = len(tagged - seen)
    _dimension(sheet, (U(view['m0']), ground), (U(view['m1']), ground), 12, f"{view['m1'] - view['m0']:.2f}")
    if top > 0:
        edge = U(view['u1']) + 8
        _dimension(sheet, (edge, Z(top)), (edge, ground), 10, f'{top:.2f}', vertical=True)
        sheet.line(U(view['u0']) - 6, Z(top), edge, Z(top), width=.1, colour=LIGHT, dash=(1.2, 1.2))
        sheet.text(U(view['u0']) - 7, Z(top) + .9, f'+{top:.2f}', size=2.3, font='C', anchor='r')
    sheet.text(U(view['u0']) - 7, ground + .9, '+0.00', size=2.3, font='C', anchor='r')
    if low < -.005:
        sheet.line(U(view['u0']) - 6, Z(low), U(view['u1']) + 6, Z(low), width=.1, colour=LIGHT, dash=(1.2, 1.2))
        sheet.text(U(view['u0']) - 7, Z(low) + .9, f'{low:.2f}', size=2.3, font='C', anchor='r')
    notes = ['Hatched: cut by the section plane. Beyond it, elements are shown as boxes.' if view['cut']
             else 'Elements beyond the plan centre, shown as boxes. Nearer elements hide those behind them.',
             'Heights are measured up from the floor estimate (+0.00), not from a surveyed level. No roof, ceiling or floor slab is modelled.']
    if labels.omitted:
        notes.append(f'{labels.omitted} tag(s) left off where they would overlap; see the plan and schedules.')
    if hidden:
        notes.append(f'{hidden} element(s) beyond the plane are hidden behind nearer ones and carry no tag here; see the plan.')
    if low < -.005:
        notes.append(f'Some elements reach {-low:.2f} m below the floor estimate.')
    if not view['exact']:
        notes.append('Some boxes here pass through each other or are too many to order: where they overlap, the one with the nearest point is drawn in front.')
    for n, line in enumerate(notes):
        sheet.text(AREA[0] + 2, AREA[1] + 4 + n * 4.2, line, size=2.4, colour=GREY)
    _scale_bar(sheet, AREA[0] + 2, AREA[3] - 6, scale)
    return sheet


# ---------------------------------------------------------------- schedules

def _table(number, title, columns, rows, *, notes=(), empty=None, totals=None):
    """One or more schedule sheets. Columns are (heading, width in mm, 'l' or 'r'); numbers use the fixed-width font."""
    sheets = []
    pages = [rows[n:n + ROWS_PER_SHEET] for n in range(0, len(rows), ROWS_PER_SHEET)] or [[]]
    for page, chunk in enumerate(pages):
        sheet = Sheet(number if len(pages) == 1 else f'{number}.{page + 1}', title if len(pages) == 1 else f'{title} ({page + 1} of {len(pages)})')
        x, y = AREA[0] + 2, AREA[1] + 8
        sheet.text(x, y, title, size=5, font='HB')
        y += 9
        total_width = sum(c[1] for c in columns)
        sheet.rect(x, y - 4.6, total_width, 6.4, fill=PALE, stroke=None)
        cx = x
        for heading, width, align in columns:
            sheet.text(cx + (width - 2 if align == 'r' else 2), y, heading, size=2.3, font='HB', anchor=align)
            cx += width
        sheet.line(x, y + 1.8, x + total_width, y + 1.8, width=.35)
        y += 7
        last = page == len(pages) - 1
        for row in chunk + ([totals] if totals and last else []):
            cx = x; bold = row is totals
            for (heading, width, align), value in zip(columns, row):
                font = ('CB' if bold else 'C') if align == 'r' else ('HB' if bold else 'H')
                sheet.text(cx + (width - 2 if align == 'r' else 2), y, fit_text(value, 2.5, font, width - 4), size=2.5, font=font, anchor=align)
                cx += width
            sheet.line(x, y + 1.7, x + total_width, y + 1.7, width=.35 if bold else .08, colour=INK if bold else LIGHT)
            y += 5.4
        if not rows and empty:
            sheet.text(x + 2, y, empty, size=2.8, colour=GREY)
            y += 6
        if last:
            y += 4
            for line in notes:
                sheet.text(x, y, line, size=2.4, colour=GREY)
                y += 4
        sheets.append(sheet)
    return sheets


def _schedules(scene, model):
    def m(value):
        return f'{value:.2f}'
    walls = model['walls']
    wall_rows = [[w['tag'], w['componentId'][:12], m(w['length']), m(w['height']), m(w['width']), m(w['net_face_area']),
                  str(len(w['openingComponentIds'])), w['thickness_properties']['ThicknessBasis'], w['provenance']] for w in walls]
    sheets = _table('Q-401', 'Wall schedule', [('TAG', 16, 'l'), ('COMPONENT', 34, 'l'), ('LENGTH m', 24, 'r'), ('HEIGHT m', 24, 'r'), ('THICKNESS m', 28, 'r'),
                                                ('NET FACE m2', 28, 'r'), ('OPENINGS', 22, 'r'), ('THICKNESS BASIS', 150, 'l'), ('PROVENANCE', 50, 'l')],
                    wall_rows, empty='The compiler found no wall in this scan.',
                    totals=['Total', f'{len(walls)} walls', m(sum(w['length'] for w in walls)), '', '', m(sum(w['net_face_area'] for w in walls)),
                            str(sum(len(w['openingComponentIds']) for w in walls)), '', ''] if walls else None,
                    notes=['Net face area is one face of the wall less its reviewed openings. It is not a finish or repair quantity.',
                           'Thickness is the model value unless the basis says it was observed.'])
    opening_rows = [[o['tag'], o['kind'], o['host'], m(o['width']), m(o['height']), m(o['sill']), m(o['offset']), m(o['width'] * o['height']), o['provenance']]
                    for o in model['openings']]
    sheets += _table('Q-402', 'Opening schedule', [('TAG', 16, 'l'), ('KIND', 30, 'l'), ('HOST WALL', 24, 'l'), ('WIDTH m', 24, 'r'), ('HEIGHT m', 24, 'r'),
                                                   ('SILL m', 22, 'r'), ('OFFSET m', 24, 'r'), ('AREA m2', 24, 'r'), ('PROVENANCE', 120, 'l')],
                     opening_rows, empty='No reviewed opening in this model revision. Openings are added in the building review step, then the set is rebuilt.',
                     notes=['Openings are entered by a reviewer against a wall; the scan does not place them. Offset runs along the host wall from its start.'])
    object_rows = []
    for o in model['objects']:
        cx, cy = o['scan_centre']
        reviewed = '-' if not o['label'] else 'yes' if o.get('label_reviewed') else 'no'
        object_rows.append([o['tag'], o['label'] or 'Unnamed object', o['ifc'], m(o['length']), m(o['width']), m(o['height']), m(o['length'] * o['width']),
                            m(cx), m(cy), reviewed, ('base inferred; ' if o.get('base_inferred') else '') + (o.get('label_source') or o['provenance'])])
    sheets += _table('Q-403', 'Object register', [('TAG', 16, 'l'), ('NAME', 62, 'l'), ('IFC CLASS', 50, 'l'), ('LENGTH m', 22, 'r'), ('WIDTH m', 22, 'r'),
                                                  ('HEIGHT m', 22, 'r'), ('PLAN m2', 22, 'r'), ('DXF X m', 22, 'r'), ('DXF Y m', 22, 'r'), ('NAME REVIEWED', 28, 'l'),
                                                  ('SOURCE', 88, 'l')],
                     object_rows, empty='The compiler separated no object in this scan.',
                     notes=['Each object is the box the compiler placed around a separated cluster of points. Length, width and height are that box.',
                            'A name is a suggestion until NAME REVIEWED says yes. DXF X and Y are the box centre in the scan frame, as in scene-plan.dxf.'])
    totals = model['totals']
    def value(key):   # counts stay whole numbers; lengths and areas show two decimals
        v = totals.get(key)
        return '-' if v is None else str(v) if key in ('walls', 'openings', 'doors', 'objects', 'named_objects') else f'{float(v):.2f}'
    extent = totals['floor_extent_m']
    quantity_rows = [['Floor bounding extent', f'{extent[0]:.2f} x {extent[1]:.2f}' if extent else '-', 'm', 'The rectangle around the points. Not a room outline.'],
                     ['Floor bounding extent area', value('floor_extent_area_m2'), 'm2', 'Area of that rectangle. Not a measured floor area.'],
                     ['Point-covered footprint', value('point_covered_footprint_area_m2'), 'm2', 'The extent less the cells no point reached. An estimate.'],
                     ['Unknown space', value('unknown_area_m2'), 'm2', 'Cells no reconstructed point reached. Not free space.'],
                     ['Walls', value('walls'), 'no.', 'Vertical planes the compiler accepted as walls.'],
                     ['Wall length', value('wall_length_m'), 'm', 'Sum of wall lengths.'],
                     ['Wall face area', value('wall_face_area_m2'), 'm2', 'One face of each wall less reviewed openings.'],
                     ['Openings', value('openings'), 'no.', 'Reviewed openings hosted on walls.'],
                     ['Doors', value('doors'), 'no.', 'Closed reference door leaves in reviewed openings.'],
                     ['Objects', value('objects'), 'no.', 'Separated boxes.'],
                     ['Named objects', value('named_objects'), 'no.', 'Objects that carry a suggested or reviewed name.']]
    sheets += _table('Q-404', 'Quantities', [('QUANTITY', 70, 'l'), ('VALUE', 40, 'r'), ('UNIT', 18, 'l'), ('WHAT IT IS', 200, 'l')], quantity_rows,
                     notes=['These totals are the summary rows of quantities.csv, counted from the same model as the drawings.',
                            'They are geometric quantities. Material, waste, damage, scope and price are estimator decisions.', scale_sentence(scene)])
    return sheets


def _index(sheet, entries, x, y, rows):
    for n, item in enumerate(entries):
        column, row = divmod(n, rows)
        sx, sy = x + column * 122, y + row * 5.6
        sheet.text(sx, sy, item.number, size=2.8, font='CB')
        sheet.text(sx + 22, sy, fit_text(item.title, 2.8, 'H', 74), size=2.8)
        sheet.text(sx + 100, sy, f'1:{item.scale}' if item.scale else '-', size=2.6, font='C', colour=GREY)


def _cover(meta, sheets, counts):
    """The cover, and index continuation sheets when the set is longer than its two index columns hold."""
    sheet = Sheet('G-001', 'Cover and sheet index')
    extra = 0
    while 1 + extra + len(sheets) > 2 * INDEX_ROWS + extra * INDEX_MORE:   # the index lists its own continuation sheets
        extra += 1
    more = [Sheet(f'G-{n + 2:03d}', f'Sheet index, continued ({n + 1} of {extra})') for n in range(extra)]
    entries = [sheet] + more + sheets
    rows = 14 if len(entries) <= 28 else INDEX_ROWS
    x, y = AREA[0] + 2, AREA[1] + 14
    sheet.text(x, y, 'Drawing set', size=11, font='HB')
    sheet.text(x, y + 8, fit_text(meta['name'], 5, 'H', 230), size=5, colour=GREY)
    y += 22
    sheet.text(x, y, 'THE MODEL', size=2.4, font='HB', colour=GREY)
    for n, (label, value) in enumerate([('Walls', counts['walls']), ('Openings', counts['openings']), ('Objects', counts['objects']),
                                        ('Unknown cells', counts['unknownCells'])]):
        sheet.text(x + n * 44, y + 11, str(value), size=9, font='HB')
        sheet.text(x + n * 44, y + 16, label, size=2.6, colour=GREY)
    y += 28
    sheet.text(x, y, 'SHEETS', size=2.4, font='HB', colour=GREY)
    _index(sheet, entries[:2 * rows], x, y + 6, rows)   # two columns: a third would run under the note
    for n, page in enumerate(more):
        page.text(x, AREA[1] + 8, page.title, size=5, font='HB')
        _index(page, entries[2 * rows + n * INDEX_MORE:2 * rows + (n + 1) * INDEX_MORE], x, AREA[1] + 20, INDEX_MORE // 3)
    if more:
        sheet.text(x, y + 6 + rows * 5.6 + 2, f'The index continues on {more[0].number}' + (f' to {more[-1].number}.' if extra > 1 else '.'), size=2.6, colour=GREY)
    nx, ny = AREA[2] - 128, AREA[1] + 14
    paragraphs = ['Every sheet is drawn from the compiled model: the same geometry as scene.ifc, scene-plan.dxf and quantities.csv.',
                  'The model is what the software found in the capture. A wall it did not find is not here. An object is a box, not its true shape.',
                  'Dimensions follow the scale below. Nobody has checked them against the building. Measure before you build, order or price from this set.',
                  'There is no north point, room boundary, material, level datum, pipework or steelwork.', meta['scale_note']]
    lines = [line for paragraph in paragraphs for line in wrap(paragraph, 2.6, 'H', 118) + ['']][:-1]
    sheet.rect(nx - 4, ny - 8, 130, 16 + len(lines) * 4.4, fill=PALE, stroke=None)
    sheet.text(nx, ny, 'READ THIS FIRST', size=2.6, font='HB', colour=RED)
    for n, line in enumerate(lines):
        sheet.text(nx, ny + 7 + n * 4.4, line, size=2.6)
    sheet.text(x, AREA[3] - 12, f"Source cloud {meta['source']}", size=2.3, font='C', colour=GREY)
    sheet.text(x, AREA[3] - 8, f"Scene {meta['scene']}   component revision {meta['revision']}", size=2.3, font='C', colour=GREY)
    return [sheet] + more


# ---------------------------------------------------------------- the set

def build_sheets(scene, *, name=None):
    """All sheets of the set, with the facts the evidence records. Raises ValueError on a scene it cannot draw."""
    scene = ensure_component_ids(scene)
    model = _model(scene)
    graph = scene['componentGraph']
    title = name if isinstance(name, str) and name.strip() else scene.get('name') if isinstance(scene.get('name'), str) and scene['name'].strip() else 'BrainSNN scene'
    meta = {'name': ' '.join(clean(title, 80).split()), 'source': graph['sourceSha256'], 'revision': graph['revision'], 'scene': scene_sha256(scene),
            'scale_note': scale_sentence(scene)}
    views, cuts = _views(model)
    top = max([b['z1'] for b in model['boxes']] + [0.0]); low = min([b['z0'] for b in model['boxes']] + [0.0])   # an edit can sink a box below the floor
    x0, y0, x1, y1 = model['bounds']
    view_scale = pick_scale(max(x1 - x0, y1 - y0), max(top - low, .1), AREA[2] - AREA[0] - 52, AREA[3] - AREA[1] - 52)
    plan, omitted = _plan(model, meta, cuts)
    drawings = [plan] + [_elevation(view, view_scale, top, low) for view in views]
    sheets = drawings + _schedules(scene, model)
    counts = {'walls': len(model['walls']), 'openings': len(model['openings']), 'objects': len(model['objects']), 'unknownCells': len(model['unknown'])}
    sheets = _cover(meta, sheets, counts) + sheets
    for index, sheet in enumerate(sheets, 1):
        _frame(sheet, meta, index, len(sheets))
    facts = {'counts': counts, 'omittedPlanTags': omitted, 'planScale': plan.scale, 'viewScale': view_scale, 'heightAboveFloorMetres': round(top, 3), 'depthBelowFloorMetres': round(-low, 3),
             'planTurnDegrees': round(model['turn_degrees'], 3),
             'sectionPlanesSheetMetres': {'A-A': {'sheetY': round(cuts[0], 3)}, 'B-B': {'sheetX': round(cuts[1], 3)}},
             'sourceSha256': meta['source'], 'revision': meta['revision'], 'canonicalSceneSha256': meta['scene'], 'title': meta['name']}
    return sheets, facts


def write_drawing_set(scene: dict, output_dir: Path, *, name: str | None = None, scene_path: Path | None = None):
    """Write drawing-set.pdf beside the scene's other exports; return evidence and its manifest entry.

    A non-metric scene returns written=False and writes nothing. A scene that cannot be drawn raises ValueError.
    The file is built in a private staging directory and published with one rename."""
    if not isinstance(scene, dict):
        raise ValueError('Use a scene JSON object.')
    out = Path(output_dir)
    def withdraw():   # a set drawn from an earlier scene must not sit beside a scene that can no longer be drawn
        if out.is_dir():
            for stale in [out / PDF_NAME, out / PREVIEW_NAME, *out.glob('drawing-*.svg')]:
                if stale.is_file() and not stale.is_symlink():
                    stale.unlink()
    reason = _metric_reason(scene)
    if reason:
        withdraw()
        return {'written': False, 'reason': reason, 'artifacts': []}
    try:
        sheets, facts = build_sheets(scene, name=name)
    except ValueError:
        withdraw()
        raise
    raw = write_pdf(sheets, f"{facts['title']} - drawing set")
    pdf_hash = hashlib.sha256(raw).hexdigest()
    # The browser draws these same bounded primitives; it never embeds executable worker SVG/PDF content.
    # Bind to the exact published scene bytes, not a cross-language reserialization of JSON numbers.
    preview = None
    preview_reason = 'A matching published scene file is required for an inline preview.'
    if scene_path is not None:
        try:
            path = Path(scene_path)
            if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_SCENE_BYTES:
                raise ValueError('Drawing preview needs a bounded regular scene file.')
            scene_raw = path.read_bytes()
            if json.loads(scene_raw) != scene:
                raise ValueError('Drawing preview scene file differs from the scene being drawn.')
        except (OSError, ValueError):
            withdraw()
            raise
        preview_reason = 'The drawing set exceeds the bounded inline preview; download its PDF.'
        if len(sheets) <= MAX_PREVIEW_SHEETS and sum(len(s.ops) for s in sheets) <= MAX_PREVIEW_OPS:
            candidate = {'schema': 'brainsnn.drawing-preview.v1', 'paper': {'width': SHEET_W, 'height': SHEET_H, 'units': 'mm'},
                         'source': {'sceneFileSha256': hashlib.sha256(scene_raw).hexdigest(),
                                    'cloudPointsSha256': facts['sourceSha256'], 'revision': facts['revision']},
                         'pdf': {'name': PDF_NAME, 'sha256': pdf_hash, 'bytes': len(raw)},
                         'metricVerified': False, 'physicalDimensionsVerified': False, 'scaleSentence': scale_sentence(scene),
                         'sheets': [{'number': s.number, 'title': s.title, 'scale': s.scale, 'ops': s.ops} for s in sheets]}
            encoded = json.dumps(candidate, separators=(',', ':'), allow_nan=False).encode('utf-8')
            if len(encoded) <= MAX_PREVIEW_BYTES:
                preview = encoded
    out.mkdir(parents=True, exist_ok=True)
    stale_preview = out / PREVIEW_NAME
    if stale_preview.is_file() and not stale_preview.is_symlink():
        stale_preview.unlink()
    with tempfile.TemporaryDirectory(prefix='.drawing-set-', dir=out) as temporary:
        staged = Path(temporary) / PDF_NAME
        staged.write_bytes(raw)
        os.replace(staged, out / PDF_NAME)
        if preview is not None:
            staged = Path(temporary) / PREVIEW_NAME
            staged.write_bytes(preview)
            os.replace(staged, out / PREVIEW_NAME)
    artifacts = [{'name': PDF_NAME, 'kind': 'cad'}]
    preview_evidence = {'written': False, 'reason': preview_reason}
    if preview is not None:
        artifacts.append({'name': PREVIEW_NAME, 'kind': 'cad'})
        preview_evidence = {'written': True, 'file': PREVIEW_NAME, 'sha256': hashlib.sha256(preview).hexdigest(), 'bytes': len(preview)}
    return {'written': True, 'schema': SCHEMA, 'artifacts': artifacts, 'file': PDF_NAME, 'preview': preview_evidence,
            'sha256': pdf_hash, 'bytes': len(raw), 'paper': 'A3 landscape', 'pages': len(sheets),
            'sheets': [{'number': s.number, 'title': s.title, 'scale': f'1:{s.scale}' if s.scale else None} for s in sheets],
            'metricVerified': False, 'physicalDimensionsVerified': False, 'scale': cad_export.scale_note(scene), 'scaleSentence': scale_sentence(scene),
            'notModelled': ['north point', 'room boundaries', 'materials', 'level datum', 'pipes, valves and steel members'], **facts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--name', help='project name for the title block')
    parser.add_argument('--svg', action='store_true', help='also write one SVG preview per sheet')
    args = parser.parse_args()
    if args.scene.is_symlink() or not args.scene.is_file() or args.scene.stat().st_size > MAX_SCENE_BYTES:
        parser.error('Scene must be a bounded regular JSON file.')
    scene = json.loads(args.scene.read_text(encoding='utf-8'))
    evidence = write_drawing_set(scene, args.out, name=args.name, scene_path=args.scene)
    if args.svg and evidence['written']:
        for sheet in build_sheets(scene, name=args.name)[0]:
            (args.out / f'drawing-{sheet.number}.svg').write_text(to_svg(sheet), encoding='utf-8')
    print(json.dumps(evidence, allow_nan=False))


if __name__ == '__main__':
    main()
