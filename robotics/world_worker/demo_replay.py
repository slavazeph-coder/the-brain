"""Private, source-bound reconstruction replay movies. No live-SLAM claim.

Uses the exact retained rasters/cameras. The final point cloud is shown throughout;
no invented point-arrival times, continuous camera video or physical robot motion.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unicodedata

try:
    from . import camera_frames as cf, measurement_check, object_names
    from .geometry import load_arena_cloud
except ImportError:
    import camera_frames as cf
    import measurement_check, object_names
    from geometry import load_arena_cloud

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = 'brainsnn.demo-replay-request.v1'
HASH = re.compile(r'^[a-f0-9]{64}$')
KINDS = ('phone-video', 'photo-sequence-fixture', 'unknown', 'authored-fixture')
ENDINGS = ('reconstruction', 'bim', 'robot')
FORMATS = {'landscape': (1280, 720, 35), 'social': (1080, 1350, 35), 'short': (1080, 1350, 15)}


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, allow_nan=False, separators=(',', ':'))


def read_json(path, maximum=16 * 1024**2):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise ValueError('Missing or oversized regular evidence file.')
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Duplicate evidence JSON keys.')
            result[key] = value
        return result
    value = json.loads(path.read_text(), object_pairs_hook=pairs)
    canonical(value)
    return value


def text(value, maximum):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum or any(
            unicodedata.category(c).startswith('C') for c in value):
        raise ValueError('Enter bounded plain text without control characters.')
    return value.strip()


def validate_options(value):
    keys = {'schema', 'source_artifact', 'source_sha256', 'title', 'credit', 'capture_kind', 'ending', 'reviewed'}
    if not isinstance(value, dict) or set(value) != keys or len(canonical(value)) > 8192 \
            or value['schema'] != SCHEMA or value['reviewed'] is not True:
        raise ValueError('Explicit review of source frames, attribution and replay limits is required.')
    if value['source_artifact'] not in ('reconstruction.json', 'scene.json') \
            or not isinstance(value['source_sha256'], str) or not HASH.fullmatch(value['source_sha256']):
        raise ValueError('Bind the exact reconstruction or scene artifact.')
    if value['capture_kind'] not in KINDS or value['ending'] not in ENDINGS:
        raise ValueError('Unknown capture kind or ending.')
    if value['ending'] != 'reconstruction' and value['source_artifact'] != 'scene.json':
        raise ValueError('BIM and robot endings require a compiled metric scene.')
    return {**value, 'title': text(value['title'], 80), 'credit': text(value['credit'], 180)}


def file_record(root, name):
    p = cf._path(root, name)
    return {'name': name, 'sha256': sha(p), 'bytes': p.stat().st_size}


def prepare(source_root, reconstruction_root, options):
    """Verify every raster/cloud and reject unrelated or changed scene geometry."""
    import numpy as np
    options = validate_options(options)
    source_root, reconstruction_root = cf._root(source_root), cf._root(reconstruction_root)
    source_file = cf._path(source_root, 'output/' + options['source_artifact'])
    if sha(source_file) != options['source_sha256']:
        raise ValueError('Source artifact changed; reopen and review the current job.')
    record = cf.load_record(reconstruction_root)
    if options['source_artifact']=='reconstruction.json' and sha(source_file)!=sha(reconstruction_root / record['reconstruction']['name']):
        raise ValueError('Selected receipt and reconstruction ledger belong to different runs.')
    reconstruction = read_json(reconstruction_root / record['reconstruction']['name'])
    entries = record['clouds']
    entry = next((c for c in entries if Path(c['name']).name == 'dense-preview.ply'), entries[0])
    rows = object_names._source_cloud_rows(reconstruction_root, entry)
    matrix = np.c_[np.eye(3), [0., 0., 0.]]
    scene, measurements, mesh = None, None, None
    bindings = [{'role': 'source', **file_record(source_root, 'output/' + options['source_artifact'])},
                {'role': 'camera-ledger', **file_record(reconstruction_root, 'output/camera-frames.json')},
                {'role': 'reconstruction', **file_record(reconstruction_root, record['reconstruction']['name'])},
                {'role': 'points', **file_record(reconstruction_root, entry['name'])}]
    if options['source_artifact'] == 'scene.json':
        scene = read_json(source_file)
        cloud = load_arena_cloud(cf._path(source_root, 'output/arena-cloud.json'))
        if scene.get('schema') != 'brainsnn.scene.v1' or scene.get('units') != 'm' or cloud['units'] != 'm' \
                or scene.get('scale') != cloud['scale']:
            raise ValueError('Select a matching compiled metric scene and cloud.')
        if options['ending'] in ('bim','robot') and cloud.get('provenance',{}).get('floorAligned') is not True:
            raise ValueError('The model ending requires recorded floor-alignment evidence. Independent gravity remains unverified.')
        try:
            views = object_names.reconstruction_views(reconstruction_root, cloud)
        except object_names.NamingSkipped as error:
            raise ValueError('Scene and retained camera cloud do not match: '+str(error)) from error
        if not views or any(v.get('binding_status') != 'ordered-source-subset' for v in views):
            raise ValueError('Scene has no bound reconstruction camera evidence.')
        cloud_hashes = {v['source_cloud_sha256'] for v in views}
        entry = next(c for c in record['clouds'] if c['sha256'] in cloud_hashes)
        rows = object_names._source_cloud_rows(reconstruction_root, entry)
        bindings[-1] = {'role': 'points', **file_record(reconstruction_root, entry['name'])}
        if cloud.get('fromSource') is not None:
            matrix = np.asarray(cloud['fromSource'], dtype=float)
        bindings += [{'role': 'scene-cloud', **file_record(source_root, 'output/arena-cloud.json')},
                     {'role': 'scene-model', **file_record(source_root, 'output/scene.glb')}]
        report_file = source_root / 'output/scene-measurements.json'
        worker = read_json(cf._path(source_root,'output/scene-usd.json'))
        bindings.append({'role':'scene-worker',**file_record(source_root,'output/scene-usd.json')})
        if report_file.exists() or report_file.is_symlink():
            measurements = read_json(cf._path(source_root, 'output/scene-measurements.json'))
            expected = measurement_check.build_report(scene, cloud)
            expected['sourceFiles'] = {'scene': {'sha256': sha(source_file)},
                                       'cloud': {'sha256': sha(source_root / 'output/arena-cloud.json')}}
            if canonical(expected) != canonical(measurements):
                raise ValueError('Dimensional report does not match this exact scene and cloud.')
            if worker.get('measurements') != {'written':True,'status':measurements['status'],'metric_verified':False}:
                raise ValueError('Worker dimensional summary does not match the retained report.')
            bindings.append({'role': 'measurements', **file_record(source_root, 'output/scene-measurements.json')})
        elif cloud.get('measurementChecks') is not None or 'measurements' in worker:
            raise ValueError('Declared measurement evidence is missing.')
        if options['ending'] in ('bim', 'robot'):
            mesh = read_mesh(cf._path(source_root, 'output/scene.glb'))
        # These are files produced by this job, not application-import receipts.
        for name in ('scene.ifc', 'scene.3dm', 'scene-plan.dxf', 'quantities.csv', 'object-names.json'):
            if (source_root / 'output' / name).exists():
                bindings.append({'role': 'export', **file_record(source_root, 'output/' + name)})
    frames = []
    for frame in record['frames']:
        image = frame.get('preparedImage', frame['image'])
        timestamp = frame['timestamp']
        match = re.fullmatch(r'image_(\d{4})\.(?:jpg|png)', Path(image['name']).name)
        ordinal = int(match[1]) if match else frame['origin']['sourceIndex']
        pose = np.asarray(frame['cam_from_world'], float)
        centre = -pose[:, :3].T @ pose[:, 3]
        frames.append({'frame_id': frame['frame_id'], 'image': image, 'timestamp': timestamp,
                       'ordinal': ordinal, 'centre': (matrix[:, :3] @ centre + matrix[:, 3]).tolist()})
    timed = len(record['sources']) == 1 and record['sources'][0]['kind'] == 'video' and all(f['timestamp'] is not None for f in frames)
    frames.sort(key=lambda f: f['timestamp']['pts'] * f['timestamp']['timeBase'][0] / f['timestamp']['timeBase'][1] if timed else f['ordinal'])
    if not frames or len({f['ordinal'] for f in frames}) != len(frames) and not timed:
        raise ValueError('Retained frames have no unambiguous replay ordering.')
    if timed:
        stamps = [f['timestamp']['pts'] * f['timestamp']['timeBase'][0] / f['timestamp']['timeBase'][1] for f in frames]
        if any(b <= a for a, b in zip(stamps, stamps[1:])):
            raise ValueError('Source timestamps must be strictly increasing.')
    total = reconstruction.get('capture', {}).get('images', len(frames))
    if type(total) is not int or not len(frames) <= total <= 300:
        raise ValueError('Invalid input/registered-frame denominator.')
    for f in frames:
        if not timed and not 0 <= f['ordinal'] < total:
            raise ValueError('Frame ordinal lies outside the input denominator.')
    if options['capture_kind'] == 'authored-fixture':
        capture_label = 'AUTHORED FIXTURE - NOT A PHONE CAPTURE'
    else:
        capture_label = {'phone-video': 'PHONE CAPTURE (OPERATOR-DECLARED)', 'photo-sequence-fixture': 'PHOTO-SEQUENCE FIXTURE', 'unknown': 'SOURCE TYPE UNVERIFIED'}[options['capture_kind']]
    consistent = reconstruction.get('capture', {}).get('consistency', {}).get('status', 'not-checked')
    partial = len(frames) != total
    warning = 'FOLDED MODEL - RECAPTURE REQUIRED' if consistent == 'folded' else 'PARTIAL RECONSTRUCTION - REVIEW REQUIRED' if partial else 'GEOMETRY AND COVERAGE REQUIRE REVIEW'
    points = rows[:, :3] @ matrix[:, :3].T + matrix[:, 3]
    return {'options': options, 'record': record, 'reconstruction': reconstruction, 'frames': frames, 'total': total,
            'points': points, 'colours': rows[:, 3:], 'scene': scene, 'measurements': measurements, 'mesh': mesh,
            'capture_label': capture_label, 'warning': warning, 'timed': timed, 'bindings': bindings,
            'source_root': source_root, 'reconstruction_root': reconstruction_root}


def read_mesh(path):
    """Only self-contained bounded GLB; load its actual triangles, not proxy boxes."""
    import numpy as np
    import trimesh
    raw = path.read_bytes()
    if len(raw) > 50 * 1024**2 or len(raw) < 20 or raw[:4] != b'glTF':
        raise ValueError('Model must be a bounded self-contained GLB.')
    import struct
    if struct.unpack_from('<II', raw, 4) != (2, len(raw)):
        raise ValueError('Invalid GLB container.')
    length, kind = struct.unpack_from('<II', raw, 12)
    if kind != 0x4E4F534A or length > len(raw) - 20:
        raise ValueError('Invalid GLB JSON chunk.')
    data = json.loads(raw[20:20 + length]); canonical(data)
    def external(v):
        return isinstance(v, dict) and ('uri' in v or any(external(x) for x in v.values())) or isinstance(v, list) and any(external(x) for x in v)
    if external(data) or data.get('extensionsRequired'):
        raise ValueError('External or extension-dependent model resources are not replay inputs.')
    if sum(a.get('count', 0) for a in data.get('accessors', [])) > 1_000_000:
        raise ValueError('GLB accessor budget exceeded.')
    model = trimesh.load(io.BytesIO(raw), file_type='glb', force='scene', process=False)
    triangles, names = [], []
    for node in model.graph.nodes_geometry:
        transform, name = model.graph[node]
        geometry = model.geometry[name]
        p = np.asarray(geometry.vertices) @ transform[:3, :3].T + transform[:3, 3]
        t = p[np.asarray(geometry.faces)]
        if not np.isfinite(t).all() or len(t) + sum(len(a) for a in triangles) > 30_000:
            raise ValueError('Model triangle budget exceeded.')
        triangles.append(t); names.extend([str(node)[:100]] * len(t))
    if not triangles:
        raise ValueError('Compiled model has no renderable triangles.')
    return np.concatenate(triangles), names


def plan_route(bundle, target):
    if bundle['scene'] is None or bundle['reconstruction'].get('capture', {}).get('consistency', {}).get('status') == 'folded':
        raise ValueError('A robot ending requires a metric scene without a detected fold.')
    node = shutil.which('node')
    if not node:
        raise ValueError('Install Node for the existing planar planner, or select another ending.')
    subprocess.run([node, str(ROOT / 'scripts/world-demo/film/plan_route.mjs'),
                    str(bundle['source_root'] / 'output/scene.json'), str(target),
                    str(ROOT / 'brainsnn-r3f-app/public/world')], check=True, timeout=90, capture_output=True)
    route = read_json(target, 4 * 1024**2)
    if route.get('provenance', {}).get('sceneSha256') != sha(bundle['source_root'] / 'output/scene.json') \
            or route['provenance'].get('physicalRobotValidated') is not False or not route.get('route'):
        raise ValueError('The actual planner did not return a source-bound route.')
    return route


def font(size, bold=False):
    from PIL import ImageFont
    path = '/usr/share/fonts/truetype/dejavu/DejaVuSans' + ('-Bold' if bold else '') + '.ttf'
    return ImageFont.truetype(path, size) if Path(path).is_file() else ImageFont.load_default(size=size)


def wrap(draw, value, width, face):
    lines, line = [], ''
    for word in str(value).split():
        attempt = (line + ' ' + word).strip()
        if draw.textlength(attempt, font=face) > width and line:
            lines.append(line); line = word
        else:
            line = attempt
    return lines + ([line] if line else [])


def painter(bundle, width, height, route=None):
    import numpy as np
    from PIL import Image, ImageDraw, ImageOps
    compact = height > width
    margin = 36; header = 134 if compact else 96; bottom = height - (290 if compact else 220)
    centre = np.asarray([f['centre'] for f in bundle['frames']])
    triangles = bundle['mesh'][0] if bundle['mesh'] else None
    cloud = bundle['points']; step = max(1, math.ceil(len(cloud) / 50_000))
    # One fixed overview projection for the entire clip. Points never appear at
    # fabricated capture times; the full retained cloud remains visible.
    angle, pitch = .65, .75
    right = np.array([math.cos(angle), 0., -math.sin(angle)])
    up = np.array([math.sin(angle) * math.sin(pitch), -math.cos(pitch), math.cos(angle) * math.sin(pitch)])
    if bundle['scene'] is not None or bundle['record']['clouds'][0]['coordinate_frame'] == 'right-handed-y-up':
        up *= -1
    basis = np.stack([right, up], axis=1)
    all_xyz = np.concatenate([cloud, centre, triangles.reshape(-1, 3) if triangles is not None else centre])
    projected = all_xyz @ basis
    lo, hi = projected.min(0), projected.max(0)
    factor = min((width - 2 * margin) / max(hi[0] - lo[0], 1e-6), (bottom - header - 35) / max(hi[1] - lo[1], 1e-6))
    mid = (lo + hi) / 2
    def project(p):
        xy = (np.asarray(p) @ basis - mid) * factor
        return np.stack([xy[..., 0] + width / 2, -xy[..., 1] + (header + bottom) / 2], axis=-1)
    point_xy = project(cloud[::step]); camera_xy = project(centre)
    base = Image.new('RGB', (width, height), '#f6f8fa'); draw = ImageDraw.Draw(base)
    for xy, rgb in zip(point_xy, bundle['colours'][::step]):
        draw.ellipse((xy[0] - 1, xy[1] - 1, xy[0] + 1, xy[1] + 1), fill=tuple(int(c) for c in rgb))
    mesh_base = None
    if triangles is not None:
        mesh_base = Image.new('RGB', (width, height), '#f6f8fa'); md = ImageDraw.Draw(mesh_base)
        depths = triangles.mean(1) @ np.cross(right, up)
        txy = project(triangles)
        for i in np.argsort(depths):
            xy = [tuple(p) for p in txy[i]]
            md.polygon(xy, fill='#9bbdc5', outline='#526f78')
    thumbs = []
    inset_w = 360 if compact else 300; inset_h = 214 if compact else 180
    for f in bundle['frames']:
        with Image.open(bundle['reconstruction_root'] / f['image']['name']) as image:
            thumbs.append(ImageOps.contain(image.convert('RGB'), (inset_w, inset_h)))
    large = font(32 if compact else 27, True); normal = font(21 if compact else 18); small = font(18 if compact else 15)
    route_xy = None
    if route is not None:
        floor_y = bundle['scene'].get('floor_y', 0)
        route_xy = project([[p[0] + route['origin'][0], floor_y, p[1] + route['origin'][1]] for p in route['route']])
    def paint(progress):
        end = progress >= .76 and bundle['options']['ending'] != 'reconstruction'
        image = (mesh_base if end else base).copy(); d = ImageDraw.Draw(image)
        current = min(len(bundle['frames']) - 1, int(min(progress / .76, 1) * len(bundle['frames'])))
        if bundle['timed']:
            stamps=[f['timestamp']['pts']*f['timestamp']['timeBase'][0]/f['timestamp']['timeBase'][1] for f in bundle['frames']]
            replay_time=stamps[0]+min(progress/.76,1)*(stamps[-1]-stamps[0])
            current=max(0,int(np.searchsorted(stamps,replay_time,side='right'))-1)
        current_frame = bundle['frames'][current]
        if not end:
            for i in range(1, current + 1):
                a, b = camera_xy[i-1], camera_xy[i]
                if not bundle['timed'] and bundle['frames'][i]['ordinal'] - bundle['frames'][i-1]['ordinal'] > 1:
                    for j in range(0, 12, 2):
                        p = a + (b-a) * j/12; q = a + (b-a) * (j+1)/12
                        d.line([tuple(p), tuple(q)], fill='#d58312', width=3)
                else:
                    d.line([tuple(a), tuple(b)], fill='#d58312', width=4)
            x, y = camera_xy[current]; d.ellipse((x-7,y-7,x+7,y+7), fill='#ffb020', outline='#6e4300', width=2)
            thumb = thumbs[current]; tx = (width-inset_w)//2 if compact else width-inset_w-margin; ty = bottom-inset_h-30 if compact else header+12
            d.rounded_rectangle((tx-8,ty-8,tx+inset_w+8,ty+inset_h+8), radius=8, fill='#0c1b29')
            image.paste(thumb, (tx+(inset_w-thumb.width)//2,ty+(inset_h-thumb.height)//2))
            d.text((tx,ty+inset_h+10),'Selected source frame',font=small,fill='#1a3449')
        elif route_xy is not None:
            n = max(1, int((progress-.76)/.24 * len(route_xy)))
            if n > 1:
                d.line([tuple(p) for p in route_xy[:n]], fill='#00a6c6', width=5)
        d.rectangle((0,0,width,header-12),fill='#091825')
        d.text((margin,17),'BRAINSNN  /  WORLD BUILDER',font=small,fill='#ffb52c')
        title = bundle['options']['title']
        for i, line in enumerate(wrap(d,title,width-2*margin,large)[:2]):
            d.text((margin,45+i*35),line,font=large,fill='white')
        d.rectangle((0,bottom,width,height),fill='#091825')
        label = ('Exported model geometry' if bundle['options']['ending']=='bim' else 'SIMULATED PLANAR ROBOT ROUTE') if end else 'Final reconstruction + camera replay'
        y = bottom+14
        d.text((margin,y),label,font=large,fill='#ffb52c');y+=42
        lines = [f'{len(bundle["frames"])}/{bundle["total"]} frames posed  |  {len(cloud):,} retained points',
                 bundle['warning'],
                 'Scale entered and unverified' if bundle['scene'] else 'Scale unverified - no metric dimensions',
                 'Precomputed replay - not live processing']
        if bundle['measurements']:
            s=bundle['measurements']['summary']; lines[1]=f'Held-out checks: {s["heldOutWithinTolerance"]}/{s["heldOutCount"]} within tolerance; {s["heldOutCount"]-s["heldOutWithinTolerance"]} failed. Point pairs only.'
            # A measurement pass must never hide a partial/folded reconstruction.
            if bundle['warning'] != 'GEOMETRY AND COVERAGE REQUIRE REVIEW':
                lines.insert(1,bundle['warning'])
        if end:
            lines[-1] = 'GLB geometry; native BIM application import not shown' if route is None else 'Automated planner review flags; no physical robot moved'
        else:
            lines[-1] += ' | source PTS retained' if bundle['timed'] else ' | selected-frame order; source time unavailable'
        credit = bundle['capture_label']+' | '+bundle['options']['credit']
        credit_lines = wrap(d,credit,width-2*margin,small)
        available = height-y-22-len(credit_lines)*20
        line_height = 27 if compact else 22
        # Reserve enough space for every evidence line, then the source credit.
        # Landscape uses a smaller evidence font to keep warnings complete.
        evidence_face = normal if compact else small
        wrapped = [line for item in lines for line in wrap(d,item,width-2*margin,evidence_face)]
        if len(wrapped)*line_height > available:
            line_height = max(15, available//max(1,len(wrapped)))
            evidence_face = font(max(12,line_height-3))
            wrapped = [line for item in lines for line in wrap(d,item,width-2*margin,evidence_face)]
        for line in wrapped:
            d.text((margin,y),line,font=evidence_face,fill='#eff4f7');y+=line_height
        # Full attribution also lives in the receipt; never crop it mid-line.
        cy = height-12-len(credit_lines)*20
        for line in credit_lines:
            d.text((margin,cy),line,font=small,fill='#91abbc');cy+=20
        d.rectangle((0,height-4,int(width*progress),height),fill='#ffb52c')
        return image
    return paint


def encode(paint, path, width, height, seconds, *, fps=24):
    binary=shutil.which('ffmpeg')
    if not binary:
        raise ValueError('Install FFmpeg with libx264 before exporting a demo.')
    process=subprocess.Popen([binary,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}',
        '-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-threads','2','-preset','fast','-crf','21',
        '-pix_fmt','yuv420p','-movflags','+faststart','-y',str(path)],stdin=subprocess.PIPE,stderr=subprocess.PIPE)
    timer=threading.Timer(240,process.kill);timer.start()
    count=round(seconds*fps)
    try:
        for index in range(count):
            process.stdin.write(paint(index/max(1,count-1)).tobytes())
        process.stdin.close(); process.stdin=None
        _, error=process.communicate(timeout=10)
        if process.returncode:
            raise RuntimeError('Video encoding failed: '+error[:1500].decode('utf8','replace'))
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill();process.wait()
    return {'name':path.name,'sha256':sha(path),'bytes':path.stat().st_size,'width':width,'height':height,
            'seconds':seconds,'fps':fps,'frames':count,'codec':'H.264','audio':False}


def render(source_root, reconstruction_root, out, options, *, formats=None, fps=24):
    """Render privately, recheck source bytes, publish manifest last."""
    started=time.monotonic(); bundle=prepare(source_root,reconstruction_root,options)
    selected=FORMATS if formats is None else formats
    if not selected or any(k not in FORMATS for k in selected) or type(fps) is not int or not 1<=fps<=30:
        raise ValueError('Use the supported formats and a bounded frame rate.')
    out=Path(out).absolute()
    if out.is_symlink() or out.resolve().is_relative_to(Path(source_root).resolve()) or out.resolve().is_relative_to(Path(reconstruction_root).resolve()):
        raise ValueError('Demo output must be separate from its source jobs.')
    out.mkdir(parents=True,exist_ok=True)
    if any(out.iterdir()):
        raise ValueError('Use a fresh demo output directory.')
    with tempfile.TemporaryDirectory(prefix='demo-replay-',dir=out.parent) as temporary:
        stage=Path(temporary); route=plan_route(bundle,stage/'robot-route.json') if options['ending']=='robot' else None
        outputs=[]
        for name,(width,height,seconds) in selected.items():
            outputs.append(encode(painter(bundle,width,height,route),stage/f'demo-{name}.mp4',width,height,seconds,fps=fps))
        checked=prepare(source_root,reconstruction_root,options)
        if canonical(checked['bindings'])!=canonical(bundle['bindings']) or canonical(checked['frames'])!=canonical(bundle['frames']):
            raise ValueError('Source changed during rendering. No demo was published.')
        receipt={'schema':'brainsnn.demo-replay.v1','options':copy.deepcopy(options),'sources':bundle['bindings'],
            'originalSources':bundle['record']['sources'],'frames':[{k:v for k,v in f.items() if k!='centre'} for f in bundle['frames']],
            'registeredFrames':len(bundle['frames']),'inputFrames':bundle['total'],'retainedPoints':len(bundle['points']),
            'reconstructionWarnings':bundle['reconstruction'].get('warnings',[]),'screeningWarning':bundle['warning'],
            'trajectory':'estimated-capture-camera-path','geometryPlayback':'complete-final-cloud-throughout',
            'timing':'original-source-PTS' if bundle['timed'] else 'selected-frame-order-no-source-time',
            'realtimeProcessing':False,'incrementalGeometryClaimed':False,'metric_verified':False,
            'surveyAccuracyValidated':False,'bimApplicationImportShown':False,'physicalRobotValidated':False,
            'measurementSummary':bundle['measurements']['summary'] if bundle['measurements'] else None,
            'outputs':outputs,'elapsedSeconds':time.monotonic()-started}
        if route is not None:
            receipt['route']={'sha256':sha(stage/'robot-route.json'),'provenance':route['provenance'],
                              'distance':route['distance'],'reachableArea':route['reachableArea']}
            outputs.append({'name':'robot-route.json','sha256':sha(stage/'robot-route.json'),'bytes':(stage/'robot-route.json').stat().st_size})
        (stage/'demo-receipt.json').write_text(json.dumps(receipt,indent=2,allow_nan=False))
        names=[o['name'] for o in outputs]+['demo-receipt.json']
        for name in names:
            shutil.move(stage/name,out/name)
        (out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':n,'kind':'video' if n.endswith('.mp4') else 'evidence'} for n in names]}))
    return receipt


def run(request):
    if request.get('schema')!='brainsnn.adapter.v1' or len(request.get('inputs',[]))!=1 or request['inputs'][0].get('kind')!='replay':
        raise ValueError('Demo export takes one reviewed replay request.')
    options=validate_options(read_json(Path(request['inputs'][0]['path']),8192))
    source=request.get('source') or {}; reconstruction=source.get('reconstruction',source)
    if source.get('missing') or reconstruction.get('missing') or not source.get('path') or not reconstruction.get('path'):
        raise ValueError('The selected job or retained reconstruction is unavailable.')
    return render(source['path'],reconstruction['path'],request['output_dir'],options)


def main():
    parser=argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--input-manifest',type=Path)
    parser.add_argument('--reconstruction',type=Path)
    parser.add_argument('--scene-job',type=Path)
    parser.add_argument('--out',type=Path)
    parser.add_argument('--title',default='Walk the space. Keep the evidence.')
    parser.add_argument('--credit')
    parser.add_argument('--capture-kind',choices=KINDS,default='unknown')
    parser.add_argument('--ending',choices=ENDINGS,default='reconstruction')
    args=parser.parse_args()
    if args.input_manifest:
        result=run(read_json(args.input_manifest))
    else:
        if not args.reconstruction or not args.out or not args.credit:
            parser.error('Provide --reconstruction, --out and --credit, or --input-manifest.')
        root=args.scene_job or args.reconstruction; artifact='scene.json' if args.scene_job else 'reconstruction.json'
        options={'schema':SCHEMA,'source_artifact':artifact,'source_sha256':sha(root/'output'/artifact),
                 'title':args.title,'credit':args.credit,'capture_kind':args.capture_kind,'ending':args.ending,'reviewed':True}
        result=render(root,args.reconstruction,args.out,options)
    print(json.dumps({'videos':[o['name'] for o in result['outputs']],'warning':result['screeningWarning'],
                      'physicalAccuracyValidated':False}))


if __name__=='__main__':
    main()
