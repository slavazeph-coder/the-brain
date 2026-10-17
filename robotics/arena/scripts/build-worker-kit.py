"""Build the downloadable worker kit and its documentation page from source."""
from pathlib import Path
import hashlib
import html
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def inline(text):
    escaped = html.escape(text)
    escaped = re.sub(r'`([^`]+)`', r'<code>\1</code>', escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', escaped)
    return re.sub(r'\[([^\]]+)\]\((https://[^\s)]+)\)', r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', escaped)

def markdown(source):
    lines = source.splitlines()
    result, i = [], 0
    while i < len(lines):
        text = lines[i].strip()
        if not text:
            i += 1
            continue
        if text.startswith('```'):
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code.append(lines[i])
                i += 1
            result.append('<pre><code>' + html.escape('\n'.join(code)) + '</code></pre>')
            i += 1
        elif re.match(r'^#{1,6} ', text):
            marker, title = text.split(' ', 1)
            level = min(6, len(marker))
            result.append(f'<h{level}>' + inline(title) + f'</h{level}>')
            i += 1
        elif text.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = [x.strip() for x in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[-: ]+', c) for c in row):
                    rows.append(row)
                i += 1
            result.append('<div class="table-scroll"><table>' + ''.join('<tr>' + ''.join(('<th>' if n == 0 else '<td>') + inline(c) + ('</th>' if n == 0 else '</td>') for c in row) + '</tr>' for n, row in enumerate(rows)) + '</table></div>')
        elif re.match(r'^([-*]|\d+\.) ', text):
            ordered = bool(re.match(r'^\d+\.', text))
            tag = 'ol' if ordered else 'ul'
            items = []
            while i < len(lines) and re.match(r'^([-*]|\d+\.) ', lines[i].strip()):
                items.append(re.sub(r'^([-*]|\d+\.) ', '', lines[i].strip()))
                i += 1
            result.append('<' + tag + '>' + ''.join('<li>' + inline(x) + '</li>' for x in items) + '</' + tag + '>')
        else:
            paragraph = [text]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r'^(#|```|\||[-*] |\d+\. )', lines[i].strip()):
                paragraph.append(lines[i].strip())
                i += 1
            result.append('<p>' + inline(' '.join(paragraph)) + '</p>')
    return '\n'.join(result)

source = ROOT / 'docs/arena-worker.md'
if not source.is_file():
    raise SystemExit('Worker documentation must be complete before packaging.')
files = sorted(p for p in (ROOT / 'workers/arena').rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc')
files += [source, ROOT / 'docs/arena-runtime-protocol.md', ROOT / 'docs/rtx4090-handoff.md', ROOT / 'scripts/probe-worker.py']
files += sorted((ROOT / 'tests').glob('test_arena*.py'))
files += [ROOT / 'docs/arena-inspection.md', ROOT / 'tests/test_inspection_interop.py']
files += sorted(p for directory in ('schemas', 'inspection') for p in (ROOT / directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc')
zip_path = ROOT / 'dist/downloads/brainsnn-arena-worker.zip'
zip_path.parent.mkdir(exist_ok=True, parents=True)
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        info = zipfile.ZipInfo(relative, (2026, 10, 14, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes())
    # Keep the cross-language tests runnable from the extracted kit, without
    # requiring the application checkout on a GPU/inspection host.
    viewer = zipfile.ZipInfo('viewer/arena-recording.js', (2026, 10, 14, 0, 0, 0))
    viewer.compress_type = zipfile.ZIP_DEFLATED
    viewer.external_attr = 0o644 << 16
    archive.writestr(viewer, (ROOT / 'dist/arena-recording.js').read_bytes())
    readme_info = zipfile.ZipInfo('README.txt', (2026, 10, 14, 0, 0, 0))
    readme_info.compress_type = zipfile.ZIP_DEFLATED
    readme_info.external_attr = 0o644 << 16
    archive.writestr(readme_info, 'BrainSNN LIBERO worker kit\nRead docs/arena-worker.md first.\nThe model server and physics worker require separately installed dependencies, model weights and configured credentials. This archive contains no weights or access tokens.\n')
style = '''*{box-sizing:border-box}body{margin:0;background:#05070b;color:#f4f7fb;font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header,main,footer{max-width:1000px;margin:auto;padding:28px}header{display:flex;align-items:center;gap:12px;border-bottom:1px solid #ffffff18}.mark{display:grid;place-items:center;background:linear-gradient(145deg,#68eaff,#947cff);border-radius:10px;width:34px;height:34px;color:#041016;font-weight:950}header a:last-child{margin-left:auto;font-size:13px}a{color:#68eaff;text-underline-offset:4px}header strong{font-size:17px}h1{font-size:clamp(32px,5vw,48px);line-height:1.15;letter-spacing:-.05em;font-weight:600}h2{font-size:24px;letter-spacing:-.03em;margin:42px 0 16px;font-weight:550;border-top:1px solid #ffffff16;padding-top:24px}h3{font-size:18px;margin-top:28px}p,li{color:#afbdcf}strong{color:#f4f7fb}code{font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:#d1c7ff;overflow-wrap:anywhere}pre{padding:20px;background:#0b1018;border:1px solid #ffffff18;border-radius:12px;overflow-x:auto;white-space:pre;line-height:1.7}pre code{overflow-wrap:normal}.download{display:inline-flex;align-items:center;min-height:44px;background:#68eaff;color:#041016;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:10px}.notice{border:1px solid #947cff45;background:#947cff0a;padding:18px 22px;border-radius:12px;margin:24px 0}.notice p{margin:0}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:12px;border-bottom:1px solid #ffffff18;text-align:left;vertical-align:top}th{color:#68eaff}footer{border-top:1px solid #ffffff16;color:#99a6b7;font-size:12px}a:focus-visible{outline:2px solid #68eaff;outline-offset:5px}@media(max-width:600px){header,main,footer{padding:20px}header strong{font-size:14px}header a:last-child{font-size:12px}body{font-size:14px}pre{padding:14px}}'''
body = markdown(source.read_text())
page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BrainSNN · Set up a physics worker</title><style>' + style + '</style></head><body><header><span class="mark" aria-hidden="true">B</span><strong>BrainSNN Arena</strong><a href="./#playground?robot=panda&amp;model=pi05">Back to the arena ↗</a></header><main><a class="download" href="downloads/brainsnn-arena-worker.zip" download>Download worker kit ↓</a><div class="notice"><p><strong>Bring your compute.</strong> This kit provides the Panda + π₀.₅ LIBERO adapter. It does not provision a server or install other robot policies. A real checkpoint run and GPU rendering still need validation on your worker.</p></div>' + body + '</main><footer>Original BrainSNN colours and mark. Worker identity and results are reported by your configured runtime.</footer></body></html>'
(ROOT / 'dist/worker-setup.html').write_text(page)
print(json.dumps({'archive':str(zip_path.relative_to(ROOT)), 'files':len(files)+2, 'bytes':zip_path.stat().st_size, 'sha256':hashlib.sha256(zip_path.read_bytes()).hexdigest(), 'guideBytes':len(page.encode())}))
