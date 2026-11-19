// Real HTTP/PostgreSQL handlers + browser. Synthetic source/trial records exercise
// the product workflow; these tests do not qualify physical robot performance.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
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
async function fillRevision(name,kind,parent='') {
  const form=page.locator('#revision-form');
  await form.locator('[name=label]').fill(name);await form.locator('[name=kind]').selectOption(kind);
  if(parent)await form.locator('[name=parent_revision_id]').selectOption(parent);
  await form.locator('[name=robot_model]').fill('Fixture mobile cleaner');
  await form.locator('[name=width_m]').fill('0.6');await form.locator('[name=margin_m]').fill('0.1');
  await form.locator('[name=task_kind]').fill('navigation');await form.locator('[name=task_goal]').fill('Dock to service corridor');
  await form.locator('[name=source_ids]').first().check();await form.getByRole('button',{name:'Save immutable revision'}).click();
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

  await section('revisions');await fillRevision('Current service corridor','as_is');
  const baseId=await page.locator('#revision-form [name=parent_revision_id] option').nth(1).getAttribute('value');
  await fillRevision('Clearance proposal','proposed',baseId);
  const proposedId=await page.locator('#revision-form [name=parent_revision_id] option').last().getAttribute('value');
  assert.notEqual(baseId,proposedId);

  await section('evidence');
  const evidence=page.locator('#evidence-form');await evidence.locator('[name=revision_id]').selectOption(proposedId);
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
  await section('trials');await recordTrial('physical','fail',proposedId);await recordTrial('physical','pass',proposedId);
  assert.ok((await page.locator('#project-panel').innerText()).includes('Operator-reported physical trial'));
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
  assert.equal(final.project.trials.length,3);
  assert.ok(final.project.trials.every(trial=>trial.physical_validated===false));

  await page.locator('#disconnect-button').click();await notice('Disconnected.');
  assert.equal(await page.locator('#project-content').isVisible(),false);await noStoredKeys();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['connect','create','source-bytes','immutable-revisions','literal-untrusted-text','independent-review','simulation-versus-physical','reload-restore','trial-verification','stale-version-rejection','390px-no-overflow','credential-memory-only'],screenshots:output}));
} finally {await Promise.allSettled([context?.close(),browser?.close(),fixture.close()]);}
