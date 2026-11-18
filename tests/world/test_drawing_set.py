"""The drawing set of a compiled scene: python -m pytest tests/world/test_drawing_set.py

The scene is test_cad_export's authored room: a 4 x 3 m floor extent, a 4 m wall along x, a 3 m wall along z, a sofa
turned 30 degrees, a small unnamed box and two unknown cells. It is software geometry, not a capture: these tests check
that the sheets say what the model says, not that any model matches a building.

The PDF is read back twice without the module's own writer: by a structural walk of its cross-reference table here,
and by pypdf.
"""
from pathlib import Path
import copy
import hashlib
import json
import math
import re
import sys
import zlib

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import cad_export as ce  # noqa: E402
import drawing_set as ds  # noqa: E402
from tests.world.test_cad_export import scene, reviewed_scene, FLOOR_Y  # noqa: E402


def test_inline_preview_uses_the_same_sheet_operations_and_published_source(tmp_path):
    data = ds.ensure_component_ids(scene())
    path = tmp_path / 'scene.json'; path.write_text(json.dumps(data, indent=1))
    evidence = ds.write_drawing_set(data, tmp_path, scene_path=path)
    raw = (tmp_path / ds.PREVIEW_NAME).read_bytes(); preview = json.loads(raw)
    assert {'name': ds.PREVIEW_NAME, 'kind': 'cad'} in evidence['artifacts']
    assert evidence['preview'] == {'written': True, 'file': ds.PREVIEW_NAME, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    assert preview['source'] == {'sceneFileSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                 'cloudPointsSha256': data['componentGraph']['sourceSha256'], 'revision': data['componentGraph']['revision']}
    assert preview['pdf']['sha256'] == hashlib.sha256((tmp_path / ds.PDF_NAME).read_bytes()).hexdigest()
    assert preview['pdf']['bytes'] == (tmp_path / ds.PDF_NAME).stat().st_size
    assert preview['metricVerified'] is preview['physicalDimensionsVerified'] is False
    for encoded, sheet in zip(preview['sheets'], ds.build_sheets(data)[0], strict=True):
        assert encoded == json.loads(json.dumps({'number': sheet.number, 'title': sheet.title, 'scale': sheet.scale, 'ops': sheet.ops}))


def test_preview_budget_keeps_pdf_and_removes_the_previous_preview(tmp_path, monkeypatch):
    data = scene(); path = tmp_path / 'scene.json'; path.write_text(json.dumps(data))
    assert ds.write_drawing_set(data, tmp_path, scene_path=path)['preview']['written']
    monkeypatch.setattr(ds, 'MAX_PREVIEW_BYTES', 1)
    result = ds.write_drawing_set(data, tmp_path, scene_path=path)
    assert result['written'] and not result['preview']['written']
    assert (tmp_path / ds.PDF_NAME).is_file() and not (tmp_path / ds.PREVIEW_NAME).exists()
    assert result['artifacts'] == [{'name': ds.PDF_NAME, 'kind': 'cad'}]


def test_preview_refuses_a_different_scene_file_and_withdraws_stale_drawings(tmp_path):
    data = scene(); path = tmp_path / 'scene.json'; path.write_text(json.dumps(data))
    ds.write_drawing_set(data, tmp_path, scene_path=path)
    data['name'] = 'Changed geometry revision'
    with pytest.raises(ValueError, match='differs'):
        ds.write_drawing_set(data, tmp_path, scene_path=path)
    assert not (tmp_path / ds.PDF_NAME).exists() and not (tmp_path / ds.PREVIEW_NAME).exists()


def sheets_of(data, **options):
    sheets, facts = ds.build_sheets(data, **options)
    return {s.number: s for s in sheets}, facts


def filled(sheet, colour):
    return [op[1] for op in sheet.ops if op[0] == 'poly' and op[4] == colour]


def tag_boxes(sheet, pattern):
    """Paper boxes of the centred tags matching the pattern, sized with the module's own font metrics."""
    out = {}
    for op in sheet.ops:
        if op[0] == 'text' and re.fullmatch(pattern, op[2]) and op[5] == 'c':
            (x, y), text, size, font = op[1], op[2], op[3], op[4]
            w = ds.text_width(text, size, font)
            out[text] = (x - w / 2, y - size * .74, x + w / 2, y)
    return out


def turned(data, degrees):
    """The same room turned about the vertical axis. The floor extent and unknown cells are axis-aligned by
    construction, so they are left out."""
    a = math.radians(degrees); out = copy.deepcopy(data)
    out['objects'] = [o for o in out['objects'] if o['name'] != 'floor_observed']; out['unknown'] = []
    for item in out['objects'] + out['walls']:
        x, y, z = item['centre']
        item['centre'] = [x * math.cos(a) - z * math.sin(a), y, x * math.sin(a) + z * math.cos(a)]
        item['yaw_degrees'] = item.get('yaw_degrees', 0) + degrees
    return out


# ---------------------------------------------------------------- the file

def walk_pdf(raw):
    """Follow startxref to the table, check every offset lands on its object, and return the decoded page streams."""
    assert raw.startswith(b'%PDF-1.4\n') and raw.rstrip().endswith(b'%%EOF')
    start = int(re.search(rb'startxref\n(\d+)\n%%EOF', raw).group(1))
    assert raw[start:start + 5] == b'xref\n'
    count = int(re.match(rb'xref\n0 (\d+)\n', raw[start:]).group(1))
    rows = raw[start:].split(b'\n')[2:2 + count]
    assert rows[0] == b'0000000000 65535 f ' and all(len(row) == 19 for row in rows), 'each entry is 20 bytes with its newline'
    for number, row in enumerate(rows[1:], 1):
        offset = int(row[:10])
        assert raw[offset:].startswith(b'%d 0 obj\n' % number), f'object {number} is not at its recorded offset'
    assert int(re.search(rb'/Size (\d+)', raw[start:]).group(1)) == count
    streams = []
    for match in re.finditer(rb'<< /Length (\d+) /Filter /FlateDecode >>\nstream\n', raw):
        body = raw[match.end():match.end() + int(match.group(1))]
        assert raw[match.end() + len(body):].startswith(b'\nendstream')
        streams.append(zlib.decompress(body))
    return streams


def test_the_pdf_is_a_document_other_readers_open(tmp_path):
    evidence = ds.write_drawing_set(scene(), tmp_path, name='Authored room')
    raw = (tmp_path / ds.PDF_NAME).read_bytes()
    assert evidence['written'] and evidence['bytes'] == len(raw) and evidence['sha256'] == hashlib.sha256(raw).hexdigest()
    assert evidence['artifacts'] == [{'name': 'drawing-set.pdf', 'kind': 'cad'}]
    streams = walk_pdf(raw)
    assert len(streams) == evidence['pages'] == 12
    assert [s['number'] for s in evidence['sheets']] == ['G-001', 'A-101', 'A-201', 'A-202', 'A-203', 'A-204', 'A-301', 'A-302',
                                                         'Q-401', 'Q-402', 'Q-403', 'Q-404']
    assert int(re.search(rb'/Count (\d+)', raw).group(1)) == 12
    pypdf = pytest.importorskip('pypdf')
    reader = pypdf.PdfReader(tmp_path / ds.PDF_NAME)
    assert len(reader.pages) == 12 and reader.metadata.title == 'Authored room - drawing set'
    for page in reader.pages:   # A3 landscape in points
        assert float(page.mediabox.width) == pytest.approx(420 / 25.4 * 72, abs=.01)
        assert float(page.mediabox.height) == pytest.approx(297 / 25.4 * 72, abs=.01)
    plan = reader.pages[1].extract_text()
    assert all(text in plan for text in ('Floor plan', 'A-101', 'W1', 'W2', 'O1', 'O2', 'FOR REVIEW - DIMENSIONS UNVERIFIED'))
    assert 'Authored room' in plan and 'sheet 2 of 12' in plan
    assert not any(tmp_path.glob('.drawing-set-*')), 'the staging directory is gone'


def test_the_same_scene_gives_the_same_bytes(tmp_path):
    first = ds.write_drawing_set(scene(), tmp_path / 'a'); second = ds.write_drawing_set(scene(), tmp_path / 'b')
    assert (tmp_path / 'a' / ds.PDF_NAME).read_bytes() == (tmp_path / 'b' / ds.PDF_NAME).read_bytes()
    assert first == second
    moved = scene(); moved['walls'][0]['size'][0] = 3.5
    assert ds.write_drawing_set(moved, tmp_path / 'c')['sha256'] != first['sha256'], 'a changed wall changes the set'


def test_an_unscaled_scene_gets_no_drawings(tmp_path):
    evidence = ds.write_drawing_set(scene(units='arbitrary'), tmp_path)
    assert evidence == {'written': False, 'reason': evidence['reason'], 'artifacts': []} and 'metric scene' in evidence['reason']
    assert not list(tmp_path.iterdir())


def test_a_scene_with_nothing_placed_is_refused_not_drawn_empty(tmp_path):
    empty = scene(); empty['walls'] = []; empty['objects'] = empty['objects'][:1]
    with pytest.raises(ValueError, match='no placed geometry'):
        ds.write_drawing_set(empty, tmp_path)
    broken = scene(); broken['walls'][0]['centre'][0] = float('nan')
    with pytest.raises(ValueError):
        ds.write_drawing_set(broken, tmp_path)
    assert not list(tmp_path.iterdir())


def test_a_failed_publish_keeps_the_previous_set(tmp_path, monkeypatch):
    ds.write_drawing_set(scene(), tmp_path)
    before = (tmp_path / ds.PDF_NAME).read_bytes()
    def refuse(*_args):
        raise OSError('disk refused the rename')
    monkeypatch.setattr(ds.os, 'replace', refuse)
    changed = scene(); changed['walls'][0]['size'][0] = 3.5
    with pytest.raises(OSError):
        ds.write_drawing_set(changed, tmp_path)
    assert (tmp_path / ds.PDF_NAME).read_bytes() == before and [p.name for p in tmp_path.iterdir()] == [ds.PDF_NAME]


def test_names_from_a_scene_cannot_break_the_file(tmp_path):
    hostile = scene()
    hostile['objects'][1]['label'] = 'sofa) Tj ET (\\ \u2603 caf\u00e9'   # the component graph already refuses control characters
    ds.write_drawing_set(hostile, tmp_path, name='Plant (unit 4) \\ east\nwing\x00')
    raw = (tmp_path / ds.PDF_NAME).read_bytes()
    streams = walk_pdf(raw)
    register = next(s for s in streams if b'IFC CLASS' in s)
    assert b'sofa\\) Tj ET \\(\\\\ ? caf\xe9' in register, 'brackets and the backslash are escaped; a snowman has no glyph here'
    cover = streams[0]
    assert b'(Plant \\(unit 4\\) \\\\ east wing) Tj' in cover and b'\x00' not in cover and b'\nwing' not in cover
    pypdf = pytest.importorskip('pypdf')
    reader = pypdf.PdfReader(tmp_path / ds.PDF_NAME)
    assert 'sofa) Tj ET (\\ ? caf\u00e9' in reader.pages[10].extract_text()
    assert 'Plant (unit 4) \\ east wing' in reader.pages[0].extract_text()
    assert ds.clean('a\tb\u2603', 3) == 'a b' and ds.clean('\u2603') == '?'


# ---------------------------------------------------------------- the plan

def test_the_plan_is_to_scale_and_dimensioned_across_the_walls():
    sheets, facts = sheets_of(scene())
    plan = sheets['A-101']
    assert plan.scale in ds.SCALES and facts['planScale'] == plan.scale and facts['planTurnDegrees'] == 0
    mm = 1000 / plan.scale
    walls = filled(plan, ds.INK)
    spans = sorted(max(max(p[0] for p in w) - min(p[0] for p in w), max(p[1] for p in w) - min(p[1] for p in w)) for w in walls if len(w) == 4)
    assert spans[-2:] == pytest.approx([3 * mm, 4 * mm], abs=.01), 'a 4 m wall is 4000 / scale millimetres on paper'
    texts = plan.texts()
    # walls reach x 0 to 4.05 (the second wall's thickness) and y -3 to 0.05 in the plan frame
    assert '4.05' in texts and '3.05' in texts, 'overall dimensions run across the walls, outside to outside'
    assert f'1:{plan.scale} at A3' in texts
    # the scale bar's own length agrees with the scale
    bar = [op[1] for op in plan.ops if op[0] == 'poly' and op[4] in (ds.INK, ds.WHITE) and len(op[1]) == 4
           and abs((op[1][2][1] - op[1][0][1]) - 1.6) < 1e-6]
    metres = (bar[-1][1][0] - bar[0][0][0]) / mm
    assert len(bar) == 4 and metres == pytest.approx(round(metres, 1), abs=1e-6) and f'{metres:g}' in texts, 'the bar is a round length and says so'


def test_unknown_space_and_the_floor_extent_are_drawn_as_what_they_are():
    sheets, _ = sheets_of(scene())
    plan = sheets['A-101']
    cell = .5 * 1000 / plan.scale
    cells = [c for c in filled(plan, ds.PINK) if c[1][0] - c[0][0] == pytest.approx(cell, abs=.01)]
    assert len(cells) == 2 and len(filled(plan, ds.PINK)) == 3, 'both unknown cells are on the plan, and one legend swatch'
    assert any(op[0] == 'line' and op[3] == ds.PINK_LINE for op in plan.ops), 'and hatched'
    texts = ' '.join(plan.texts())
    assert 'Not seen: unknown, not free' in texts and 'Floor bounding extent, not a room' in texts
    assert 'Reviewed opening (P)' not in texts, 'the legend lists only what is drawn'
    assert 'no north point' in texts.lower() or 'There is no north point' in texts
    bare = scene(); bare['unknown'] = []
    assert 'Not seen' not in ' '.join(sheets_of(bare)[0]['A-101'].texts())


def test_a_reviewed_opening_is_drawn_tagged_and_scheduled():
    data = reviewed_scene()
    sheets, facts = sheets_of(data)
    plan, schedule = sheets['A-101'], sheets['Q-402']
    assert facts['counts']['openings'] == 1 and 'P1' in plan.texts() and 'Reviewed opening (P)' in plan.texts()
    gap = [op for op in plan.ops if op[0] == 'line' and op[3] == ds.BLUE and op[4] == (1.2, .8)]
    (x0, y0, x1, y1), = [op[1] for op in gap[:1]]
    assert math.hypot(x1 - x0, y1 - y0) == pytest.approx(1.0 * 1000 / plan.scale, abs=.01), 'the 1 m opening, to scale'
    row = schedule.texts()
    assert all(value in row for value in ('P1', 'opening', 'W1', '1.00', '2.10', '0.00', '1.50')) and facts['omittedPlanTags'] == 0
    walls = sheets['Q-401'].texts()
    assert '7.90' in walls and '15.10' in walls, 'net face area is less the opening: 4 x 2.5 - 2.1 and the total 15.1'
    assert 'No reviewed opening' in ' '.join(sheets_of(scene())[0]['Q-402'].texts())


def test_a_turned_building_is_squared_to_the_sheet_and_keeps_every_length():
    straight, _ = sheets_of(turned(scene(), 0)); skew, facts = sheets_of(turned(scene(), 25))
    assert abs(facts['planTurnDegrees']) == pytest.approx(25, abs=1e-6)
    assert 'turned 25.0 degrees' in ' '.join(skew['A-101'].texts())
    def sides(sheet):
        return sorted(round(math.dist(w[0], w[1]), 3) for w in filled(sheet, ds.INK) if len(w) == 4)[-2:]
    assert sides(skew['A-101']) == sides(straight['A-101'])
    for wall in sorted(filled(skew['A-101'], ds.INK), key=lambda w: -math.dist(w[0], w[1]))[:2]:
        dx, dy = wall[1][0] - wall[0][0], wall[1][1] - wall[0][1]
        assert min(abs(dx), abs(dy)) < 1e-6, 'both walls run along the sheet axes'
    assert sorted(t for t in skew['A-101'].texts() if t in ('4.05', '3.05')) == ['3.05', '4.05']
    # the schedule keeps scan-frame positions, as scene-plan.dxf has them
    sofa = next(i for i in ce.elements(turned(scene(), 25)) if i['name'] == 'object_1')
    centre = (sum(p[0] for p in sofa['corners']) / 4, sum(p[1] for p in sofa['corners']) / 4)
    register = skew['Q-403'].texts()
    assert f'{centre[0]:.2f}' in register and f'{centre[1]:.2f}' in register and 'DXF X m' in register


def test_square_angle_follows_the_long_walls_and_ignores_a_tiny_skew():
    def wall(length, degrees):
        a = math.radians(degrees)
        return {'length': length, 'corners': [(0, 0), (length * math.cos(a), length * math.sin(a))]}
    assert math.degrees(ds.square_angle([wall(8, 20), wall(6, 110), wall(1, 60)])) == pytest.approx(20, abs=3)
    assert math.degrees(ds.square_angle([wall(5, -30), wall(5, 60)])) == pytest.approx(-30)
    assert ds.square_angle([wall(5, .2)]) == 0 and ds.square_angle([]) == 0


def overlap(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def test_tags_never_cover_each_other_a_wall_or_a_section_line():
    plain, facts = sheets_of(scene())
    assert facts['omittedPlanTags'] == 0 and set(tag_boxes(plain['A-101'], r'[WO]\d+')) == {'W1', 'W2', 'O1', 'O2'}, 'a roomy plan carries every tag'
    crowded = scene()
    crowded['walls'] = crowded['walls'][:1] + [{'name': f'wall_{n}', 'label': 'wall', 'provenance': 'observed', 'centre': [.65 + .35 * n, crowded['floor_y'] + 1.2, 1.5],
                                                'size': [2.4, 2.4, .1], 'yaw_degrees': 90} for n in range(2, 10)]
    sheets, facts = sheets_of(crowded)
    plan = sheets['A-101']
    boxes = tag_boxes(plan, r'[WOP]\d+')
    assert len(boxes) + facts['omittedPlanTags'] == 9 + 2, 'a tag is drawn or counted as left off, never lost'
    assert len(boxes) >= 9, 'crowding costs a tag or two, not the tags'
    names = sorted(boxes)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            assert not overlap(boxes[a], boxes[b]), f'{a} covers {b}'
    walls = [w for w in filled(plan, ds.INK) if len(w) == 4 and max(p[0] for p in w) < ds.AREA[2] - 60 and max(p[1] for p in w) < ds.AREA[3] - 8]   # not the legend or the scale bar
    assert len(walls) == 9
    for wall in walls:   # these walls run along the sheet, so each is its own bounding box
        box = (min(p[0] for p in wall), min(p[1] for p in wall), max(p[0] for p in wall), max(p[1] for p in wall))
        assert not any(overlap(box, tag) for tag in boxes.values()), 'a tag sits on a wall'
    cuts = [op[1] for op in plan.ops if op[0] == 'line' and op[4] == (6, 1.2, 1, 1.2) and op[1][0] < ds.AREA[2] - 60]   # not the legend's sample
    assert len(cuts) == 2, 'two section lines'
    for x0, y0, x1, y1 in cuts:
        line = (min(x0, x1) - .05, min(y0, y1) - .05, max(x0, x1) + .05, max(y0, y1) + .05)
        assert not any(overlap(line, tag) for tag in boxes.values()), 'a tag sits on a section line'
    if facts['omittedPlanTags']:
        assert 'left off where they would overlap' in ' '.join(plan.texts())


def test_unknown_space_cannot_run_away_with_the_sheet():
    huge = scene(); huge['unknown'] = [[0, 0, 100000]]   # the cells do not set the scale, so this one is far larger than the sheet
    plan = sheets_of(huge)[0]['A-101']
    window = (ds.AREA[0], ds.AREA[1], ds.AREA[2] - 60, ds.AREA[3])
    drawn = lambda sheet: [poly for poly in filled(sheet, ds.PINK) if min(p[0] for p in poly) < window[2]]   # not the legend's swatch
    pink = drawn(plan)
    assert len(pink) == 1 and all(window[0] - 1e-6 <= x <= window[2] + 1e-6 and window[1] - 1e-6 <= y <= window[3] + 1e-6 for poly in pink for x, y in poly), \
        'the tint stops at the drawing: it never covers the legend or the title block'
    hatch = lambda sheet: sum(1 for op in sheet.ops if op[0] == 'line' and op[3] == ds.PINK_LINE)
    assert 0 < hatch(plan) < 1000
    many = scene(); many['unknown'] = [[0, 0, 100000]] * 200
    plan = sheets_of(many)[0]['A-101']
    assert hatch(plan) <= ds.HATCH_LINES, 'the hatch has a budget for the sheet'
    assert 'tinted without hatching' in ' '.join(plan.texts()), 'and the sheet says which areas went without'
    assert len(drawn(plan)) == 200, 'every unknown area is still tinted'
    assert ds._clip_rect([(0, 0), (4, 0), (4, 4), (0, 4)], (1, 1, 3, 2)) == [(3, 1), (3, 2), (1, 2), (1, 1)]
    assert ds._clip_rect([(0, 0), (1, 0), (1, 1), (0, 1)], (5, 5, 6, 6)) == []


# ---------------------------------------------------------------- elevations and sections

def test_a_view_shows_what_is_beyond_its_plane_and_hatches_what_it_cuts():
    square = [(0, 0), (2, 0), (2, 1), (0, 1)]
    boxes = [{'kind': 'object', 'tag': 'far', 'corners': [(x, y + 5) for x, y in square], 'z0': 0, 'z1': 1},
             {'kind': 'object', 'tag': 'behind', 'corners': [(x, y - 5) for x, y in square], 'z0': 0, 'z1': 1},
             {'kind': 'wall', 'tag': 'cut', 'corners': [(x + 3, y * 4 - 2) for x, y in square], 'z0': 0, 'z1': 2.5}]
    shapes = ds.view_shapes(boxes, (0, 1), 0, cut=True)
    assert [s['tag'] for s in shapes] == ['far', 'cut', 'cut'], 'far to near, then the cut face; nothing from behind the viewer'
    face = shapes[-1]
    assert face['cut'] and (face['u0'], face['u1'], face['z0'], face['z1']) == (3, 5, 0, 2.5)
    assert [s['tag'] for s in ds.view_shapes(boxes, (0, -1), 0, cut=False)] == ['behind', 'cut'], 'the other way sees the other side'
    # looking along +x, right is plan -y: a box at y 5..6 sits at u -6..-5
    side = ds.view_shapes(boxes[:1], (1, 0), -1, cut=False)[0]
    assert (side['u0'], side['u1']) == (-6, -5)
    diamond = [{'kind': 'object', 'tag': 'd', 'corners': [(0, 1), (1, 2), (0, 3), (-1, 2)], 'z0': 0, 'z1': 1}]
    assert ds.view_shapes(diamond, (0, 1), 0, cut=False)[0]['edge'] == 0, 'the near corner of a turned box is drawn'


def test_the_cut_plane_is_the_one_of_nine_through_the_most_elements():
    def box(tag, y):
        return {'kind': 'object', 'tag': tag, 'corners': [(0, y), (1, y), (1, y + .5), (0, y + .5)], 'z0': 0, 'z1': 1}
    boxes = [box('a', 2.8), box('b', 6.6), box('c', 6.8), box('d', 7.3)]
    assert ds.pick_cut(boxes, (0, 1), 0, 10) == pytest.approx(7), 'the plane at 7 passes through b and c; the plane at 3 through a alone'
    assert ds.pick_cut(boxes[:1], (0, 1), 0, 10) == pytest.approx(3)
    assert ds.pick_cut([box('e', 7.2)], (0, 1), 0, 10) == 5, 'nine planes, not every plane: a box between two of them is missed, and the middle is used'
    assert ds.pick_cut([], (0, 1), 0, 10) == 5, 'with nothing to cut, the middle'


def test_a_turned_box_does_not_hide_what_stands_in_front_of_it():
    # Looking up the plan. The big diamond's nearest corner is nearer than the small box, but where the small box
    # stands, the diamond's face is behind it.
    diamond = {'kind': 'object', 'tag': 'O1', 'corners': [(0, 1), (2, 3), (0, 5), (-2, 3)], 'z0': 0, 'z1': 3}
    small = {'kind': 'object', 'tag': 'O2', 'corners': [(-1.9, 2.0), (-1.6, 2.0), (-1.6, 2.2), (-1.9, 2.2)], 'z0': 0, 'z1': 1}
    for boxes in ([diamond, small], [small, diamond]):
        report = {}; shapes = ds.view_shapes(boxes, (0, 1), 0, cut=False, report=report)
        assert [s['tag'] for s in shapes] == ['O1', 'O2'] and report['exact'], 'the diamond is painted first, the box over it'
        assert shapes[1]['seen'] == (pytest.approx(-1.9), pytest.approx(-1.6), 0, 1)
    behind = dict(small, tag='O3', corners=[(x, y + 4) for x, y in small['corners']])   # the same box moved to behind the diamond
    shapes = ds.view_shapes([behind, diamond], (0, 1), 0, cut=False)
    assert [s['tag'] for s in shapes] == ['O3', 'O1'] and shapes[0]['seen'] is None, 'now it is painted first and nothing of it shows'
    assert ds.view_shapes([diamond, dict(small, z0=3, z1=4)], (0, 1), 0, cut=False)[0]['seen'] is not None, 'a box above another hides nothing'


def test_boxes_too_many_or_tangled_to_order_are_said_to_be(monkeypatch):
    a = {'kind': 'object', 'tag': 'O1', 'corners': [(0, 1), (2, 1), (2, 2), (0, 2)], 'z0': 0, 'z1': 1}
    b = {'kind': 'object', 'tag': 'O2', 'corners': [(1, 3), (3, 3), (3, 4), (1, 4)], 'z0': 0, 'z1': 1}
    report = {}; ds.view_shapes([a, b], (0, 1), 0, cut=False, report=report)
    assert report['exact']
    monkeypatch.setattr(ds, 'ORDER_CHECKS', 0)
    shapes = ds.view_shapes([a, b], (0, 1), 0, cut=False, report=report)
    assert not report['exact'] and [s['tag'] for s in shapes] == ['O2', 'O1'], 'past the budget: nearest point in front'
    sheets, _ = sheets_of(scene())
    assert 'nearest point is drawn in front' in ' '.join(sheets['A-201'].texts()), 'and the sheet says its order is the rough one'


def test_a_hidden_element_is_not_tagged_on_the_sheet_that_hides_it():
    data = scene()
    data['walls'].append({'name': 'wall_3', 'label': 'wall', 'provenance': 'observed', 'centre': [2, FLOOR_Y + 1.25, 1.0], 'size': [2, 2.5, .1], 'yaw_degrees': 0})
    data['objects'].append({'name': 'object_3', 'label': 'object', 'kind': 'separated', 'provenance': 'observed', 'centre': [2, FLOOR_Y + .2, .5],
                            'size': [.6, .4, .3], 'yaw_degrees': 0})   # between the new wall and the far wall
    sheets, _ = sheets_of(data)
    assert {'O3', 'W3'} <= set(tag_boxes(sheets['A-101'], r'[WO]\d+')), 'the plan shows and tags both'
    front = sheets['A-201']   # looking to plan top from the centre: wall 3 stands in front of object 3
    tags = set(tag_boxes(front, r'[WO]\d+'))
    assert 'W3' in tags and 'W1' in tags, 'the wall in front, and the wider wall that shows past it'
    assert 'O3' not in tags, 'a tag never points at something the sheet does not show'
    assert '1 element(s) beyond the plane are hidden behind nearer ones' in ' '.join(front.texts())
    assert 'hidden behind nearer ones' not in ' '.join(sheets_of(scene())[0]['A-201'].texts())


def test_a_box_sunk_below_the_floor_stays_on_the_sheet():
    data = scene()
    data['objects'].append({'name': 'object_3', 'label': 'object', 'kind': 'separated', 'provenance': 'observed', 'centre': [1, FLOOR_Y - 2, 2],
                            'size': [1, 6, 1], 'yaw_degrees': 0})   # 5 m below the floor estimate to 1 m above
    sheets, facts = sheets_of(data)
    assert facts['depthBelowFloorMetres'] == 5 and facts['heightAboveFloorMetres'] == 2.5
    assert sheets_of(scene())[1]['depthBelowFloorMetres'] == 0
    for number in ('A-201', 'A-202', 'A-203', 'A-204', 'A-301', 'A-302'):
        sheet = sheets[number]
        points = [p for op in sheet.ops if op[0] == 'poly' and op[4] for p in op[1]]   # everything filled: the boxes, not the sheet frame
        assert points and all(ds.AREA[0] <= x <= ds.AREA[2] and ds.AREA[1] <= y <= ds.AREA[3] for x, y in points), f'{number} draws inside its drawing area'
        assert '-5.00' in sheet.texts() and 'reach 5.00 m below the floor estimate' in ' '.join(sheet.texts())
    tall = max((max(p[1] for p in poly) - min(p[1] for p in poly) for poly in filled(sheets['A-203'], ds.PALE) if len(poly) == 4))   # the view that looks its way
    assert tall == pytest.approx(6 * 1000 / facts['viewScale']), 'the whole 6 m of it, to scale'


def test_elevations_and_sections_are_to_one_scale_with_heights_from_the_floor():
    sheets, facts = sheets_of(scene())
    views = [sheets[n] for n in ('A-201', 'A-202', 'A-203', 'A-204', 'A-301', 'A-302')]
    assert {v.scale for v in views} == {facts['viewScale']} and facts['heightAboveFloorMetres'] == 2.5
    mm = 1000 / facts['viewScale']
    right = sheets['A-202']    # looking to plan right from the centre: the 3 m wall is face-on, the 4 m wall end-on
    walls = sorted((max(p[0] for p in w) - min(p[0] for p in w), max(p[1] for p in w) - min(p[1] for p in w)) for w in filled(right, ds.WHITE) if len(w) == 4)
    assert (3 * mm, 2.4 * mm) in [(pytest.approx(w, abs=.01), pytest.approx(h, abs=.01)) for w, h in walls]
    texts = right.texts()
    assert '+0.00' in texts and '+2.50' in texts and '2.50' in texts and 'W2' in texts
    assert 'No roof, ceiling or floor slab is modelled.' in ' '.join(texts)
    assert texts.count('W1') <= 1 and texts.count('W2') == 1, 'an element is tagged once on a sheet'
    section = sheets['A-301']
    assert 'Hatched: cut by the section plane' in ' '.join(section.texts())
    assert set(facts['sectionPlanesSheetMetres']) == {'A-A', 'B-B'}
    cut = [op for op in section.ops if op[0] == 'poly' and op[4] == ds.LIGHT]
    assert cut, 'section A-A cuts at least one element of this room'


# ---------------------------------------------------------------- schedules

def test_schedules_say_what_quantities_csv_says(tmp_path):
    data = scene(); totals = ce.export(data, tmp_path)['quantities']
    sheets, facts = sheets_of(data)
    walls, register, quantities = (sheets[n].texts() for n in ('Q-401', 'Q-403', 'Q-404'))
    assert facts['counts'] == {'walls': 2, 'openings': 0, 'objects': 2, 'unknownCells': 2}
    assert all(t in walls for t in ('W1', 'W2', '4.00', '3.00', '2.50', '2.40', '0.10', '10.00', '7.20', '2 walls', f"{totals['wall_length_m']:.2f}", f"{totals['wall_face_area_m2']:.2f}"))
    assert all(t in register for t in ('O1', 'sofa', 'IfcFurniture', '2.00', '0.90', '0.80', '1.80', 'no', 'O2', 'Unnamed object', '-'))
    assert 'EfficientDet-Lite2 (COCO) on the worker' in register, 'where a name came from'
    for key in ('floor_extent_area_m2', 'point_covered_footprint_area_m2', 'unknown_area_m2', 'wall_length_m', 'wall_face_area_m2'):
        assert f'{totals[key]:.2f}' in quantities, key
    assert '4.00 x 3.00' in quantities and 'Not a measured floor area.' in ' '.join(quantities)


def test_a_long_schedule_continues_on_further_sheets_with_one_total():
    many = scene()
    many['walls'] = [{'name': f'wall_{n}', 'label': 'wall', 'provenance': 'observed', 'centre': [n * .5, many['floor_y'] + 1.2, 0], 'size': [.4, 2.4, .1], 'yaw_degrees': 90}
                     for n in range(1, 81)]
    sheets, _ = sheets_of(many)
    pages = [n for n in sheets if n.startswith('Q-401')]
    assert pages == ['Q-401.1', 'Q-401.2', 'Q-401.3'] and sheets['Q-401.2'].title == 'Wall schedule (2 of 3)'
    tags = [t for n in pages for t in sheets[n].texts() if re.fullmatch(r'W\d+', t)]
    assert tags == [f'W{n}' for n in range(1, 81)], 'every wall once, in order'
    assert ['80 walls' in sheets[n].texts() for n in pages] == [False, False, True]
    cover = sheets['G-001'].texts()
    assert all(n in cover for n in pages) and 'sheet 1 of 14' in cover


# ---------------------------------------------------------------- what every sheet says

def test_every_sheet_says_the_dimensions_are_unverified():
    sheets, _ = sheets_of(scene(), name='Authored room')
    assert len(sheets) == 12
    for sheet in sheets.values():
        texts = sheet.texts()
        assert 'FOR REVIEW - DIMENSIONS UNVERIFIED' in texts and 'Authored room' in texts, sheet.number
        assert 'Scale set from one entered distance of 2.5 m. Not verified.' in texts, sheet.number
    cover = ' '.join(sheets['G-001'].texts())
    assert 'Nobody has checked them against the building.' in cover and 'pipework or steelwork' in cover


@pytest.mark.parametrize('scale,start', [
    ({'source': 'user-measured', 'distance': 3.2}, 'Scale set from one entered distance of 3.2 m'),
    ({'source': 'user-measured'}, 'Scale set from one entered distance'),
    ({'source': 'model-metric-estimate', 'verified': True}, 'Scale estimated by the reconstruction model'),
    ({'source': 'scan-file'}, 'Scale taken from the scan file as declared'),
    ({'source': 'something new'}, 'Scale source: something new'),
    ({}, 'Scale source not recorded'), (None, 'Scale source not recorded')])
def test_the_scale_sentence_never_says_the_scale_was_checked(scale, start):
    sentence = ds.scale_sentence({'scale': scale})
    assert sentence == start + '. Not verified.'


def test_text_is_measured_fitted_and_wrapped():
    assert ds.text_width('W12', 2.4, 'CB') == pytest.approx(3 * .6 * 2.4), 'Courier is fixed width'
    assert ds.text_width('il', 10) < ds.text_width('MW', 10)
    short = ds.fit_text('assumed 0.1 m: thickness unresolved by the capture', 2.5, 'H', 30)
    assert short.endswith('...') and ds.text_width(short, 2.5, 'H') <= 30
    lines = ds.wrap('one two three four five six seven eight nine ten', 2.6, 'H', 30)
    assert len(lines) > 1 and all(ds.text_width(line, 2.6, 'H') <= 30 for line in lines) and ' '.join(lines).split() == 'one two three four five six seven eight nine ten'.split()
    assert ds.pick_scale(12, 9, 300, 200) == 50 and ds.pick_scale(40, 9, 300, 200) == 150 and ds.pick_scale(9000, 1, 300, 200) == 30000


def test_the_svg_preview_carries_the_same_text():
    sheets, _ = sheets_of(scene())
    svg = ds.to_svg(sheets['A-101'])
    assert svg.startswith('<svg') and 'viewBox="0 0 420 297"' in svg and '>W1<' in svg and '>A-101<' in svg
    assert '&amp;' in ds.to_svg(sheets_of(scene(), name='Smith & Sons')[0]['G-001'])


# ---------------------------------------------------------------- found in review

def test_quantities_are_counted_in_the_scan_frame_however_the_plan_is_turned():
    data = scene()
    for wall in data['walls']:
        wall['yaw_degrees'] += 25   # the walls turn; the floor extent and the unknown cells stay square to the scan
    sheets, facts = sheets_of(data)
    assert abs(facts['planTurnDegrees']) == pytest.approx(25, abs=1e-6), 'the plan is turned, so the drawn cells are no longer square to the sheet'
    totals = ce.quantities(data, ce.elements(data))[1]
    texts = sheets['Q-404'].texts()
    for label, key in (('Point-covered footprint', 'point_covered_footprint_area_m2'), ('Unknown space', 'unknown_area_m2'),
                       ('Floor bounding extent area', 'floor_extent_area_m2'), ('Wall length', 'wall_length_m'), ('Wall face area', 'wall_face_area_m2')):
        assert texts[texts.index(label) + 1] == f'{totals[key]:.2f}', f'{label} is the figure quantities.csv gives'
    assert totals['point_covered_footprint_area_m2'] == pytest.approx(11.625, abs=.01), 'the half cell outside the extent is still left out'


def index_lines(sheet, numbers):
    return [op for op in sheet.ops if op[0] == 'text' and op[4] == 'CB' and op[2] in numbers]


def test_a_long_set_keeps_its_index_clear_of_the_note():
    many = scene()
    many['walls'] = [{'name': f'wall_{n}', 'label': 'wall', 'provenance': 'observed', 'centre': [2 + (n % 40) * .3, FLOOR_Y + 1.2, (n // 40) * .5],
                      'size': [.25, 2.4, .1], 'yaw_degrees': 0} for n in range(1, 701)]
    sheets, _ = ds.build_sheets(many)
    numbers = [s.number for s in sheets]
    assert len(set(numbers)) == len(numbers) == 32, 'more sheets than the short index holds'
    cover = sheets[0]
    assert sorted(op[2] for op in index_lines(cover, numbers)) == sorted(numbers), 'every sheet is listed once'
    note = next(op[1] for op in cover.ops if op[0] == 'poly' and op[4] == ds.PALE)
    edge = min(x for x, _ in note)
    assert all(op[1][0] + 100 + ds.text_width('1:1000', 2.6, 'C') < edge for op in index_lines(cover, numbers)), 'no index line reaches the read-this-first note'
    assert all(op[1][1] < ds.AREA[3] - 14 for op in index_lines(cover, numbers)), 'or the source lines at the foot'
    assert ds.write_pdf(sheets, 'long').count(b'/Type /Page ') == len(sheets)


def test_an_index_too_long_for_the_cover_continues_on_its_own_sheets():
    # No scene the compiler accepts is this long (its component bound gives at most a few dozen sheets); the cover is built directly.
    meta = {'name': 'Long', 'scale_note': 'Scale estimated.', 'source': 'a' * 64, 'scene': 'b' * 64, 'revision': 0}
    counts = {'walls': 0, 'openings': 0, 'objects': 0, 'unknownCells': 0}
    rest = [ds.Sheet(f'Q-401.{n}', f'Wall schedule ({n} of 200)') for n in range(1, 201)]
    index = ds._cover(meta, rest, counts)
    assert [s.number for s in index] == ['G-001', 'G-002', 'G-003'], '201 sheets and the two the index adds: 54 on the cover, 108 on each further sheet'
    numbers = [s.number for s in index + rest]
    listed = [op[2] for s in index for op in index_lines(s, numbers)]
    assert sorted(listed) == sorted(numbers), 'every sheet, the index sheets among them, is listed once'
    assert 'The index continues on G-002 to G-003.' in index[0].texts()
    assert all(ds.AREA[0] <= op[1][0] and op[1][0] + 112 <= ds.AREA[2] and op[1][1] <= ds.AREA[3] for s in index[1:] for op in index_lines(s, numbers))
    assert [s.number for s in ds._cover(meta, rest[:10], counts)] == ['G-001'] and [s.number for s in ds._cover(meta, rest[:53], counts)] == ['G-001']
    assert [s.number for s in ds._cover(meta, rest[:54], counts)] == ['G-001', 'G-002']


def test_a_title_beyond_ascii_reads_back_in_the_document_information(tmp_path):
    pypdf = pytest.importorskip('pypdf')
    name = 'Projet \u20ac \u2014 \u201c\u00c9tage\u201d'
    ds.write_drawing_set(scene(), tmp_path, name=name)
    reader = pypdf.PdfReader(tmp_path / ds.PDF_NAME)
    assert reader.metadata.title == f'{name} - drawing set'
    assert name in reader.pages[0].extract_text(), 'and on the sheet'
    ds.write_drawing_set(scene(), tmp_path, name='Plain room')
    assert b'/Title (Plain room - drawing set)' in (tmp_path / ds.PDF_NAME).read_bytes(), 'an ASCII title stays readable in the file'


def test_a_scene_that_can_no_longer_be_drawn_withdraws_the_old_set(tmp_path):
    target = tmp_path / ds.PDF_NAME; preview = tmp_path / 'drawing-A-101.svg'; other = tmp_path / 'scene-plan.dxf'
    def fresh():
        assert ds.write_drawing_set(scene(), tmp_path)['written'] and target.is_file()
        preview.write_text('<svg/>'); other.write_text('kept')
    fresh()
    assert ds.write_drawing_set(scene(units='unscaled'), tmp_path)['written'] is False
    assert not target.exists() and not preview.exists() and other.read_text() == 'kept', 'only the set is withdrawn'
    fresh()
    empty = scene(); empty['walls'] = []; empty['objects'] = [o for o in empty['objects'] if o['name'] == 'floor_observed']
    with pytest.raises(ValueError):
        ds.write_drawing_set(empty, tmp_path)
    assert not target.exists() and not preview.exists() and other.read_text() == 'kept'

