"""Actual Python Ed25519 signatures verified by native browser WebCrypto.

Synthetic report evidence only; no model, physical capture, or robot executes.
Fixture private keys live only in a temporary directory and never enter browser
arguments, output receipts, or logs. The embedded public key is never trusted by
default. Set WORLD_REPORT_PYTHON only when the crypto and browser SDK environments
are separate; CI can use the same interpreter for both.
"""
from __future__ import annotations

import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world/report-receipt'

# Use the production signer, not a JavaScript signature stub. Both keys are
# created per invocation; the second key models an untrusted embedded signer.
SIGN_FIXTURES = r'''
import json,pathlib,platform,sys
import cryptography
from robotics.world_worker.report_receipts import ReportSigner,init_key,make_payload,verify_receipt
root=pathlib.Path(sys.argv[1]); fixture=json.load(sys.stdin)
result={'python':platform.python_version(),'cryptography':cryptography.__version__,'signers':[]}
for index in range(2):
    path=root/f'fixture-{index}.key'
    init_key(path,root/f'fixture-{index}-public.json')
    signer=ReportSigner(path); key=signer.public_key(); receipts=[]
    for item in fixture:
        evidence={'authority':'worker-verified-bytes','sources':item['sources'],'artifacts':item['job']['artifacts']}
        payload=make_payload(key['keyId'],'interop-fixture',item['job'],evidence,
                             item['request']['scenarioSha256'],item['request']['geometrySha256'])
        envelope=signer.sign(payload)
        verify_receipt(envelope,key,item['scenarioText'].encode('utf-8'))
        receipts.append(envelope)
    result['signers'].append({'key':key,'receipts':receipts})
print(json.dumps(result,separators=(',',':')))
'''

PREPARE = r'''async () => {
  const {proofPack,sampleWorld}=await import('/world/core.mjs');
  const {prepareReportRequest}=await import('/world/report-receipts.mjs');
  const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
  const sourceText='Explicit synthetic source fixture — café / 測量';
  const artifactText=JSON.stringify({schema:'interop-fixture',model_executed:false});
  const source={id:'b'.repeat(32),kind:'image',size:new TextEncoder().encode(sourceText).length,sha256:await sha(sourceText)};
  const job={id:'a'.repeat(32),engine:'inspect',status:'complete',upload_ids:[source.id],artifacts:[{name:'capture-integrity.json',kind:'integrity',size:new TextEncoder().encode(artifactText).length,sha256:await sha(artifactText)}]};
  const fixtures=[];
  for(const world of [sampleWorld(),null]) {
    const proof=await proofPack(world,null,{},[{name:'synthetic-café.png',kind:'image',size:source.size}], [{type:'interop-fixture',detail:{note:'測量 — no physical source'}}]);
    const scenarioText=JSON.stringify(proof,null,2);
    fixtures.push({scenarioText,job,sources:[source],request:await prepareReportRequest(scenarioText,job)});
  }
  return fixtures;
}'''

VERIFY = r'''async ({fixtures,signed}) => {
  const api=await import('/world/report-receipts.mjs');
  const copy=value=>JSON.parse(JSON.stringify(value));
  const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
  const trusted=signed.signers[0],untrusted=signed.signers[1];
  const trust={kind:'public-key',value:trusted.key.publicKey};
  const fingerprint={kind:'fingerprint',value:trusted.key.keyId};
  const passes=[],rejections=[];
  async function reject(name,run) {
    try { await run(); } catch(error) { rejections.push(name);return; }
    throw new Error('Accepted invalid signed report: '+name);
  }
  for(let index=0;index<fixtures.length;index++) {
    const fixture=fixtures[index],receipt=trusted.receipts[index],suffix=index?'null-map':'map';
    const args={scenarioText:fixture.scenarioText,receipt,key:trusted.key,trust,expectedJob:fixture.job};
    const verified=await api.verifySignedReport(args);
    const pinned=await api.verifySignedReport({...args,trust:fingerprint});
    if(verified.verified!==true||pinned.verified!==true||verified.keyId!==trusted.key.keyId)throw new Error('Valid Python signature was not verified');
    const bundle=api.createSignedReportBundle(fixture.scenarioText,receipt,trusted.key);
    const text=JSON.stringify(bundle),parsed=api.parseSignedReportBundle(text);
    if(parsed.scenarioText!==fixture.scenarioText||parsed.receipt.payloadText!==receipt.payloadText)throw new Error('Offline bundle changed signed bytes');
    if((await api.verifySignedReportBundle(text,trust)).verified!==true||
       (await api.verifySignedReportBundle(text,fingerprint)).verified!==true)throw new Error('Offline signature was not verified');
    passes.push(suffix+': Python signature, pinned key, pinned fingerprint, exact-byte offline roundtrip');
    await reject(suffix+': no explicit trust',()=>api.verifySignedReport({...args,trust:undefined}));
    await reject(suffix+': embedded public key alone',()=>api.verifySignedReportBundle(text,undefined));
    await reject(suffix+': wrong trusted key',()=>api.verifySignedReport({...args,trust:{kind:'public-key',value:untrusted.key.publicKey}}));
    await reject(suffix+': wrong trusted fingerprint',()=>api.verifySignedReport({...args,trust:{kind:'fingerprint',value:untrusted.key.keyId}}));
    const attacker=api.createSignedReportBundle(fixture.scenarioText,untrusted.receipts[index],untrusted.key);
    await reject(suffix+': replaced signer and embedded key',()=>api.verifySignedReportBundle(JSON.stringify(attacker),trust));
    await reject(suffix+': scenario whitespace changed',()=>api.verifySignedReport({...args,scenarioText:fixture.scenarioText+'\n'}));
    await reject(suffix+': expected job changed',()=>api.verifySignedReport({...args,expectedJob:{...fixture.job,id:'c'.repeat(32)}}));
    const tampered=copy(receipt),payload=JSON.parse(tampered.payloadText);payload.ownerId='altered-fixture';
    tampered.payloadText=JSON.stringify(payload);tampered.payloadSha256=await sha(tampered.payloadText);
    await reject(suffix+': payload changed with recomputed hash',()=>api.verifySignedReport({...args,receipt:tampered}));
    const alteredSignature=copy(receipt);alteredSignature.signature=(receipt.signature[0]==='A'?'B':'A')+receipt.signature.slice(1);
    await reject(suffix+': signature changed',()=>api.verifySignedReport({...args,receipt:alteredSignature}));
    for(const [name,patch] of [['short signature',{signature:'AA'}],['noncanonical signature',{signature:receipt.signature+'='}],['wrong payload hash',{payloadSha256:'0'.repeat(64)}],['unknown envelope field',{unexpected:true}]]) {
      await reject(suffix+': '+name,()=>api.verifySignedReport({...args,receipt:{...receipt,...patch}}));
    }
    await reject(suffix+': malformed public key',()=>api.verifySignedReport({...args,key:{...trusted.key,publicKey:'AA'}}));
    await reject(suffix+': malformed bundle',()=>api.verifySignedReportBundle('{',trust));
    const before=JSON.parse(fixture.scenarioText),after=JSON.parse(parsed.scenarioText);
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Verification changed scenario evidence');
    const claims=JSON.parse(receipt.payloadText);
    if(['metricVerified','policyExecuted','safetyCertified','independentHostAttestation'].some(k=>claims[k]!==false))throw new Error('Fixture gained authority');
  }
  return {passes,rejections,keyId:trusted.key.keyId,realEd25519:true,embeddedKeyAutoTrusted:false,modelExecuted:false,physicalCaptureUsed:false};
}'''


def check(browser, url):
    context = browser.new_context()
    try:
        page = context.new_page()
        page.set_default_timeout(15000)
        errors = []
        requests = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        page.goto(url)
        fixtures = page.evaluate(PREPARE)
        assert len(fixtures) == 2
        assert fixtures[0]['request']['geometrySha256'] is not None
        assert fixtures[1]['request']['geometrySha256'] is None
        with tempfile.TemporaryDirectory(prefix='world-report-interop-') as directory:
            result = subprocess.run(
                [os.environ.get('WORLD_REPORT_PYTHON', sys.executable), '-c', SIGN_FIXTURES, directory],
                input=json.dumps(fixtures), text=True, capture_output=True, cwd=ROOT,
                timeout=20, check=True,
            )
            signed = json.loads(result.stdout)
            receipt = page.evaluate(VERIFY, {'fixtures': fixtures, 'signed': signed})
        assert not errors, errors
        assert len(receipt['passes']) == 2 and len(receipt['rejections']) == 30
        assert all(request.startswith(url.rsplit('/', 1)[0] + '/') for request in requests), requests
        receipt.update(browser=browser.browser_type.name, python=signed['python'],
                       cryptography=signed['cryptography'], pageErrors=errors,
                       privateKeyPersisted=False)
        (OUTPUT / f'{browser.browser_type.name}-receipt.json').write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt), flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            if self.path == '/interop.html':
                body = b'<!doctype html><meta charset="utf-8"><title>Explicit signed report fixture</title>'
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

    handler = functools.partial(QuietHandler, directory=str(ROOT / 'brainsnn-r3f-app/public'))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            for name in os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(','):
                executable = os.environ.get('PLAYWRIGHT_' + name.upper() + '_PATH')
                browser = getattr(playwright, name).launch(headless=True, **({'executable_path': executable} if executable else {}))
                try:
                    check(browser, f'http://127.0.0.1:{server.server_port}/interop.html')
                finally:
                    browser.close()
    finally:
        server.shutdown()
        server.server_close()
