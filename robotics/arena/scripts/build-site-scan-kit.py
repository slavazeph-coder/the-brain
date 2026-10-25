"""Reproducible private scan worker kit and its website setup guide."""
from pathlib import Path
import hashlib
import html
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/site-scan-worker.md"


def inline(value):
    value = html.escape(value)
    value = re.sub(r"`([^`]+)`", r"<code>\1</code>", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", value)
    return re.sub(r"\[([^\]]+)\]\((https://[^\s)]+)\)", r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', value)


def markdown(source):
    output, code, items = [], None, []
    def flush():
        if items:
            output.append("<ul>" + "".join("<li>" + inline(x) + "</li>" for x in items) + "</ul>")
            items.clear()
    for line in source.splitlines():
        if line.startswith("```"):
            flush()
            if code is None:
                code = []
            else:
                output.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>")
                code = None
        elif code is not None:
            code.append(line)
        elif re.match(r"^(?:- |\d+\. )", line):
            items.append(re.sub(r"^(?:- |\d+\. )", "", line))
        else:
            flush()
            if line.startswith("#"):
                mark, title = line.split(" ", 1)
                output.append(f"<h{len(mark)}>" + inline(title) + f"</h{len(mark)}>")
            elif line.strip():
                output.append("<p>" + inline(line) + "</p>")
    flush()
    return "\n".join(output)


files = sorted(p for p in (ROOT / "workers/site_scan").rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc")
files += [DOC, Path(__file__).resolve()]
files += sorted((ROOT / "tests").glob("test_site_scan*.py"))
archive_path = ROOT / "dist/downloads/brainsnn-site-scan-worker.zip"
archive_path.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in files:
        info = zipfile.ZipInfo(path.relative_to(ROOT).as_posix(), (2026, 10, 14, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes())
    info = zipfile.ZipInfo("README.txt", (2026, 10, 14, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, "BrainSNN private site scan worker\nRead docs/site-scan-worker.md first.\nThe kit contains no credentials, customer captures, model weights or GPU software.\n")
style = '*{box-sizing:border-box}body{margin:0;background:#05070b;color:#f4f7fb;font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header,main,footer{max-width:980px;margin:auto;padding:28px}header{display:flex;align-items:center;gap:12px;border-bottom:1px solid #ffffff18}.mark{display:grid;place-items:center;background:linear-gradient(145deg,#68eaff,#947cff);border-radius:10px;width:34px;height:34px;color:#041016;font-weight:950}header a:last-child{margin-left:auto}a{color:#68eaff;text-underline-offset:4px}h1{font-size:clamp(32px,5vw,48px);line-height:1.15;letter-spacing:-.05em;font-weight:600}h2{font-size:24px;letter-spacing:-.03em;margin:40px 0 16px;border-top:1px solid #ffffff18;padding-top:24px}p,li{color:#afbdcf}strong{color:#f4f7fb}code{font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:#d1c7ff;overflow-wrap:anywhere}pre{padding:20px;background:#0b1018;border:1px solid #ffffff18;border-radius:12px;overflow-x:auto}pre code{overflow-wrap:normal}.download{display:inline-flex;min-height:44px;background:#68eaff;color:#041016;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:10px}.notice{border:1px solid #947cff45;background:#947cff0a;padding:18px 22px;border-radius:12px;margin:24px 0}.notice p{margin:0}footer{border-top:1px solid #ffffff16;font-size:12px;color:#afbdcf}a:focus-visible{outline:2px solid #68eaff;outline-offset:5px}@media(max-width:600px){header,main,footer{padding:20px}header strong,header a{font-size:12px}body{font-size:14px}pre{padding:14px}}'
page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BrainSNN · Private site scan worker</title><style>' + style + '</style></head><body><header><span class="mark" aria-hidden="true">B</span><strong>BrainSNN Arena</strong><a href="./#playground?robot=g1&amp;model=groot&amp;task=Supported+reach&amp;seed=42">Back to the arena ↗</a></header><main><a class="download" href="downloads/brainsnn-site-scan-worker.zip" download>Download site scan worker ↓</a><div class="notice"><p><strong>Bring your own compute.</strong> Phone reconstruction needs a configured worker. The resulting visual geometry requires measurement and review before robot simulation.</p></div>' + markdown(DOC.read_text()) + '</main><footer>Private capture storage · Original BrainSNN colours · No GPU reconstruction is claimed from CPU tests</footer></body></html>'
(ROOT / "dist/site-scan-worker.html").write_text(page)
print(json.dumps({"archive": str(archive_path.relative_to(ROOT)), "files": len(files) + 1, "bytes": archive_path.stat().st_size, "sha256": hashlib.sha256(archive_path.read_bytes()).hexdigest()}))
