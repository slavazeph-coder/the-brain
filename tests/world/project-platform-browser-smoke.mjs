// Real HTTP/PostgreSQL handlers + browser. Synthetic source/trial records exercise
// the product workflow; these tests do not qualify physical robot performance.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startProjectPlatformFixture} from './project-platform-server.mjs';

const require=createRequire(new URL('../../brainsnn-r3f-app/package.json',import.meta.url));
const {chromium}=require('playwright');
const executable=process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const output=process.env.WORLD_PROJECTS_SMOKE_OUT || join(tmpdir(),'brainsnn-project-platform-smoke');
await mkdir(output,{recursive:true});
const fixture=await startProjectPlatformFixture();
const errors=[];
let browser,context,page;
const title='Hotel · ground-floor deployment';
const hostile='Door width <img src=x onerror="window.untrustedMarkupRan=true">';
const key=role=>fixture.credentials[role].token;
const notice=copy=>page.waitForFunction(value=>document.querySelector('#projects-notice')?.textContent.includes(value),copy);
const section=async name=>{await page.locator(`#project-tabs [data-section="${name}"]`).click();};
const connect=async role=>{
  await page.locator('#project-api-key').fill(key(role));
  await page.locator('#connect-form').getByRole('button',{name:'Connect',exact:true}).click();
  await notice(`Connected as Fixture ${role}`);
  assert.equal(await page.locator('#project-api-key').inputValue(),'');
};
async function noOverflow(target=page) {
  const size=await target.evaluate(()=>({width:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  assert.ok(size.html<=size.width+1&&size.body<=size.width+1,`Horizontal overflow: ${JSON.stringify(size)}`);
}
async function noStoredKeys(target=page) {
  const stored=await target.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
  for(const role of ['admin','editor','reviewer','reader'])assert.ok(!stored.includes(key(role)));
  assert.ok(!target.url().includes(key('editor')));
}
async function fillRevision(name,kind,parent='',extraSourceId='') {
  const form=page.locator('#revision-form');
  await form.locator('[name=label]').fill(name);await form.locator('[name=kind]').selectOption(kind);
  if(parent)await form.locator('[name=parent_revision_id]').selectOption(parent);
  await form.locator('[name=robot_model]').fill('Fixture mobile cleaner');
  await form.locator('[name=width_m]').fill('0.6');await form.locator('[name=margin_m]').fill('0.1');
  await form.locator('[name=task_kind]').fill('navigation');await form.locator('[name=task_goal]').fill('Dock to service corridor');
  await form.locator('[name=source_ids]').first().check();
  if(extraSourceId)await form.locator(`[name=source_ids][value="${extraSourceId}"]`).check();
  await form.getByRole('button',{name:'Save immutable revision'}).click();
  await notice('Immutable revision saved.');
}
async function recordTrial(kind,outcome,revisionId) {
  const form=page.locator('#trial-form');
  await form.locator('[name=kind]').selectOption(kind);await form.locator('[name=revision_id]').selectOption(revisionId);
  assert.equal(await form.locator('[name=robot_model]').inputValue(),'Fixture mobile cleaner');assert.equal(await form.locator('[name=task]').inputValue(),'Dock to service corridor');
  await form.locator('[name=prediction]').selectOption('pass');await form.locator('[name=outcome]').selectOption(outcome);
  await form.locator('[data-trial-time-now]').click();await form.locator('[name=notes]').fill('Synthetic test record for browser workflow validation; not a real robot test.');
  await form.locator('[name=source_ids]').first().check();
  if(kind==='physical')await form.locator('[name=measurement_evidence_ids]').first().check();
  await form.getByRole('button',{name:'Save reported trial'}).click();await notice('Trial saved');
}

async function resumableSources(projectId) {
  const headers={Authorization:`Bearer ${key('editor')}`};
  const endpoint=`${fixture.url}/api/world/v1/projects/${projectId}`;
  const read=async suffix=>{const response=await fetch(endpoint+suffix,{headers});assert.ok(response.ok,await response.clone().text());return response.json();};
  const capture=Buffer.alloc(4*1024*1024+128*1024);for(let i=0;i<capture.length;i++)capture[i]=i%251;
  const file={name:'authored-capture.bin',mimeType:'application/octet-stream',buffer:capture};
  const sha256=createHash('sha256').update(capture).digest('hex');
  const parts=[];page.on('request',request=>{if(request.method()==='PUT'&&request.url().includes('/source-uploads/'))parts.push(request.url());});
  const part2=`**/projects/${projectId}/source-uploads/*/parts/2`;
  await page.route(part2,route=>route.abort('failed'));
  await page.locator('#source-form [name=source_file]').setInputFiles(file);
  await page.locator('#source-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#transfer-heading')?.textContent==='Upload interrupted');
  await page.locator('[data-refresh-uploads]').click();await notice('Upload records refreshed');
  await page.unroute(part2);
  const initial=(await read('/source-uploads')).uploads;assert.equal(initial.length,1);
  const upload=initial[0];assert.equal(upload.uploaded_bytes,4*1024*1024);assert.equal(upload.sha256,sha256);
  assert.equal(upload.parts.filter(part=>part.status==='stored').length,1);
  assert.equal((await read('')).project.sources.length,1,'An interrupted upload must not appear as retained evidence.');
  await noStoredKeys();await noOverflow();
  await page.setViewportSize({width:390,height:844});await noOverflow();
  await page.screenshot({path:join(output,'projects-upload-recovery-phone.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:960});

  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#project-api-key').inputValue(),'');
  await connect('editor');await section('sources');
  const row=()=>page.locator(`[data-upload-id="${upload.id}"]`);
  assert.ok(await row().isVisible());
  const changed=Buffer.from(capture);changed[changed.length-1]^=1;
  await row().locator('[name=resume_file]').setInputFiles({...file,buffer:changed});
  await row().getByRole('button',{name:'Resume with this file'}).click();await notice('Reselect the exact original file');
  assert.equal(parts.length,2,'A same-name, same-size file with a different full digest cannot upload any parts.');
  await row().locator('[name=resume_file]').setInputFiles(file);

  // A different editor changes the project after transfer but before retention.
  // This must preserve completed parts and require an explicit reviewed retry.
  const originalGet=fixture.objectStore.get;let changedDuringVerification=false;
  fixture.objectStore.get=async (...args)=>{
    if(!changedDuringVerification){
      changedDuringVerification=true;
      const current=(await read('')).project;
      const result=await fetch(endpoint+'/sources',{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':'browser_upload_concurrent_0001'},body:JSON.stringify({expected_version:current.version,name:'upload-concurrent.txt',media_type:'text/plain',content_text:'A concurrent editor changed this project during capture verification.'})});
      assert.ok(result.ok,await result.text());
    }
    return originalGet(...args);
  };
  await row().getByRole('button',{name:'Resume with this file'}).click();await notice('Reload the project');
  fixture.objectStore.get=originalGet;assert.equal(changedDuringVerification,true);
  const ready=(await read(`/source-uploads/${upload.id}`)).upload;assert.equal(ready.status,'ready');
  assert.equal((await read('')).project.sources.some(source=>source.sha256===sha256),false);
  await page.locator('#refresh-project').click();await notice('Latest project record loaded.');
  await row().getByRole('button',{name:'Retain completed file'}).click();await notice('Exact source bytes retained in workspace object storage.');
  const retained=(await read('')).project.sources.find(source=>source.sha256===sha256);assert.ok(retained);
  assert.equal(retained.storage_kind,'object');assert.equal(retained.bytes,capture.length);
  assert.equal(parts.filter(url=>url.includes(`/${upload.id}/parts/1`)).length,1,'A stored first part must not be resent after reload.');
  assert.equal((await read('/source-uploads')).uploads.length,0);
  const sourceRow=page.locator(`[data-source-id="${retained.id}"]`);
  assert.ok((await sourceRow.innerText()).includes('Workspace object storage'));
  assert.ok((await page.locator('#project-panel').innerText()).includes('Inline project database'));

  // Exercise the explicit bounded fallback, rather than invoking an OS picker in CI.
  await page.evaluate(()=>Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined}));
  const downloaded=page.waitForEvent('download');
  await sourceRow.getByRole('button',{name:'Download original bytes'}).click();
  const artifact=await downloaded;await notice('Their full size and SHA-256 were verified.');
  const downloadedBytes=await readFile(await artifact.path());
  assert.equal(downloadedBytes.length,capture.length);assert.equal(createHash('sha256').update(downloadedBytes).digest('hex'),sha256);

  // Pause from the visible control, then explicitly cancel temporary parts.
  let releasePart;const held=new Promise(resolve=>{releasePart=resolve;});
  await page.route(part2,async route=>{await held;await route.abort('failed').catch(()=>{});});
  const waitingPart=page.waitForRequest(request=>request.method()==='PUT'&&request.url().endsWith('/parts/2'));
  await page.locator('#source-form [name=source_file]').setInputFiles({...file,name:'cancelled-capture.bin'});
  await page.locator('#source-form button[type=submit]').click();await waitingPart;
  await page.locator('[data-transfer-action=pause]').click();await notice('Upload paused.');releasePart();
  await page.locator('[data-refresh-uploads]').click();await notice('Upload records refreshed');await page.unroute(part2);
  const pending=(await read('/source-uploads')).uploads;assert.equal(pending.length,1);
  await page.locator(`[data-upload-id="${pending[0].id}"]`).getByRole('button',{name:'Cancel upload',exact:true}).click();await notice('Upload cancelled.');
  assert.equal((await read(`/source-uploads/${pending[0].id}`)).upload.status,'aborted');
  assert.equal((await read('/source-uploads')).uploads.length,0);
  assert.equal((await read('')).project.sources.some(source=>source.name==='cancelled-capture.bin'),false);
  await noStoredKeys();await noOverflow();
  await page.screenshot({path:join(output,'projects-storage-desktop.png'),fullPage:true});
  return retained.id;
}

try {
  browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
  context=await browser.newContext({viewport:{width:1280,height:960},reducedMotion:'reduce'});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${fixture.url}/world/projects.html`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#service-state')?.dataset.state==='available');
  assert.equal(await page.locator('#project-content').isVisible(),false);
  await connect('editor');
  await page.locator('#create-project-details summary').click();
  await page.locator('#create-project-form [name=title]').fill(title);
  await page.locator('#create-project-form [name=description]').fill('Source-bound trial and independent change review.');
  await page.locator('#create-project-form button[type=submit]').click();await notice('Project created.');
  assert.equal(await page.locator('#project-title').innerText(),title);
  const projectId=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('project');assert.ok(projectId);

  await section('sources');
  await page.locator('#source-form [name=source_file]').setInputFiles({name:'door-measurement.json',mimeType:'application/json',buffer:Buffer.from('{"measurement_m":1.2,"basis":"synthetic-browser-test"}\n')});
  await page.locator('#source-form button[type=submit]').click();await notice('Exact source bytes retained.');
  assert.ok((await page.locator('#project-panel').innerText()).includes('SHA-256'));
  const captureSourceId=await resumableSources(projectId);

  await section('revisions');await fillRevision('Current service corridor','as_is','',captureSourceId);
  const baseId=await page.locator('#revision-form [name=parent_revision_id] option').nth(1).getAttribute('value');
  await fillRevision('Clearance proposal','proposed',baseId,captureSourceId);
  const proposedId=await page.locator('#revision-form [name=parent_revision_id] option').last().getAttribute('value');
  assert.notEqual(baseId,proposedId);

  await section('evidence');
  const evidence=page.locator('#evidence-form');await evidence.locator('[name=revision_id]').selectOption(proposedId);
  assert.equal(await evidence.locator(`[name=source_id] option[value="${captureSourceId}"]`).count(),1,'Retained object sources remain available to evidence.');
  await evidence.locator('[name=source_id]').selectOption({label:'door-measurement.json'});await evidence.locator('[name=kind]').selectOption('measured');
  await evidence.locator('[name=component_id]').fill('service-door');await evidence.locator('[name=claim]').fill(hostile);
  await evidence.locator('[name=value]').fill('1.2');await evidence.locator('[name=unit]').fill('m');
  await evidence.locator('[name=locator_note]').fill('Synthetic file measurement_m value, not a field measurement.');
  await evidence.locator('[name=uncertainty]').fill('Unqualified synthetic fixture');
  await evidence.getByRole('button',{name:'Add evidence for review'}).click();await notice('Evidence added.');
  assert.equal(await page.locator('.projects-record h4').innerText(),hostile);
  assert.equal(await page.locator('.projects-record img').count(),0);
  assert.equal(await page.evaluate(()=>!!window.untrustedMarkupRan),false);

  await section('changes');
  const change=page.locator('#change-form');await change.locator('[name=title]').fill('Clear rack beside the service door');
  await change.locator('[name=base_revision_id]').selectOption(baseId);await change.locator('[name=proposed_revision_id]').selectOption(proposedId);
  await change.locator('[name=reason]').fill('Check the independent-review workflow.');await change.locator('[name=evidence_ids]').first().check();
  await change.getByRole('button',{name:'Submit for independent review'}).click();await notice('Change submitted.');
  assert.equal(await page.locator('[data-change-decision]').count(),0);
  assert.ok((await page.locator('#project-panel').innerText()).includes('different reviewer'));

  await section('trials');await recordTrial('simulation','pass',proposedId);
  assert.ok((await page.locator('.projects-record').innerText()).includes('Simulation'));
  assert.ok((await page.locator('#project-readiness').innerText()).includes('physical validation and certification are not established'));
  await noStoredKeys();await noOverflow();

  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#project-content').isVisible(),false);
  assert.equal(await page.locator('#project-api-key').inputValue(),'');
  await connect('reviewer');assert.equal(await page.locator('#project-title').innerText(),title);
  await section('evidence');
  await page.locator('[data-evidence-review] [name=reason]').fill('Reviewed the synthetic source value; this is a software test only.');
  await page.locator('[data-evidence-review] button[value=confirmed]').click();await notice('Evidence review recorded.');
  await section('changes');
  await page.locator('[data-change-decision] [name=decision]').selectOption('approve');
  await page.locator('[data-change-decision] [name=reason]').fill('Independent fixture reviewer approves the proposal.');
  await page.locator('[data-change-decision] button[type=submit]').click();await notice('Change decision recorded.');
  await page.locator('[data-change-decision] [name=decision]').selectOption('implemented');
  await page.locator('[data-change-decision] [name=reason]').fill('Implementation is reported for this synthetic test.');
  await page.locator('[data-change-decision] button[type=submit]').click();await notice('Change decision recorded.');
  await section('trials');await recordTrial('physical','pass',proposedId);await recordTrial('physical','fail',proposedId);
  await section('changes');
  assert.equal(await page.locator('[data-change-decision] [name=trial_id] option').count(),1,'A later failure must remove an older pass from verification choices.');
  await section('trials');await recordTrial('physical','pass',proposedId);
  assert.ok((await page.locator('#project-panel').innerText()).includes('Operator reported physical trial'));
  await section('changes');
  await page.locator('[data-change-decision] [name=decision]').selectOption('verified');
  await page.locator('[data-change-decision] [name=trial_id]').selectOption({index:1});
  await page.locator('[data-change-decision] [name=reason]').fill('Record checked against the synthetic passing trial and measured evidence.');
  await page.locator('[data-change-decision] button[type=submit]').click();await notice('Change decision recorded.');
  assert.equal(await page.locator('.projects-record .projects-badge').innerText(),'verified');

  // Mutate through a second client, then prove that the stale UI cannot write.
  const headers={Authorization:`Bearer ${key('admin')}`};
  const before=await (await fetch(`${fixture.url}/api/world/v1/projects/${projectId}`,{headers})).json();
  const concurrent=await fetch(`${fixture.url}/api/world/v1/projects/${projectId}/sources`,{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':'browser_concurrent_change_0001'},body:JSON.stringify({expected_version:before.project.version,name:'concurrent.txt',media_type:'text/plain',content_text:'Another editor saved this source.'})});
  assert.ok(concurrent.ok,await concurrent.text());
  await section('sources');
  await page.locator('#source-form [name=source_file]').setInputFiles({name:'stale.txt',mimeType:'text/plain',buffer:Buffer.from('must be rejected')});
  await page.locator('#source-form button[type=submit]').click();await notice('Reload the project');
  await page.locator('#refresh-project').click();await notice('Latest project record loaded.');
  assert.ok(!(await page.locator('#project-panel').innerText()).includes('stale.txt'));
  await section('overview');await page.screenshot({path:join(output,'projects-desktop.png'),fullPage:true});

  await page.setViewportSize({width:390,height:844});
  for(const tab of ['overview','sources','revisions','evidence','changes','trials','activity']){await section(tab);await noOverflow();}
  await section('evidence');await page.screenshot({path:join(output,'projects-phone.png'),fullPage:true});
  await noStoredKeys();
  const final=await (await fetch(`${fixture.url}/api/world/v1/projects/${projectId}`,{headers})).json();
  assert.equal(final.project.readiness.physical_validated,false);
  assert.equal(final.project.readiness.certified,false);
  assert.equal(final.project.trials.length,4);
  assert.ok(final.project.trials.every(trial=>trial.physical_validated===false));

  await page.locator('#disconnect-button').click();await notice('Disconnected.');
  assert.equal(await page.locator('#project-content').isVisible(),false);await noStoredKeys();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['connect','create','source-bytes','resumable-source-reload','same-name-full-hash-mismatch','stored-part-skipping','retention-version-conflict','verified-authenticated-download','upload-pause-cancel','inline-and-object-storage-labels','immutable-revisions','literal-untrusted-text','independent-review','simulation-versus-physical','reload-restore','trial-verification','stale-version-rejection','390px-no-overflow','credential-memory-only'],screenshots:output}));
} catch(error) {
  if(page&&!page.isClosed())await page.screenshot({path:join(output,'projects-failure.png'),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  // Close in order. Closing the browser while its context is still closing can leave
  // context.close() pending forever, and Node then exits 13 on the unsettled await.
  await context?.close().catch(()=>{});
  await browser?.close().catch(()=>{});
  await fixture.close();
}
