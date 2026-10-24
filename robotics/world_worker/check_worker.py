"""Checks a deployed World Builder worker the way brainsnn.com will use it, without printing its token.

python -m robotics.world_worker.check_worker --url https://worker.example.com --require scene-usd:video,cloud --upload-probe

The token is read from WORLD_WORKER_TOKEN (or the variable named by --token-env). Exit status 0 means every check
passed. --allow-http is for local testing only: brainsnn.com is served over HTTPS and needs a TLS worker.
"""
import argparse, json, os, ssl, struct, sys, urllib.error, urllib.request, zlib

SITE_ORIGINS = ('https://www.brainsnn.com', 'https://brainsnn.com')
FOREIGN_ORIGIN = 'https://not-brainsnn.example'


def request(url, method='GET', token=None, headers=None, body=None, timeout=20):
    """Returns (status, headers, parsed JSON or None). Network and TLS errors propagate."""
    headers = dict(headers or {})
    if token: headers['Authorization'] = 'Bearer ' + token
    if isinstance(body, (dict, list)): body = json.dumps(body).encode(); headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as res:
            raw, status, got = res.read(), res.status, res.headers
    except urllib.error.HTTPError as err:
        raw, status, got = err.read(), err.code, err.headers
    try: data = json.loads(raw) if raw else None
    except ValueError: data = None
    return status, got, data


def tiny_png():
    def chunk(kind, data): return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = b''.join(b'\x00' + b'\x46\x78\xa0' * 8 for _ in range(8))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 8, 8, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def parse_requirements(values):
    """'scene-usd:video,cloud' -> {'scene-usd': {'video', 'cloud'}}; a bare id requires only the engine."""
    out = {}
    for value in values or []:
        engine, _, kinds = value.partition(':')
        out[engine.strip()] = {k.strip() for k in kinds.split(',') if k.strip()}
    return out


def run_checks(base, token, origin=SITE_ORIGINS[0], requirements=None, upload_probe=False, allow_http=False, call=request):
    base = base.rstrip('/'); results = []
    def check(name, ok, detail=''):
        results.append({'check': name, 'ok': bool(ok), 'detail': detail}); return ok

    https = base.startswith('https://')
    if not check('served over HTTPS', https or allow_http,
                 '' if https else 'http:// allowed for local testing only' if allow_http else 'brainsnn.com is HTTPS, so browsers block an http:// worker'):
        return results
    try:
        status, _, data = call(base + '/healthz')
    except (urllib.error.URLError, OSError) as err:  # TLS, DNS and connection failures land here.
        check('reachable with a valid certificate', False, str(getattr(err, 'reason', err))[:200]); return results
    check('reachable with a valid certificate', True)
    check('/healthz answers', status == 200 and isinstance(data, dict) and data.get('status') == 'ok', f'HTTP {status}')

    status, _, _ = call(base + '/v1/capabilities')
    check('refuses requests without the token', status == 401, f'HTTP {status}')
    status, _, caps = call(base + '/v1/capabilities', token=token)
    if not check('accepts the operator token', status == 200 and isinstance(caps, dict), f'HTTP {status}'): return results
    engines = {e.get('id'): set(e.get('input_kinds') or []) for e in caps.get('engines', []) if e.get('available')}
    check('advertises engines', bool(engines), ', '.join(f"{k} ({'/'.join(sorted(v))})" for k, v in sorted(engines.items())))
    for engine, kinds in (requirements or {}).items():
        missing = kinds - engines.get(engine, set())
        check(f'offers {engine}' + (f" for {', '.join(sorted(kinds))}" if kinds else ''),
              engine in engines and not missing, 'not advertised' if engine not in engines else (f"missing {', '.join(sorted(missing))}" if missing else ''))

    preflight = {'Origin': origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type'}
    status, headers, _ = call(base + '/v1/capabilities', method='OPTIONS', headers=preflight)
    allowed = headers.get('Access-Control-Allow-Origin') if headers else None
    check(f'allows browser calls from {origin}', status in (200, 204) and allowed == origin, f'HTTP {status}, allow-origin {allowed!r}')
    status, headers, _ = call(base + '/v1/capabilities', method='OPTIONS', headers={**preflight, 'Origin': FOREIGN_ORIGIN})
    foreign = headers.get('Access-Control-Allow-Origin') if headers else None
    check('does not allow other origins', foreign not in (FOREIGN_ORIGIN, '*'), f'allow-origin {foreign!r}')

    if upload_probe:
        png = tiny_png()
        status, _, item = call(base + '/v1/uploads', method='POST', token=token, body={'name': 'check-worker.png', 'size': len(png), 'kind': 'image'})
        if check('creates an upload', status == 201 and isinstance(item, dict) and 'id' in item, f'HTTP {status}'):
            status, _, part = call(f"{base}/v1/uploads/{item['id']}?offset=0", method='PUT', token=token, body=png,
                                   headers={'Content-Type': 'application/octet-stream'})
            check('accepts an upload chunk through the proxy', status == 200 and isinstance(part, dict) and part.get('offset') == len(png), f'HTTP {status}')
            status, _, _ = call(f"{base}/v1/uploads/{item['id']}", method='DELETE', token=token)
            check('deletes the probe upload', status in (200, 204), f'HTTP {status}')
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--url', required=True, help='worker base URL, e.g. https://worker.example.com')
    parser.add_argument('--token-env', default='WORLD_WORKER_TOKEN', help='environment variable holding the operator token')
    parser.add_argument('--origin', default=SITE_ORIGINS[0], help='site origin the browser calls from')
    parser.add_argument('--require', action='append', metavar='ENGINE[:KIND,...]', help='an engine (and input kinds) that must be offered')
    parser.add_argument('--upload-probe', action='store_true', help='upload, then delete, a tiny PNG through the proxy')
    parser.add_argument('--allow-http', action='store_true', help='local testing only')
    parser.add_argument('--json', action='store_true', help='print the report as JSON')
    args = parser.parse_args(argv)
    token = os.environ.get(args.token_env, '')
    if not token: parser.error(f'set {args.token_env} to the operator token')
    results = run_checks(args.url, token, args.origin, parse_requirements(args.require), args.upload_probe, args.allow_http)
    passed = all(r['ok'] for r in results)
    if args.json: print(json.dumps({'passed': passed, 'checks': results}, indent=1))
    else:
        for r in results: print(('PASS ' if r['ok'] else 'FAIL ') + r['check'] + (f" — {r['detail']}" if r['detail'] else ''))
        print('All checks passed.' if passed else 'Some checks failed.')
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
