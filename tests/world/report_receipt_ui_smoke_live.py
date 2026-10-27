"""Live-server UI smoke: real uvicorn on an ephemeral port, real Ed25519
signing, real browser automation.

Validates that the signed-report UI works against a LIVE HTTP server (not
TestClient): the browser connects to the actual uvicorn socket, creates a
real job via HTTP, runs the inspect engine, and obtains a signed receipt
through the real worker.  This closes the "actual HTTP report UI validation"
gate that was pending.

Browsers must be pre-installed (playwright install chromium webkit).
Set PLAYWRIGHT_BROWSERS_PATH if browsers are not in the default cache.

Run:  python tests/world/report_receipt_ui_smoke_live.py
      (or with WORLD_BROWSERS=chromium|webkit to force a single engine)
"""
import hashlib
import functools
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from robotics.world_worker.app import create_app
from robotics.world_worker.report_receipts import main as receipt_main

PNG = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000d49444154789c636301000004000185a152e1000000004945444e44ae426082')
SCENARIO = b'{"schema":"brainsnn.proof.v1","world":null,"signature":null}'


def receipt_cli(*args):
    """Run the report_receipts CLI subcommand; returns 0 on success."""
    saved = sys.argv
    sys.argv = [sys.argv[0], *args]
    try:
        try:
            receipt_main()
            return 0
        except SystemExit as exc:
            return exc.code or 0
    finally:
        sys.argv = saved


def req(base, method, path, token=None, body=None, content=None):
    data = None
    headers = {}
    if content is not None:
        data = content
        headers['Content-Length'] = str(len(content))
    elif body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def start_live_server(tmp_base, page_origin, worker_port):
    """Start uvicorn on a pre-reserved port with a real Ed25519 signing key.

    CORS is configured via WORLD_ALLOWED_ORIGINS so the browser page (served
    from page_origin, a DIFFERENT reserved port) can fetch() the worker
    cross-origin. worker_port is reserved BEFORE create_app() so we can bake
    the page origin into the allowed list while uvicorn binds that exact
    port — the app's allowed-origin check and the real listener always agree.
    """
    import uvicorn

    keys = Path(tmp_base) / 'keys'
    keys.mkdir(exist_ok=True)
    private = keys / 'report-signing.key'
    public = keys / 'report-signing.pub'

    result = receipt_cli('init-key', '--private-key', str(private), '--public-key', str(public))
    assert result == 0, 'init-key CLI failed'

    token = 'a' * 48
    worker_root = Path(tmp_base) / 'worker'

    # create_app() reads WORLD_ALLOWED_ORIGINS from os.environ directly,
    # so it must be set there (not in a local env dict that is never used).
    saved_origin = os.environ.get('WORLD_ALLOWED_ORIGINS')
    os.environ['WORLD_ALLOWED_ORIGINS'] = page_origin  # e.g. 'http://127.0.0.1:PORT'
    try:
        app = create_app(root=worker_root, token=token, report_key=str(private))
    finally:
        if saved_origin is not None:
            os.environ['WORLD_ALLOWED_ORIGINS'] = saved_origin
        else:
            os.environ.pop('WORLD_ALLOWED_ORIGINS', None)
    config = uvicorn.Config(app, host='127.0.0.1', port=worker_port, log_level='warning')
    server = uvicorn.Server(config)
    server.config = config

    print(f'[live] init-key OK; create_app OK; starting uvicorn on 127.0.0.1:{worker_port}', flush=True)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while not server.started:
        assert time.monotonic() < deadline, 'server did not start'
        time.sleep(0.05)
    sock = server.servers[0].sockets[0]
    port = sock.getsockname()[1]
    print(f'[live] uvicorn up: port {port}, thread alive={thread.is_alive()}', flush=True)
    base = f'http://127.0.0.1:{port}'
    return base, token, keys, worker_root, server


def main():
    browsers = os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(',')
    tmp_base = tempfile.mkdtemp(prefix='wb-ui-smoke-')
    receipt_dir = ROOT / 'output' / 'playwright' / 'world' / 'report-receipt'
    receipt_dir.mkdir(parents=True, exist_ok=True)

    # Reserve BOTH server ports BEFORE the worker app is created. CORS is
    # baked into WORLD_ALLOWED_ORIGINS at create_app() time, so the page
    # origin must be known in advance; the worker port is reserved too so
    # uvicorn binds the exact port it announced (no port drift).
    class _Probe(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    worker_probe = ThreadingHTTPServer(('127.0.0.1', 0), _Probe)
    worker_port = worker_probe.server_port
    worker_probe.server_close()
    page_probe = ThreadingHTTPServer(('127.0.0.1', 0), _Probe)
    page_port = page_probe.server_port
    page_origin = f'http://127.0.0.1:{page_port}'
    page_probe.server_close()

    base, token, keys, worker_root, server = start_live_server(
        tmp_base, page_origin, worker_port)
    # The worker bound the reserved worker_port; the page is served from the
    # separately reserved page_port, whose origin is exactly the one baked
    # into WORLD_ALLOWED_ORIGINS, so the cross-origin fetch() passes CORS.
    print(f'Live worker: {base}  |  token {token[:8]}…  |  CORS origin {page_origin}', flush=True)

    # Upload real PNG bytes over live HTTP.
    status, up = req(base, 'POST', '/v1/uploads', token,
                     {'name': 'smoke.png', 'kind': 'image', 'size': len(PNG)})
    assert status == 201, up
    uid = up['id']
    status, up2 = req(base, 'PUT', '/v1/uploads/%s?offset=0' % uid, token, content=PNG)
    assert status == 200, up2

    # Create + start a real inspect job over live HTTP.
    status, job = req(base, 'POST', '/v1/jobs', token,
                      {'engine': 'inspect', 'upload_ids': [uid], 'consent': True})
    assert status == 201, job
    jid = job['id']
    assert req(base, 'POST', '/v1/jobs/%s/start' % jid, token, {})[0] == 200
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        status, job = req(base, 'GET', '/v1/jobs/%s' % jid, token)
        assert status == 200
        if job['status'] in ('complete', 'failed'):
            break
        time.sleep(0.2)
    assert job['status'] == 'complete', job
    art = job['artifacts'][0]
    print(f'Job complete: {jid}, artifact {art["name"]}', flush=True)

    # Public key document is reachable without auth over live HTTP.
    status, public_doc = req(base, 'GET', '/v1/report-key')
    assert status == 200 and public_doc['keyId'], public_doc

    # Signed receipt over live HTTP (server-side, no browser needed).
    scen_sha = hashlib.sha256(SCENARIO).hexdigest()
    body = {'scenarioSha256': scen_sha, 'geometrySha256': None,
            'artifactRefs': [{'name': art['name'], 'sha256': art['sha256']}]}
    status, receipt_doc = req(base, 'POST', '/v1/jobs/%s/report-receipt' % jid, token, body)
    assert status == 200, (status, receipt_doc)
    receipt_path = keys / 'receipt.json'
    receipt_path.write_text(json.dumps(receipt_doc))
    print(f'Signed receipt obtained: keyId={receipt_doc["keyId"]}', flush=True)

    # Browser journey: real navigation to a page on a real origin, which
    # fetch()es the live worker cross-origin with CORS.
    results = {}
    for browser_name in browsers:
        browser_name = browser_name.strip()
        if not browser_name:
            continue
        print(f'Running browser: {browser_name}', flush=True)
        receipt_file = receipt_dir / f'{browser_name}-live-ui-receipt.json'
        try:
            receipt = run_browser_journey(browser_name, base, token, jid, keys, receipt_dir, page_port)
        except Exception as exc:
            receipt = {'browser': browser_name, 'failed': str(exc)}
            print(f'Browser {browser_name} FAILED: {exc}', flush=True)
        results[browser_name] = receipt
        receipt_file.write_text(json.dumps(receipt, indent=2) + '\n')
        print(f'{browser_name}: {"PASS" if not receipt.get("failed") else "FAIL"}', flush=True)

    server.should_exit = True
    all_pass = all(not r.get('failed') for r in results.values())
    print(f'\n{"ALL PASS" if all_pass else "FAILURES PRESENT"}: '
          f'{len(results)} browser(s)', flush=True)
    return 0 if all_pass else 1


def run_browser_journey(browser_name, base, token, jid, keys, out_dir, page_port):
    """Drive one browser through the full live-server UI journey via real CORS."""
    from playwright.sync_api import sync_playwright

    scenario = keys / 'scenario.json'
    scenario.write_bytes(SCENARIO)

    html = f'''<!DOCTYPE html>
<html>
<head><title>WB Live UI Smoke</title>
<style>body {{ font-family: monospace; padding: 1em; }}</style>
</head>
<body>
<h1>WB Live UI Smoke</h1>
<div id="status">loading…</div>
<div id="job">pending</div>
<div id="receipt">pending</div>
<div id="verify">pending</div>
<script>
const TOKEN = "{token}";
const JOB_ID = "{jid}";
const BASE = "{base}";

async function auth(path, method, body) {{
  const opts = {{
    method: method || 'GET',
    headers: {{ 'Authorization': 'Bearer ' + TOKEN }},
  }};
  if (body) {{
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }}
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  let data;
  try {{ data = JSON.parse(text); }} catch {{ data = {{ detail: text }}; }}
  return {{ status: r.status, data }};
}}

async function main() {{
  const setStatus = (t) => document.getElementById('status').textContent = t;

  // 1. Capabilities — public key discovery
  const caps = await auth('/v1/capabilities');
  if (caps.status !== 200) {{ setStatus('FAIL: capabilities ' + caps.status); return; }}
  const rs = caps.data.reportSigning;
  if (!rs.available) {{ setStatus('FAIL: reportSigning not available'); return; }}
  setStatus('capabilities OK: keyId=' + rs.keyId);

  // 2. Job status
  const job = await auth('/v1/jobs/' + JOB_ID);
  if (job.status !== 200 || job.data.status !== 'complete') {{
    setStatus('FAIL: job ' + job.status + ' ' + JSON.stringify(job.data.status));
    return;
  }}
  document.getElementById('job').textContent = 'job complete: ' + job.data.id;

  // 3. Report receipt
  const art = job.data.artifacts[0];
  const scenSha = "{hashlib.sha256(SCENARIO).hexdigest()}";
  const rr = await auth('/v1/jobs/' + JOB_ID + '/report-receipt', 'POST', {{
    scenarioSha256: scenSha,
    geometrySha256: null,
    artifactRefs: [{{ name: art.name, sha256: art.sha256 }}]
  }});
  if (rr.status !== 200) {{
    setStatus('FAIL: report-receipt ' + rr.status + ' ' + JSON.stringify(rr.data.detail));
    return;
  }}
  document.getElementById('receipt').textContent =
    'receipt OK: keyId=' + rr.data.keyId;
  window.__receipt = rr.data;

  // 4. Verify public key matches
  const pubDoc = await auth('/v1/report-key');
  if (pubDoc.status !== 200) {{ setStatus('FAIL: report-key ' + pubDoc.status); return; }}
  if (pubDoc.data.keyId !== rr.data.keyId) {{
    setStatus('FAIL: keyId mismatch');
    return;
  }}
  document.getElementById('verify').textContent = 'verify OK';
  setStatus('ALL PASS');
}}
main().catch(e => {{
  document.getElementById('status').textContent = 'FAIL: ' + e.message;
}});
</script>
</body>
</html>'''

    page_dir = out_dir / f'{browser_name}-static'
    page_dir.mkdir(exist_ok=True)
    (page_dir / 'smoke.html').write_text(html)

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, format, *args): pass
    # Serve the page on the reserved page_port: the origin of that port is
    # the one baked into WORLD_ALLOWED_ORIGINS at create_app() time, so the
    # page's real origin matches the allowed origin and the cross-origin
    # fetch() to the worker passes CORS. (The worker itself listens on a
    # DIFFERENT reserved port — same-port binding would be EADDRINUSE and
    # still could not serve both.)
    http_server = ThreadingHTTPServer(('127.0.0.1', page_port),
                                      functools.partial(Quiet, directory=str(page_dir)))
    threading.Thread(target=http_server.serve_forever, daemon=True).start()
    page_url = f'http://127.0.0.1:{http_server.server_port}/smoke.html'

    try:
        with sync_playwright() as pw:
            browser = pw.chromium if browser_name == 'chromium' else pw.webkit
            ctx = browser.launch(headless=True)
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(page_url)
            page.wait_for_function(
                "() => document.getElementById('status').textContent.includes('ALL PASS') "
                "|| document.getElementById('status').textContent.includes('FAIL')",
                timeout=30_000)
            status = page.evaluate("() => document.getElementById('status').textContent")
            job_txt = page.evaluate("() => document.getElementById('job').textContent")
            receipt_txt = page.evaluate("() => document.getElementById('receipt').textContent")
            verify_txt = page.evaluate("() => document.getElementById('verify').textContent")
            page.screenshot(path=str(out_dir / f'{browser_name}-live-receipt.png'))
            ctx.close()
    finally:
        http_server.shutdown()

    passed = status == 'ALL PASS' and not errors
    return {
        'browser': browser_name,
        'server': base,
        'status': status,
        'job': job_txt,
        'receipt': receipt_txt,
        'verify': verify_txt,
        'pageErrors': errors,
        'liveHttp': True,
        'realEd25519': True,
        'realPrivateWorker': True,
        'failed': not passed,
    }


if __name__ == '__main__':
    sys.exit(main())
