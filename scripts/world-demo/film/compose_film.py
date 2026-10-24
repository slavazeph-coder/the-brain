"""The 4:5 feed film (1080 x 1350, 30 fps) of one real run: site video -> measured model -> dimensioned plan, BIM,
Rhino and a quantity takeoff -> a robot route in the same model.

usage: python compose_film.py <film_dir> <photos_dir> <scene_job_output> <route.json> <out.mp4> [--cut master|commercial|check]
                              [--reconstruction reconstruction.json] [--still SECONDS ...]
film_dir holds the Blender shots from bl_shots.py (shot_points, shot_scene, shot_route, shot_bim); route.json comes from
plan_route.mjs on the same scene.json. The plan is drawn from cad_export.elements() of the job's scene.json (the
geometry of scene-plan.dxf); every number and hash on screen is read from the job's files. --cut commercial leaves the
robot route out; --cut check leaves it out and adds the fit check (shot_check, the job's fit-check.json). Only
high-confidence names are shown. --reconstruction (the source job's reconstruction.json) adds its camera poses, time and video length;
without it those are left out rather than guessed. The IFC card claims validation only when IfcOpenShell is installed
and validates the job's scene.ifc here. Fonts: Inter (/usr/share/fonts/opentype/inter) and DejaVu Sans Mono.
"""
import hashlib, json, math, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ARGS = sys.argv[1:sys.argv.index('--still')] if '--still' in sys.argv else sys.argv[1:]
OPTIONS = {ARGS[k]: ARGS[k + 1] for k in range(len(ARGS) - 1) if ARGS[k] in ('--cut', '--reconstruction')}
POSITIONAL = [x for k, x in enumerate(ARGS) if x not in OPTIONS and (k == 0 or ARGS[k - 1] not in OPTIONS)]
CUT = OPTIONS.get('--cut', 'master')
FILM, PHOTOS, JOB, ROUTE = (Path(x) for x in POSITIONAL[:4]); OUT = POSITIONAL[4]
STILLS = [float(x) for x in sys.argv[sys.argv.index('--still') + 1:]] if '--still' in sys.argv else None
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'robotics' / 'world_worker'))
import cad_export  # noqa: E402

W, H, FPS, MEDIA_Y = 1080, 1350, 30, 196
F = '/usr/share/fonts/opentype/inter/'
def font(name, size): return ImageFont.truetype(F + name, size)
def mono(size, bold=False): return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono' + ('-Bold' if bold else '') + '.ttf', size)
AMBER, CYAN, WHITE, GREY, DIM, STEEL, MAGENTA = (255, 176, 32), (0, 229, 240), (238, 242, 248), (147, 161, 184), (98, 110, 132), (42, 58, 82), (255, 79, 154)

# ---------- the run ----------
scene = json.load(open(JOB / 'scene.json'))
items = cad_export.elements(scene)
evidence = json.load(open(JOB / 'scene-usd.json')); cad = evidence['cad']; Q = cad['quantities']
POINTS = (evidence.get('handoff') or {}).get('points') or (evidence.get('reconstruction') or {}).get('reconstructed_points')
REC = json.load(open(OPTIONS['--reconstruction'])) if '--reconstruction' in OPTIONS else evidence.get('reconstruction')
# Processing time on the worker: the reconstruction job and this scene job (not upload, not the person's review).
PROCESSING = (REC['elapsed_seconds'] + evidence['elapsed_seconds']) if REC and REC.get('elapsed_seconds') and evidence.get('elapsed_seconds') else None
CAPTURE = (REC or {}).get('capture') or {}
NAMING = scene.get('naming') if isinstance(scene.get('naming'), dict) else None
FIT = json.load(open(JOB / 'fit-check.json')) if (JOB / 'fit-check.json').exists() else None
if CUT == 'check' and FIT is None: sys.exit('--cut check needs the job\'s fit-check.json (a scene job with the fit check)')
SHOWN = {o['name'] for o in scene['objects'] if o.get('label') not in (None, 'object', 'floor') and o.get('labelConfidence', 'high') == 'high'}
IFC_COUNTS = {'IfcWall': len(scene.get('walls', [])), 'IfcSlab': sum(o.get('name') == 'floor_observed' for o in scene['objects']),
              'IfcFurniture': sum(o.get('ifcClass') == 'IfcFurniture' for o in scene['objects'])}
def ifc_issues():
    """IfcOpenShell's validation of this job's scene.ifc, EXPRESS rules included, or None when it is not installed here."""
    try:
        import io, logging, ifcopenshell, ifcopenshell.validate
    except ImportError:
        return None
    log = io.StringIO(); logger = logging.getLogger('film-ifc'); logger.addHandler(logging.StreamHandler(log)); logger.setLevel(logging.INFO)
    ifcopenshell.validate.validate(ifcopenshell.open(str(JOB / 'scene.ifc')), logger, express_rules=True)
    return len([line for line in log.getvalue().splitlines() if line.strip()])
IFC_ISSUES = ifc_issues()
SHA = {n: hashlib.sha256((JOB / n).read_bytes()).hexdigest() for n in ('scene.ifc', 'scene.3dm', 'scene-plan.dxf', 'quantities.csv')}
scale = scene['scale']

ROUTE_RUN = json.load(open(ROUTE))
LENGTHS = {'hook': 3.0, 'walk': 2.4, 'points': 2.8, 'model': 3.6, 'check': 4.8, 'plan': 4.4, 'files': 3.6, 'takeoff': 3.2, 'route': 3.8, 'uses': 3.0, 'end': 3.6}
ORDER = ['hook', 'walk', 'points', 'model'] + (['check'] if CUT == 'check' else []) + ['plan', 'files', 'takeoff'] + (['route'] if CUT == 'master' else []) + ['uses', 'end']
SECTIONS, t0 = [], 0.0
for name in ORDER: SECTIONS.append((name, round(t0, 2), round(t0 + LENGTHS[name], 2))); t0 += LENGTHS[name]
STEP = {name: k for k, name in enumerate([n for n in ORDER if n not in ('hook', 'end')], 1)}
TOTAL, XFADE = SECTIONS[-1][2], 8 / FPS

def ease_out(t): t = min(max(t, 0), 1); return 1 - (1 - t) ** 3
def ta(lt, rem): return ease_out(lt / .4) * min(1, max(0, rem / .22))

# ---------- background: steel blueprint with a fine grid ----------
yy, xx = np.mgrid[0:H, 0:W]
r = np.hypot((xx - W / 2) / W, (yy - H * .45) / H)
BG = np.clip(np.stack([12 - 6 * r, 19 - 9 * r, 31 - 14 * r], -1), 0, 255).astype(np.float32)
grid = np.zeros((H, W), np.float32)
grid[::30, :] = .35; grid[:, ::30] = .35; grid[::150, :] = .8; grid[:, ::150] = .8
BG += grid[..., None] * np.array([7, 12, 20], np.float32)
feather = np.ones((1080, 1), np.float32); feather[:90, 0] = np.linspace(0, 1, 90) ** 1.5; feather[-110:, 0] = np.linspace(1, 0, 110) ** 1.5
photos = sorted(p for p in PHOTOS.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.png'))[::4]  # the worker writes .jpg frames
if not photos: sys.exit(f'No .jpg, .jpeg or .png walkthrough photos in {PHOTOS}')
LABELS = {k: v for k, v in json.load(open(FILM / 'shot_scene' / 'labels.json')).items() if k in SHOWN}
CHECK_MARKS = json.load(open(FILM / 'shot_check' / 'labels.json')) if CUT == 'check' else {}
PLAN_SIZE = {o['label']: (o['size'][0], o['size'][2]) for o in scene['objects'] if o.get('label') not in (None, 'object', 'floor')}

def shot(name, i):
    frames = sorted((FILM / f'shot_{name}').glob('*.png'))
    return np.asarray(Image.open(frames[min(len(frames), max(1, i)) - 1]).convert('RGB'), np.float32)
def place(canvas, img, alpha=1.0, dim=1.0):
    a = feather[..., None] * alpha
    region = canvas[MEDIA_Y:MEDIA_Y + 1080]
    img = np.maximum(img * dim, BG[MEDIA_Y:MEDIA_Y + 1080])
    canvas[MEDIA_Y:MEDIA_Y + 1080] = region * (1 - a) + img * a

def text(d, xy, s, f, fill, a=1.0, anchor='la'): d.text(xy, s, font=f, fill=fill + (int(255 * max(0, min(1, a))),), anchor=anchor)
def chip(d, xy, s, f, fg, bg, a=1.0, pad=(14, 8), anchor='mm', outline=None):
    x, y = xy; b = d.textbbox((0, 0), s, font=f); w, h = b[2] - b[0] + 2 * pad[0], b[3] - b[1] + 2 * pad[1]
    x0 = x - w / 2 if anchor == 'mm' else x if anchor == 'lm' else x - w
    d.rounded_rectangle([x0, y - h / 2, x0 + w, y + h / 2], 6, fill=bg + (int(225 * a),), outline=(outline + (int(230 * a),)) if outline else None, width=2)
    d.text((x0 + pad[0], y), s, font=f, fill=fg + (int(255 * a),), anchor='lm')
def header(d, step, title, sub, lt, rem):
    a, dy = ta(lt, rem), 18 * (1 - ease_out(lt / .45))
    text(d, (W / 2, 58), 'BRAINSNN · WORLD BUILDER  /  ' + ('VIDEO TO MODEL' if CUT == 'master' else 'COMMERCIAL WORKFLOW'), mono(19), AMBER, a * .95, 'mm')
    tf = font('InterDisplay-SemiBold.otf', 48); label = f'{step:02d}'
    tw = d.textlength(title, font=tf) + 74; x = W / 2 - tw / 2
    d.rectangle([x, 98 + dy, x + 56, 142 + dy], fill=AMBER + (int(255 * a),))
    text(d, (x + 28, 120 + dy), label, mono(24, True), (12, 16, 24), a, 'mm')
    text(d, (x + 74, 120 + dy), title, tf, WHITE, a, 'lm')
    if sub: text(d, (W / 2, 170 + dy * 1.2), sub, mono(22), GREY, a, 'mm')
def footnote(d, s, a): text(d, (W / 2, H - 40), s, font('Inter-Regular.otf', 20), DIM, a, 'mm')

# ---------- the plan, drawn from the scene's own geometry ----------
pts = [p for i in items if i['kind'] != 'unknown' for p in i['corners']]
X0, X1, Y0, Y1 = min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts)
SS = 2  # supersampled drawing for clean lines
PLAN_BOX = (90, 270, 990, 1060)
S = min((PLAN_BOX[2] - PLAN_BOX[0]) / (X1 - X0), (PLAN_BOX[3] - PLAN_BOX[1]) / (Y1 - Y0)) * .80
CX, CY = (PLAN_BOX[0] + PLAN_BOX[2]) / 2, (PLAN_BOX[1] + PLAN_BOX[3]) / 2
def sp(p): return ((CX + (p[0] - (X0 + X1) / 2) * S) * SS, (CY - (p[1] - (Y0 + Y1) / 2) * S) * SS)
floor = next(i for i in items if i['kind'] == 'floor'); EXT = (floor['length'], floor['width']); fcx = sum(p[0] for p in floor['corners']) / 4; fcy = sum(p[1] for p in floor['corners']) / 4

def partial(d, poly, frac, fill, width):
    """Draw a closed polyline up to frac of its perimeter."""
    segs = list(zip(poly, poly[1:] + poly[:1])); total = sum(math.dist(a, b) for a, b in segs); left = frac * total
    for a, b in segs:
        L = math.dist(a, b)
        if left <= 0: break
        if left >= L: d.line([a, b], fill=fill, width=width)
        else: d.line([a, (a[0] + (b[0] - a[0]) * left / L, a[1] + (b[1] - a[1]) * left / L)], fill=fill, width=width)
        left -= L

def rotated_label(layer, s, f, colour, centre, angle, a):
    img = Image.new('RGBA', (int(f.getlength(s)) + 24, f.size + 18), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((12, 6), s, font=f, fill=colour + (int(255 * a),))
    deg = -math.degrees(angle)
    if deg > 90: deg -= 180
    if deg < -90: deg += 180
    img = img.rotate(deg, expand=True, resample=Image.BICUBIC)
    layer.alpha_composite(img, (int(centre[0] - img.width / 2), int(centre[1] - img.height / 2)))

def plan_layer(lt, a):
    big = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(big)
    al = lambda t: max(0, min(1, t)) * a
    # floor extent
    fpoly = [sp(p) for p in floor['corners']]
    d.polygon(fpoly, fill=(120, 150, 190, int(34 * al(lt / .6))))  # observed floor: the extent, less the unknown cells drawn over it
    partial(d, fpoly, ease_out(lt / .6), GREY + (int(150 * a),), SS)
    # unknown space (hatched)
    ua = al((lt - .9) / .5)
    for i in items:
        if i['kind'] != 'unknown' or ua <= 0: continue
        poly = [sp(p) for p in i['corners']]
        d.polygon(poly, fill=MAGENTA + (int(38 * ua),), outline=MAGENTA + (int(120 * ua),))
        (x0, y0), (x1, y1) = poly[0], poly[2]
        for k in range(1, 4):
            t = k / 4; d.line([(x0 + (x1 - x0) * t, y0), (x0, y0 + (y1 - y0) * t)], fill=MAGENTA + (int(90 * ua),), width=SS)
    # walls (solid, steel) drawing in
    walls = [i for i in items if i['kind'] == 'wall']
    for n, w in enumerate(walls):
        wa = al((lt - .3 - .12 * n) / .35)
        if wa <= 0: continue
        poly = [sp(p) for p in w['corners']]
        d.polygon(poly, fill=STEEL + (int(255 * wa),), outline=WHITE + (int(235 * wa),))
    # objects
    for n, o in enumerate([i for i in items if i['kind'] == 'object']):
        oa = al((lt - .8 - .04 * n) / .3)
        if oa <= 0: continue
        poly = [sp(p) for p in o['corners']]
        colour = CYAN if o['name'] in SHOWN else (167, 139, 250)
        d.polygon(poly, fill=colour + (int(50 * oa),), outline=colour + (int(255 * oa),), width=2 * SS)
    out = big.resize((W, H), Image.LANCZOS)
    # dimensions (drawn at 1x on top, crisp enough with anti-aliased text)
    dd = ImageDraw.Draw(out)
    for n, w in enumerate(walls):
        da = al((lt - 1.4 - .15 * n) / .35)
        if da <= 0: continue
        c = w['corners']; a0 = ((c[0][0] + c[3][0]) / 2, (c[0][1] + c[3][1]) / 2); b0 = ((c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2)
        ang = math.atan2(b0[1] - a0[1], b0[0] - a0[0]); nx, ny = -math.sin(ang), math.cos(ang)
        mid = ((a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2)
        if (mid[0] + nx - fcx) ** 2 + (mid[1] + ny - fcy) ** 2 < (mid[0] - fcx) ** 2 + (mid[1] - fcy) ** 2: nx, ny = -nx, -ny  # outside the room
        off = .42
        A = sp((a0[0] + nx * off, a0[1] + ny * off)); B = sp((b0[0] + nx * off, b0[1] + ny * off))
        A, B = (A[0] / SS, A[1] / SS), (B[0] / SS, B[1] / SS)
        ea, eb = sp(a0), sp(b0)
        dd.line([(ea[0] / SS, ea[1] / SS), A], fill=AMBER + (int(150 * da),), width=1); dd.line([(eb[0] / SS, eb[1] / SS), B], fill=AMBER + (int(150 * da),), width=1)
        dd.line([A, B], fill=AMBER + (int(255 * da),), width=2)
        for P in (A, B):
            tx, ty = math.cos(ang - math.pi / 4) * 7, -math.sin(ang - math.pi / 4) * 7
            dd.line([(P[0] - tx, P[1] - ty), (P[0] + tx, P[1] + ty)], fill=AMBER + (int(255 * da),), width=2)
        M = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
        sang = math.atan2(-(B[1] - A[1]), B[0] - A[0])
        lab = (M[0] + math.cos(sang + math.pi / 2) * 16 * (1 if ny >= 0 else -1), M[1] - math.sin(sang + math.pi / 2) * 16 * (1 if ny >= 0 else -1))
        rotated_label(out, f"{w['length']:.2f} m", mono(19, True), AMBER, lab, sang, da)
    # overall floor dimensions
    oa = al((lt - 2.4) / .4)
    if oa > 0:
        (fx0, fy0), (fx1, fy1) = sp((min(p[0] for p in floor['corners']), max(p[1] for p in floor['corners']))), sp((max(p[0] for p in floor['corners']), min(p[1] for p in floor['corners'])))
        fx0, fy0, fx1, fy1 = fx0 / SS, fy0 / SS, fx1 / SS, fy1 / SS
        dd.line([(fx0, fy0 - 46), (fx1, fy0 - 46)], fill=GREY + (int(200 * oa),), width=1)
        text(dd, ((fx0 + fx1) / 2, fy0 - 62), f"extent {EXT[0]:.2f} m", mono(20, True), GREY, oa, 'mm')
        dd.line([(fx1 + 46, fy0), (fx1 + 46, fy1)], fill=GREY + (int(200 * oa),), width=1)
        rotated_label(out, f"extent {EXT[1]:.2f} m", mono(20, True), GREY, (fx1 + 66, (fy0 + fy1) / 2), math.pi / 2, oa)
    # labels for named objects
    for o in [i for i in items if i['kind'] == 'object' and i['name'] in SHOWN]:
        la = al((lt - 2.0) / .4)
        if la <= 0: continue
        cx = sum(sp(p)[0] for p in o['corners']) / 4 / SS; cy = sum(sp(p)[1] for p in o['corners']) / 4 / SS
        chip(dd, (cx, cy), f"{o['label']}" + (f" {o['length']:.2f}×{o['width']:.2f}" if o['label'] == 'sofa' else ''), mono(17, True), (10, 14, 22), CYAN, la, pad=(8, 5))
    return out

def title_block(d, a):
    x0, y0, x1, y1 = 480, 1095, 1030, 1270
    d.rectangle([x0, y0, x1, y1], outline=GREY + (int(200 * a),), width=2, fill=(10, 16, 27, int(230 * a)))
    rows = [('PROJECT', 'Test room · walkthrough reconstruction'), ('SHEET', 'Plan · scene-plan.dxf'), ('UNITS', 'metres'),
            ('SCALE', f"self-reported ({scale['distance']} m typed)"), ('STATUS', 'MetricVerified false · not a survey')]
    for k, (kk, v) in enumerate(rows):
        y = y0 + 20 + 31 * k
        text(d, (x0 + 16, y), kk, mono(15, True), AMBER, a, 'lm'); text(d, (x0 + 118, y), v, mono(16), WHITE, a, 'lm')
        if k: d.line([(x0, y - 15), (x1, y - 15)], fill=GREY + (int(70 * a),), width=1)

def file_card(d, box, ext, name, lines, sha, a):
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, 10, fill=(14, 22, 36, int(235 * a)), outline=GREY + (int(120 * a),), width=2)
    d.rectangle([x0 + 18, y0 + 18, x0 + 96, y0 + 96], fill=AMBER + (int(255 * a),))
    text(d, (x0 + 57, y0 + 57), ext, mono(24, True), (12, 16, 24), a, 'mm')
    text(d, (x0 + 116, y0 + 36), name, mono(24, True), WHITE, a, 'lm')
    for k, s in enumerate(lines): text(d, (x0 + 116, y0 + 70 + 28 * k), s, font('Inter-Medium.otf', 21), GREY, a, 'lm')
    text(d, (x0 + 18, y1 - 24), f'sha256 {sha[:16]}…', mono(16), DIM, a, 'lm')

# ---------- frames ----------
def draw(i):
    t = i / FPS; canvas = BG.copy(); layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for name, s0, s1 in SECTIONS:
        if not (s0 - XFADE <= t < s1 + (XFADE if name != 'end' else 0)): continue
        fade = 1 if name == 'hook' and t < s0 + XFADE else min(1, (t - s0 + XFADE) / XFADE)
        fade = min(fade, 1 if name == 'end' else min(1, (s1 + XFADE - t) / XFADE))
        lt, rem = t - s0, s1 - t
        if name == 'hook':
            pl = plan_layer(3.4 + lt, fade)  # complete on frame one, which LinkedIn shows as the thumbnail; section 04 draws it in
            layer.alpha_composite(pl)
            a = min(1, rem / .2)
            master = CUT == 'master'
            if CUT == 'check':
                text(d, (W / 2, 92), 'A phone video in.', font('InterDisplay-SemiBold.otf', 62), WHITE, a, 'mm')
                text(d, (W / 2, 162), 'A checked BIM model out.', font('InterDisplay-SemiBold.otf', 62), AMBER, a, 'mm')
                chip(d, (W / 2, H - 150), 'no scanner' + (f' · {PROCESSING / 60:.1f} min on a CPU worker' if PROCESSING else '') + ' · every point checked',
                     mono(22), AMBER, (12, 18, 30), a, outline=AMBER)
            else:
                text(d, (W / 2, 92), 'One site video in.' if master else 'Site video in.', font('InterDisplay-SemiBold.otf', 60 if master else 62), WHITE, a, 'mm')
                text(d, (W / 2, 162), 'Plans, BIM, Rhino, robot routes out.' if master else 'Plans, BIM and Rhino out.', font('InterDisplay-SemiBold.otf', 52 if master else 62), AMBER, a, 'mm')
                chip(d, (W / 2, H - 150), 'real estate · estimating · BIM · robotics' if master else 'for real estate · estimating · facilities', mono(22), AMBER, (12, 18, 30), a, outline=AMBER)
            text(d, (W / 2, H - 96), 'drawn from a real run — every dimension is from the model', font('Inter-Regular.otf', 21), GREY, a, 'mm')
        elif name == 'walk':
            k = min(len(photos) - 1, int(lt * FPS)); ph = Image.open(photos[k]).convert('RGB'); z = 1 + .05 * lt / (s1 - s0)
            cw, ch = 1000, 667; ph = ph.resize((int(cw * z), int(ch * z)), Image.LANCZOS)
            ph = ph.crop(((ph.width - cw) // 2, (ph.height - ch) // 2, (ph.width - cw) // 2 + cw, (ph.height - ch) // 2 + ch))
            card = Image.new('RGBA', (cw, ch)); card.paste(ph)
            m = Image.new('L', (cw, ch), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, cw, ch], 12, fill=int(255 * fade)); card.putalpha(m)
            base = Image.fromarray(canvas.astype(np.uint8)).convert('RGBA'); base.alpha_composite(card, (40, 290)); canvas = np.asarray(base.convert('RGB'), np.float32)
            d.rectangle([40, 290, 1040, 957], outline=AMBER + (int(200 * fade),), width=2)
            for cx, cy in ((40, 290), (1040, 290), (40, 957), (1040, 957)):
                d.line([(cx - 14, cy), (cx + 14, cy)], fill=AMBER + (int(255 * fade),), width=3); d.line([(cx, cy - 14), (cx, cy + 14)], fill=AMBER + (int(255 * fade),), width=3)
            seconds = CAPTURE.get('duration_seconds')
            header(d, STEP['walk'], 'Walk the space with a phone', (f'{seconds:.0f} s video · ' if seconds else '') + 'no scanner · sent to your own worker', lt, rem)
            chip(d, (W / 2, 1010), 'test capture: Mip-NeRF 360 “room” (Barron et al.)', font('Inter-Medium.otf', 21), GREY, (14, 20, 32), fade)
        elif name == 'points':
            place(canvas, shot('points', 1 + int(lt * FPS)), fade)
            poses = f" · {CAPTURE['registered_images']} of {CAPTURE['images']} camera poses" if CAPTURE.get('registered_images') else ''
            header(d, STEP['points'], 'Reconstructed in 3D', f"{int(POINTS * ease_out((lt - .2) / 1.2)):,} points{poses}", lt, rem)
            took = f"{REC['pipeline'].split('-')[0].upper()} on {REC.get('device', 'cpu').upper()} in {REC['elapsed_seconds']:.0f} s · " if REC and REC.get('elapsed_seconds') else ''
            footnote(d, took + '3D shots rendered in Blender from the run’s exported files', ta(lt, rem))
        elif name == 'model':
            fi = 1 + int(lt * FPS); place(canvas, shot('scene', fi), fade)
            header(d, STEP['model'], 'Every wall and object, measured', f"{Q['walls']} walls · {Q['objects']} objects · metres", lt, rem)
            for obj in LABELS.values():
                x, y, depth = obj['screen'][min(fi, len(obj['screen'])) - 1]; la = ease_out((fi - 52) / 12) * fade * min(1, rem / .2)
                if la <= 0 or depth <= 0: continue
                y += MEDIA_Y; L = 70 if obj['label'] == 'sofa' else 50
                d.line([x, y, x, y - L], fill=AMBER + (int(230 * la),), width=2); d.rectangle([x - 5, y - 5, x + 5, y + 5], fill=AMBER + (int(255 * la),))
                dims = f"  {PLAN_SIZE[obj['label']][0]:.2f} × {PLAN_SIZE[obj['label']][1]:.2f} m" if obj['label'] == 'sofa' else ''
                chip(d, (x, y - L - 18), obj['label'] + dims, mono(20, True), (12, 16, 24), AMBER, la, pad=(12, 7))
            footnote(d, (f"Names: {NAMING['model']}, unreviewed · high confidence shown" if NAMING else 'Objects are unnamed in this run') + ' · touching objects stay one', ta(lt, rem))
        elif name == 'check':
            fi = 1 + int(lt * FPS); place(canvas, shot('check', fi), fade)
            header(d, STEP['check'], 'Every point checked against the model', 'fit-check.json · fit-heatmap.ply · model to points', lt, rem)
            sa = ease_out((lt - 2.2) / .5) * min(1, rem / .2)
            kinds = [(k, FIT['by_kind'][k]) for k in ('floor', 'wall', 'object') if k in FIT['by_kind']]
            for k, (kind, v) in enumerate(kinds):
                cx = W / 2 + (k - (len(kinds) - 1) / 2) * 310
                text(d, (cx, H - 214), f"{v['median_cm']:.1f} cm", font('InterDisplay-SemiBold.otf', 46), (0, 220, 160) if v['median_cm'] <= 5 else AMBER, sa, 'mm')
                text(d, (cx, H - 172), {'floor': 'floor', 'wall': 'walls', 'object': 'objects'}[kind] + ' · median', mono(20), GREY, sa, 'mm')
            text(d, (W / 2, H - 120), f"{FIT['within']['5cm'] * 100:.0f}% of {FIT['points']:,} points within 5 cm of a surface", font('Inter-Medium.otf', 24), WHITE, sa, 'mm')
            # the ramp, as the heatmap colours it: green on the surface, yellow at 5 cm, red at 15 cm, grey not modelled
            ra = ease_out((lt - .4) / .5) * min(1, rem / .2); x0, x1, y = 300, 780, 1034
            for x in range(x0, x1):
                c = [(0, 200, 140), (240, 220, 60), (240, 60, 60)]; u = (x - x0) / (x1 - x0) * 2; j = min(1, int(u)); f = u - j
                d.line([(x, y), (x, y + 12)], fill=tuple(round(c[j][q] + (c[j + 1][q] - c[j][q]) * f) for q in range(3)) + (int(255 * ra),))
            d.rectangle([x1 + 26, y, x1 + 50, y + 12], fill=(110, 118, 135, int(255 * ra)))
            for x, lab in ((x0, '0'), ((x0 + x1) / 2, '5 cm'), (x1, '15 cm')): text(d, (x, y + 32), lab, mono(17), GREY, ra, 'mm')
            text(d, (x1 + 38, y + 32), 'not modelled', mono(17), GREY, ra, 'lm')
            for oname, mark in CHECK_MARKS.items():
                if not mark.get('misfit'): continue
                x, yy, depth = mark['screen'][min(fi, len(mark['screen'])) - 1]; ma = ease_out((fi - 80) / 12) * fade * min(1, rem / .2)
                if ma <= 0 or depth <= 0: continue
                yy += MEDIA_Y; element = next(e for e in FIT['elements'] if e['name'] == oname)
                d.line([x, yy, x, yy - 60], fill=MAGENTA + (int(230 * ma),), width=2)
                chip(d, (x, yy - 80), f"flagged for review: {mark['label']} · {element['median_cm']:.1f} cm off", mono(19, True), (12, 16, 24), MAGENTA, ma, pad=(12, 7))
            footnote(d, 'Model to points, not a survey: confirm against a tape or laser measurement before quoting', ta(lt, rem))
        elif name == 'plan':
            layer.alpha_composite(plan_layer(lt, fade))
            header(d, STEP['plan'], 'A dimensioned plan for CAD', 'scene-plan.dxf · layers · walls dimensioned in metres', lt, rem)
            title_block(d, ease_out((lt - 2.6) / .5) * min(1, rem / .2))
        elif name == 'files':
            place(canvas, shot('bim', 1 + int(lt * FPS * .9)), fade, dim=.38)
            header(d, STEP['files'], 'Open files for BIM, Rhino and CAD', 'downloaded from the worker · SHA-256 checked', lt, rem)
            checked = 'IFC4 · open BIM standard' if IFC_ISSUES is None else f"IFC4 · {IFC_ISSUES} IfcOpenShell validation issue{'s' if IFC_ISSUES != 1 else ''}"
            classes = f"IfcWall ×{IFC_COUNTS['IfcWall']} · IfcFurniture ×{IFC_COUNTS['IfcFurniture']}" + (' · IfcSlab' if IFC_COUNTS['IfcSlab'] else '')
            cards = [('IFC', 'scene.ifc', [checked, classes], SHA['scene.ifc']),
                     ('3DM', 'scene.3dm', ['Rhino model · metres', f"{cad['3dm']['objects']} named solids · 4 layers"], SHA['scene.3dm']),
                     ('DXF', 'scene-plan.dxf', ['2D plan · metres', f"{len(cad['dxf']['layers'])} layers · dimensioned"], SHA['scene-plan.dxf']),
                     ('CSV', 'quantities.csv', ['quantity takeoff', f"{Q['rows']} rows · areas and lengths"], SHA['quantities.csv'])]
            for k, (ext, nm, lines, sha) in enumerate(cards):
                ca = ease_out((lt - .35 - .18 * k) / .4) * min(1, rem / .2)
                if ca <= 0: continue
                y0 = 300 + 205 * k + 16 * (1 - ca)
                file_card(d, (70, y0, 1010, y0 + 180), ext, nm, lines, sha, ca)
            footnote(d, 'Rhino file written with McNeel’s open rhino3dm library · not yet opened in Rhino itself', ta(lt, rem))
        elif name == 'takeoff':
            header(d, STEP['takeoff'], 'A quantity takeoff for estimating', 'quantities.csv · from the same model', lt, rem)
            rows = [('Observed floor', f"extent {EXT[0]:.2f} × {EXT[1]:.2f} m", f"{Q['observed_floor_area_m2']:.2f} m²"),
                    ('Walls', f"{Q['walls']} · {Q['wall_length_m']:.2f} m long", f"{Q['wall_face_area_m2']:.2f} m² face"),
                    ('Objects', f"{Q['objects']} separated · {Q['named_objects']} named", 'boxes in m'),
                    ('Unknown space', 'never counted as free', f"{Q['unknown_area_m2']:.2f} m²"),
                    ('Scale', f"user-measured · {scale['distance']} m", 'not verified')]
            d.line([(70, 330), (1010, 330)], fill=AMBER + (int(255 * ta(lt, rem)),), width=3)
            for k, s in enumerate(('ITEM', 'MEASURE', 'QUANTITY')): text(d, ((90, 400, 990)[k], 305), s, mono(18, True), AMBER, ta(lt, rem), 'lm' if k < 2 else 'rm')
            for k, (a_, b_, c_) in enumerate(rows):
                ra = ease_out((lt - .3 - .16 * k) / .35) * min(1, rem / .2); y = 390 + 112 * k
                if ra <= 0: continue
                text(d, (90, y), a_, font('Inter-SemiBold.otf', 30), WHITE, ra, 'lm'); text(d, (400, y), b_, mono(23), GREY, ra, 'lm')
                text(d, (990, y), c_, font('InterDisplay-SemiBold.otf', 34), AMBER if k < 4 else MAGENTA, ra, 'rm')
                d.line([(70, y + 52), (1010, y + 52)], fill=GREY + (int(60 * ra),), width=1)
            footnote(d, 'Observed floor = the extent less unknown cells, not a surveyed room area · verify before quoting', ta(lt, rem))
        elif name == 'route':
            place(canvas, shot('route', 1 + int(lt * FPS)), fade)
            header(d, STEP['route'], 'A robot plans its route in it', 'same model · robot vacuum · conservative planar planner', lt, rem)
            minutes = ROUTE_RUN['travelSeconds'] / 60
            stats = [(f"{ROUTE_RUN['distance'] * ease_out((lt - .6) / 2.6):.1f} m", 'route'), (f'{minutes:.1f} min', 'travel'), (f"{ROUTE_RUN['reachableArea']:.1f} m²", 'reachable')]
            sa = ease_out((lt - .4) / .5) * min(1, rem / .2)
            for k, (v, lab) in enumerate(stats):
                cx = W / 2 + (k - 1) * 300
                text(d, (cx, H - 150), v, font('InterDisplay-SemiBold.otf', 46), CYAN if k == 0 else WHITE, sa, 'mm')
                text(d, (cx, H - 108), lab, mono(20), GREY, sa, 'mm')
            footnote(d, 'Unknown space stays blocked · a person reviews scale and map before any route', ta(lt, rem))
        elif name == 'uses':
            header(d, STEP['uses'], 'Where it fits', 'open files into the tools teams already use', lt, rem)
            uses = [('REAL ESTATE', 'Floor plans and areas', 'DXF plan · quantities'), ('ESTIMATING & RESTORATION', 'Room measurements', 'quantity takeoff · CSV'),
                    ('ARCHITECTURE & BIM', 'As-is model', 'IFC4 · Rhino 3DM'), ('FACILITIES & ROBOTICS', 'Simulation and routes', 'OpenUSD · GLB')]
            for k, (a_, b_, c_) in enumerate(uses):
                ua = ease_out((lt - .25 - .14 * k) / .35) * min(1, rem / .2)
                if ua <= 0: continue
                x0, y0 = (70, 560)[k % 2], 320 + 330 * (k // 2)
                d.rounded_rectangle([x0, y0, x0 + 450, y0 + 290], 10, fill=(14, 22, 36, int(235 * ua)), outline=AMBER + (int(150 * ua),), width=2)
                d.rectangle([x0, y0, x0 + 8, y0 + 290], fill=AMBER + (int(255 * ua),))
                text(d, (x0 + 34, y0 + 50), a_, mono(19, True), AMBER, ua, 'lm'); text(d, (x0 + 34, y0 + 120), b_, font('InterDisplay-SemiBold.otf', 34), WHITE, ua, 'lm')
                text(d, (x0 + 34, y0 + 200), c_, mono(19), GREY, ua, 'lm')
            footnote(d, 'Open formats, not vendor integrations: closed estimating formats need a partner programme', ta(lt, rem))
        elif name == 'end':
            a = ease_out(lt / .5)
            text(d, (W / 2, 470), 'BRAINSNN · WORLD BUILDER', mono(24), AMBER, a, 'mm')
            text(d, (W / 2, 560), 'Walk it. Measure it.', font('InterDisplay-SemiBold.otf', 70), WHITE, a, 'mm')
            text(d, (W / 2, 648), {'master': 'Plan it. Simulate it.', 'check': 'Check it. Hand it to BIM.'}.get(CUT, 'Hand it to BIM and CAD.'), font('InterDisplay-SemiBold.otf', 70), AMBER, ease_out((lt - .25) / .5), 'mm')
            chip(d, (W / 2, 775), 'brainsnn.com · app and API', font('Inter-SemiBold.otf', 30), (12, 16, 24), AMBER, ease_out((lt - .5) / .5), pad=(28, 14))
            notes = [f'Test capture: Mip-NeRF 360 “room” (Barron et al.). The {scale["distance"]} m distance was typed for the demo.',
                     'Measurements are self-reported until checked against a tape or laser: not a survey.',
                     'Every number is from one real run; 3D shots are Blender renders of its exported files.']
            for k, s in enumerate(notes): text(d, (W / 2, 1080 + 38 * k), s, font('Inter-Regular.otf', 21), DIM, ease_out((lt - .8) / .6), 'mm')
    out = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8)).convert('RGBA'); out.alpha_composite(layer)
    return out.convert('RGB')

if STILLS:
    for s in STILLS: draw(int(s * FPS)).save(f'{OUT}_{s:05.2f}.png')
    sys.exit(0)
n = int(TOTAL * FPS)
ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                       '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
for i in range(n):
    ff.stdin.write(draw(i).tobytes())
    if i % 90 == 0: print('frame', i, '/', n, flush=True)
ff.stdin.close(); ff.wait(); print('wrote', OUT)
