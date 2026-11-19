import {createProjectsClient, createIdempotencyKey} from './projects-client.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const MAX_SOURCE_BYTES = 512 * 1024;
const sections = ['overview','sources','revisions','evidence','changes','trials','activity'];
const state = {client:null,me:null,service:null,projects:[],project:null,section:'overview',busy:false,generation:0,requests:new Set(),retry:null,handoff:null};
const actor = () => state.me?.actor || {};
const hasScope = scope => Array.isArray(state.me?.scopes) && state.me.scopes.includes(scope);
const canWrite = () => ['editor','reviewer','admin'].includes(actor().role) && hasScope('project:write');
const canReview = () => ['reviewer','admin'].includes(actor().role) && hasScope('review:decide');
const list = value => Array.isArray(value) ? value : [];
const label = value => String(value ?? '').replaceAll('_',' ').replaceAll('-',' ');
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Not recorded';
const shortId = value => String(value || '').slice(0,8);
const badge = (value,tone='') => `<span class="projects-badge"${tone ? ` data-tone="${esc(tone)}"` : ''}>${esc(label(value))}</span>`;
const title = (heading,copy) => `<div class="projects-panel-heading"><div><h3>${esc(heading)}</h3><p>${esc(copy)}</p></div></div>`;
const empty = (heading,copy) => `<div class="projects-empty-card"><strong>${esc(heading)}</strong>${esc(copy)}</div>`;
const writeFieldset = content => `<fieldset data-write-fields${!canWrite() || state.busy ? ' disabled' : ''}>${content}</fieldset>`;
const revisionName = id => list(state.project?.revisions).find(item => item.id === id)?.label || id || 'Not recorded';
const sourceName = id => list(state.project?.sources).find(item => item.id === id)?.name || id || 'Not recorded';
const refNames = (ids,fn) => list(ids).map(fn).join(', ') || 'None';
const rawDetails = (name,value) => `<details><summary>${esc(name)}</summary><pre>${esc(JSON.stringify(value,null,2))}</pre></details>`;

function notify(message,tone='') {
  $('projects-notice').textContent = message;
  $('projects-notice').dataset.tone = tone;
  $('projects-notice').hidden = !message;
}
function setBusy(value) {
  state.busy=value;
  $('project-workspace').setAttribute('aria-busy',String(value));
  $('connect-button').disabled=value || state.service?.available === false;
  $('refresh-projects').disabled=value || !state.client;
  $('create-project-fields').disabled=value || !canWrite();
  $('save-handoff').disabled=value || !state.project || !canWrite();
  $('refresh-project').disabled=value || !state.project;
  $('export-project').disabled=value || !state.project;
  document.querySelectorAll('[data-write-fields]').forEach(node => {node.disabled=value || !canWrite();});
  document.querySelectorAll('[data-review-fields]').forEach(node => {node.disabled=value || !canReview();});
  document.querySelectorAll('[data-decision-fields]').forEach(node => {node.disabled=value;});
  document.querySelectorAll('[data-project-id],[data-download-source]').forEach(node => {node.disabled=value;});
  $('retry-request').disabled=value;
}
function startRequest() {
  const context={client:state.client,generation:state.generation,controller:new AbortController()};
  state.requests.add(context.controller);
  return context;
}
const isCurrent = context => context.generation === state.generation && !context.controller.signal.aborted;
function endRequest(context) {state.requests.delete(context.controller);}
function clearRetry() {state.retry=null;$('request-retry').hidden=true;}
function showError(error) {
  const requestId=error?.requestId ? ` Request ${error.requestId}.` : '';
  if(error?.status === 409) {clearRetry();notify(`${error.message || 'This project or request has changed.'} Reload the project, review the latest record, and submit your decision again.`+requestId,'warning');}
  else if(error?.status === 401) notify('This API key was not accepted or has expired. Disconnect and use a valid project key.'+requestId,'error');
  else if(error?.status === 403) notify((error.message || 'Your credential cannot perform this action.')+requestId,'error');
  else notify((error?.message || 'The request could not be completed.')+requestId,'error');
}

async function checkService() {
  $('service-state').textContent='Checking service';$('service-state').dataset.state='checking';$('service-retry').hidden=true;
  try {
    const response=await fetch('/api/world/v1/status',{cache:'no-store',credentials:'same-origin'});
    const info=await response.json();
    if(!response.ok || typeof info.available !== 'boolean') throw Error('Saved projects could not be reached.');
    state.service=info;
    $('service-state').textContent=info.available ? 'Saved projects available' : 'Saved projects unavailable';
    $('service-state').dataset.state=info.available ? 'available' : 'unavailable';
    $('service-note').textContent=info.available ? 'Sources and project records are stored by your connected workspace.' : 'The project service is not configured on this deployment. Your World Builder files remain available locally.';
    $('service-retry').hidden=info.available;
  } catch {
    state.service=null;$('service-state').textContent='Service not reached';$('service-state').dataset.state='unavailable';
    $('service-note').textContent='Check the connection or try again. No saved project data has been loaded.';$('service-retry').hidden=false;
  }
  setBusy(state.busy);
}

function requestedProject() {
  const id=new URLSearchParams(location.hash.slice(1)).get('project');
  return id && /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : null;
}
function renderConnection() {
  const connected=!!state.me;
  $('connect-form').hidden=connected;$('connected-identity').hidden=!connected;
  $('connection-heading').textContent=connected ? state.me.tenant?.name || 'Connected workspace' : 'Connect to your workspace';
  $('connection-copy').textContent=connected ? 'Actions are attributed to this credential’s identity. Disconnect to change operator or reviewer.' : 'Use your operator-issued project API key. It stays in this page’s memory; enter it again after a reload.';
  $('actor-name').textContent=actor().name || 'Credential identity';
  $('actor-detail').textContent=connected ? `${label(actor().role)} · ${state.me.tenant?.name || state.me.tenant?.id || 'Workspace'}${state.me.key?.expires_at ? ' · expires '+date(state.me.key.expires_at) : ''}` : '';
  $('create-project-details').hidden=connected && !canWrite();
  if(connected) $('api-details').innerHTML=`<p><strong>Credential identity:</strong> ${esc(actor().name)} · ${esc(actor().role)}<br><strong>Actor ID:</strong> <code>${esc(actor().id)}</code><br><strong>Tenant:</strong> <code>${esc(state.me.tenant?.id)}</code><br><strong>Granted scopes:</strong> ${esc(list(state.me.scopes).join(', ') || 'None')}</p><button type="button" id="load-usage">Load usage</button><div id="usage-result"></div>`;
  else $('api-details').innerHTML='<p>Project requests use <code>/api/world/v1</code>. Connect to see your credential identity and usage.</p>';
  setBusy(state.busy);
}
function renderList() {
  $('project-list').innerHTML=!state.me ? '<p class="projects-empty">Connect to load your saved projects.</p>' : state.projects.length ? state.projects.map(project => `<button type="button" data-project-id="${esc(project.id)}" aria-current="${state.project?.id===project.id}"><strong>${esc(project.title)}</strong><span>Version ${esc(project.version)} · ${esc(date(project.updated_at))}</span></button>`).join('') : '<p class="projects-empty">No projects yet. Create your first site record below.</p>';
  setBusy(state.busy);
}
function acceptProject(project) {
  if(!project?.id) throw Error('The service returned an incomplete project record. Reload before continuing.');
  state.project=project;
  const index=state.projects.findIndex(item => item.id === project.id);
  if(index>=0) state.projects[index]=project; else state.projects.unshift(project);
  history.replaceState(null,'',`#project=${encodeURIComponent(project.id)}`);
  renderList();renderProject();
}
function renderProject() {
  const p=state.project;
  $('project-content').hidden=!p;$('project-empty').hidden=!!p;
  if(!p) { $('project-panel').replaceChildren();$('project-readiness').replaceChildren();$('project-tabs').replaceChildren();for(const id of ['project-title','project-description','project-meta'])$(id).textContent='';setBusy(state.busy);return; }
  $('project-title').textContent=p.title;$('project-description').textContent=p.description || 'No project description.';
  $('project-meta').textContent=`Version ${p.version} · Updated ${date(p.updated_at)} · ${shortId(p.id)}`;
  const readiness=p.readiness || {},counts=readiness.counts || {};
  const names={'needs-evidence':'More evidence needed','review-required':'Review required','trial-recorded':'Trial recorded'};
  const blockers=list(readiness.blockers);
  $('project-readiness').innerHTML=`<div class="projects-readiness"><div class="projects-readiness-head">${badge(names[readiness.state] || 'Readiness not available','warning')}<p>Record completeness only · physical validation and certification are not established</p></div><div class="projects-counts"><div><strong>${esc(counts.sources ?? list(p.sources).length)}</strong><span>Retained sources</span></div><div><strong>${esc(counts.revisions ?? list(p.revisions).length)}</strong><span>Site revisions</span></div><div><strong>${esc(counts.confirmed_measured ?? list(p.evidence).filter(item=>item.kind==='measured'&&item.status==='confirmed').length)}</strong><span>Reviewed measurements</span></div><div><strong>${esc(counts.physical_trials ?? list(p.trials).filter(item=>item.kind==='physical').length)}</strong><span>Reported physical trials</span></div></div>${blockers.length ? `<details class="projects-blockers" open><summary>${blockers.length} item${blockers.length===1?'':'s'} to resolve</summary><ul>${blockers.map(item=>`<li>${esc(item.message || item.code || item)}</li>`).join('')}</ul></details>` : ''}</div>`;
  $('project-tabs').innerHTML=sections.map(section => `<button type="button" data-section="${section}" aria-current="${state.section===section?'page':'false'}">${esc(label(section).replace(/^./,c=>c.toUpperCase()))}</button>`).join('');
  renderPanel();setBusy(state.busy);
}

function revisionOptions({kind,blank=true}={}) {
  return (blank?'<option value="">Choose a revision</option>':'')+list(state.project?.revisions).filter(item=>!kind||item.kind===kind).map(item=>`<option value="${esc(item.id)}">${esc(item.label)} · ${esc(label(item.kind))} · ${esc(shortId(item.id))}</option>`).join('');
}
function sourceOptions() {return '<option value="">Choose retained source</option>'+list(state.project?.sources).map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');}
function checkboxes(name,items,display,selected=[]) {
  return items.length ? `<div class="projects-choice-list">${items.map(item=>`<label><input type="checkbox" name="${esc(name)}" value="${esc(item.id)}"${selected.includes(item.id)?' checked':''}><span>${esc(display(item))}</span></label>`).join('')}</div>` : '<p class="projects-muted">No matching records yet.</p>';
}
function renderOverview() {
  return title('From capture to a decision','Start with source evidence, bind it to a site revision, and review each proposed change before recording what happened in the field.')+`<div class="projects-overview-steps"><button data-section="sources"><span>01</span><span><strong>Retain the source</strong><small>Save exact files up to 512 KiB each, including a bounded map, photo or measurement record.</small></span></button><button data-section="revisions"><span>02</span><span><strong>Describe the site and task</strong><small>Keep as-is and proposed states separate. Bind the robot, task and source files to an immutable revision.</small></span></button><button data-section="evidence"><span>03</span><span><strong>Review the evidence</strong><small>Distinguish measured values, observations and inferences, with a precise location in their source.</small></span></button><button data-section="changes"><span>04</span><span><strong>Decide and compare</strong><small>A separate reviewer decides on changes. Record simulations and physical trials as different kinds of evidence.</small></span></button></div>`;
}
function renderSources() {
  const p=state.project;
  return title('Retained sources','Each upload retains the exact bytes and a server-generated SHA-256. Retention identifies the file; it does not verify measurements or claims inside it.')+
    `<form id="source-form" class="projects-form">${writeFieldset('<h3>Add a source file</h3><label>Choose a file · maximum 512 KiB<input name="source_file" type="file" required></label><p>Use a small image, map, scene manifest, measurement record or trial excerpt. Large videos and full point clouds must be kept in your existing capture workflow.</p><button class="primary" type="submit">Upload and retain exact bytes</button>')}</form>`+
    (list(p.sources).length ? `<div class="projects-records">${p.sources.map(source=>`<article class="projects-record"><div class="projects-record-header"><h4>${esc(source.name)}</h4>${badge('Uploaded bytes retained')}</div><dl><dt>File</dt><dd>${esc(source.media_type)} · ${esc(source.bytes)} bytes</dd><dt>SHA-256</dt><dd><code>${esc(source.sha256)}</code></dd><dt>Retained</dt><dd>${esc(date(source.created_at))}</dd></dl><button type="button" class="small" data-download-source="${esc(source.id)}">Download original bytes</button></article>`).join('')}</div>` : empty('No retained source files','Upload your first source, or send a map snapshot from World Builder.'));
}
function renderRevisions() {
  const p=state.project;
  return title('Immutable site revisions','A new revision preserves its sources, robot and task. A new as-is revision can make earlier change approvals stale; check the current record before proceeding.')+
    `<form id="revision-form" class="projects-form">${writeFieldset(`<h3>Create a revision</h3><div class="projects-form-grid"><label>Revision label<input name="label" required maxlength="160" placeholder="Ground floor · initial survey"></label><label>Site state<select name="kind"><option value="as_is">As-is · current site record</option><option value="proposed">Proposed · planning alternative</option></select></label><label>Parent · required for proposed states<select name="parent_revision_id">${revisionOptions()}</select></label><label>Robot model<input name="robot_model" required maxlength="160" placeholder="Manufacturer and model"></label><label>Robot width · m, optional<input name="width_m" type="number" min="0.001" max="100" step="any"></label><label>Planning margin · m, optional<input name="margin_m" type="number" min="0" max="100" step="any"></label><label>Task kind<input name="task_kind" required maxlength="80" placeholder="Navigation"></label><label>Task goal<input name="task_goal" required maxlength="1000" placeholder="Dock to service corridor"></label></div><p class="projects-choice-heading">Retained sources used for this revision</p>${checkboxes('source_ids',list(p.sources),item=>item.name)}<p>Robot dimensions and margins are entered assumptions until supported by reviewed measurement evidence. Saving a revision does not run a simulation.</p><button type="submit" class="primary">Save immutable revision</button>`)}</form>`+
    (list(p.revisions).length ? `<div class="projects-records">${[...p.revisions].reverse().map(rev=>`<article class="projects-record"><div class="projects-record-header"><h4>${esc(rev.label)}</h4><div class="projects-badges">${badge(rev.kind)}${rev.id===p.current_as_is_revision_id?badge('Current as-is'):''}</div></div><dl><dt>Robot</dt><dd>${esc(rev.robot?.model)}${rev.robot?.width_m!=null?' · width '+esc(rev.robot.width_m)+' m':''}${rev.robot?.margin_m!=null?' · margin '+esc(rev.robot.margin_m)+' m':''}</dd><dt>Task</dt><dd>${esc(rev.task?.kind)} · ${esc(rev.task?.goal)}</dd><dt>Sources</dt><dd>${esc(refNames(rev.source_ids,sourceName))}</dd><dt>Parent</dt><dd>${esc(rev.parent_revision_id?revisionName(rev.parent_revision_id):'None')}</dd><dt>Created</dt><dd>${esc(date(rev.created_at))}</dd><dt>Revision ID</dt><dd><code>${esc(rev.id)}</code></dd></dl></article>`).join('')}</div>` : empty('No site revision yet','Retain a source file, then define the site state, robot and task.'));
}
function evidenceReview(item) {
  if(!canReview()) return '<p>A reviewer credential is required to confirm or reject evidence.</p>';
  return `<form data-evidence-review="${esc(item.id)}" class="projects-review-form"><fieldset data-review-fields${state.busy?' disabled':''}><label>Review reason<input name="reason" required maxlength="2000" placeholder="What you checked and any remaining limits"></label><div class="projects-actions"><button name="decision" value="confirmed" type="submit">Confirm record</button><button name="decision" value="rejected" type="submit">Reject record</button></div></fieldset></form>`;
}
function renderEvidence() {
  const p=state.project;
  return title('Evidence behind each claim','Bind every claim to a retained source and exact revision. A reviewer confirms the submitted record; this does not independently certify a measurement.')+
    `<form id="evidence-form" class="projects-form">${writeFieldset(`<h3>Add an evidence record</h3><div class="projects-form-grid"><label>Revision<select name="revision_id" required>${revisionOptions()}</select></label><label>Source file<select name="source_id" required>${sourceOptions()}</select></label><label>Evidence kind<select name="kind"><option value="observed">Observed · visible in the source</option><option value="measured">Measured · recorded value and method</option><option value="inferred">Inferred · interpretation or estimate</option></select></label><label>Component ID · optional<input name="component_id" maxlength="160" placeholder="door-service-01"></label><label class="projects-span-2">Claim<textarea name="claim" required maxlength="2000" rows="2" placeholder="What does this source establish?"></textarea></label><label>Value · required for measurements<input name="value" type="number" step="any"></label><label>Unit · required for measurements<input name="unit" maxlength="40" placeholder="m"></label><label class="projects-span-2">Where to look and how it was obtained<textarea name="locator_note" required maxlength="1000" rows="2" placeholder="Service doorway, ruler endpoints visible; record the measurement method"></textarea></label><label>Page · optional<input name="page" type="number" min="1" step="1"></label><label>Frame · optional<input name="frame" type="number" min="0" step="1"></label><label>Time in source · seconds, optional<input name="time_seconds" type="number" min="0" step="any"></label><label>Uncertainty · optional<input name="uncertainty" maxlength="1000" placeholder="Method limits, tolerance or unknown"></label></div><button type="submit" class="primary">Add evidence for review</button>`)}</form>`+
    (list(p.evidence).length ? `<div class="projects-records">${[...p.evidence].reverse().map(item=>`<article class="projects-record"><div class="projects-record-header"><h4>${esc(item.claim)}</h4><div class="projects-badges">${badge(item.kind)}${badge(item.status || 'unreviewed',item.status==='rejected'?'bad':item.status==='confirmed'?'good':'warning')}</div></div><dl><dt>Revision</dt><dd>${esc(revisionName(item.revision_id))}</dd><dt>Source</dt><dd>${esc(sourceName(item.source_id))}</dd>${item.component_id?`<dt>Component</dt><dd>${esc(item.component_id)}</dd>`:''}${item.value!=null?`<dt>Recorded value</dt><dd>${esc(item.value)} ${esc(item.unit)}</dd>`:''}<dt>Source locator</dt><dd>${esc(item.locator?.note)}${item.locator?.page!=null?' · page '+esc(item.locator.page):''}${item.locator?.frame!=null?' · frame '+esc(item.locator.frame):''}${item.locator?.time_seconds!=null?' · '+esc(item.locator.time_seconds)+' s':''}</dd>${item.uncertainty!=null?`<dt>Uncertainty</dt><dd>${esc(typeof item.uncertainty==='object'?JSON.stringify(item.uncertainty):item.uncertainty)}</dd>`:''}</dl><button type="button" class="small" data-download-source="${esc(item.source_id)}">Open source download</button>${rawDetails('Review history',list(item.reviews))}${evidenceReview(item)}</article>`).join('')}</div>` : empty('No evidence records yet','Add a measurement, observation or inference tied to a revision and retained source.'));
}
function decisionsFor(change) {
  const independent=change.proposed_by!==actor().id;
  if(change.status==='pending' && canReview() && independent) return ['approve','reject'];
  if(change.status==='approved') return [...(canWrite()?['implemented']:[]),...(canReview()&&independent?['reject']:[])];
  if(change.status==='implemented' && canReview() && independent) return ['verified'];
  return [];
}
function changeDecision(change) {
  const decisions=decisionsFor(change);
  if(!decisions.length) return `<p>${change.status==='stale'?'This decision is stale. Review the current as-is revision and create a new proposed change.':change.proposed_by===actor().id&&['pending','implemented'].includes(change.status)?'A different reviewer must decide on the change you proposed.':'No decision is available for this credential and current change state.'}</p>`;
  const options={approve:'Approve proposed change',reject:'Reject proposed change',implemented:'Record implementation',verified:'Verify against recorded trial'};
  const implementation=[...list(change.decisions)].reverse().find(item=>item.decision==='implemented');
  const latest=list(state.project.trials).filter(trial=>trial.revision_id===change.proposed_revision_id&&trial.kind==='physical')
    .sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)||(b.recorded_project_version||0)-(a.recorded_project_version||0))[0];
  const trials=latest&&latest.outcome==='pass'&&implementation&&Number.isSafeInteger(latest.recorded_project_version)&&latest.recorded_project_version>implementation.project_version&&Date.parse(latest.occurred_at)>=Date.parse(implementation.at)?[latest]:[];
  return `<form class="projects-review-form" data-change-decision="${esc(change.id)}"><fieldset data-decision-fields${state.busy?' disabled':''}><label>Decision<select name="decision">${decisions.map(value=>`<option value="${value}">${options[value]}</option>`).join('')}</select></label>${decisions.includes('verified')?`<label>Physical trial at this proposed revision<select name="trial_id" required><option value="">Choose a reported passing trial</option>${trials.map(trial=>`<option value="${esc(trial.id)}">${esc(date(trial.occurred_at))} · ${esc(trial.task)} · ${esc(shortId(trial.id))}</option>`).join('')}</select></label><p>Verification requires source records, a confirmed measurement and a physical trial performed after implementation was recorded, at this exact revision. The trial remains operator-reported; this is not safety certification.</p>`:''}<label>Reason<textarea name="reason" required maxlength="2000" rows="2"></textarea></label><button type="submit">Record decision</button></fieldset></form>`;
}
function renderChanges() {
  const p=state.project;
  return title('Review proposed changes','Keep the current site separate from the proposed state. A different reviewer approves or rejects a proposal; implementation and trial verification are recorded afterward.')+
    `<form id="change-form" class="projects-form">${writeFieldset(`<h3>Propose a change</h3><div class="projects-form-grid"><label class="projects-span-2">Change title<input name="title" required maxlength="160" placeholder="Move rack to restore doorway clearance"></label><label>Base as-is revision<select name="base_revision_id" required>${revisionOptions({kind:'as_is'})}</select></label><label>Proposed revision<select name="proposed_revision_id" required>${revisionOptions({kind:'proposed'})}</select></label><label class="projects-span-2">Reason<textarea name="reason" required maxlength="2000" rows="2"></textarea></label></div><p class="projects-choice-heading">Evidence supporting this proposal</p>${checkboxes('evidence_ids',list(p.evidence),item=>`${item.claim} · ${item.status || 'unreviewed'}`)}<button class="primary" type="submit">Submit for independent review</button>`)}</form>`+
    (list(p.changes).length ? `<div class="projects-records">${[...p.changes].reverse().map(change=>`<article class="projects-record"><div class="projects-record-header"><h4>${esc(change.title)}</h4>${badge(change.status,['rejected','stale'].includes(change.status)?'warning':change.status==='verified'?'good':'')}</div><p>${esc(change.reason)}</p><dl><dt>Base site</dt><dd>${esc(revisionName(change.base_revision_id))}</dd><dt>Proposed site</dt><dd>${esc(revisionName(change.proposed_revision_id))}</dd><dt>Proposed by</dt><dd>${esc(change.proposed_by===actor().id?'You · '+actor().name:change.proposed_by)}</dd><dt>Supporting records</dt><dd>${esc(list(change.evidence_ids).length)}</dd></dl>${rawDetails('Decision history',list(change.decisions))}${changeDecision(change)}</article>`).join('')}</div>` : empty('No proposed changes','Create an as-is and a proposed revision, then submit the change with its supporting evidence.'));
}
function trialEvidenceOptions(revisionId='') {
  const items=list(state.project?.evidence).filter(item=>item.kind==='measured'&&item.status==='confirmed'&&(!revisionId||item.revision_id===revisionId));
  return checkboxes('measurement_evidence_ids',items,item=>`${item.claim} · ${revisionName(item.revision_id)}`);
}
function renderTrials() {
  const p=state.project;
  return title('Predictions and recorded outcomes','Explicitly choose simulation or physical trial. Physical outcomes are reported by the operator and remain separate from a simulated prediction.')+
    `<form id="trial-form" class="projects-form">${writeFieldset(`<h3>Record a trial</h3><div class="projects-form-grid"><label>Trial kind<select name="kind" required><option value="">Choose what actually ran</option><option value="physical">Physical · real robot observation</option><option value="simulation">Simulation · software execution</option></select></label><label>Exact revision<select name="revision_id" required>${revisionOptions()}</select></label><label>Robot model · from revision<input name="robot_model" required maxlength="160" readonly></label><label>Task · from revision<input name="task" required maxlength="2000" readonly></label><label>Prediction<select name="prediction"><option value="unknown">Unknown / not recorded</option><option value="pass">Predicted pass</option><option value="fail">Predicted fail</option></select></label><label>Recorded outcome<select name="outcome" required><option value="">Choose outcome</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="inconclusive">Inconclusive</option></select></label><label>When the trial occurred<input name="occurred_at" type="datetime-local" step="0.001" required><button type="button" class="small" data-trial-time-now>Use current time</button></label><label class="projects-span-2">Observations and limits<textarea name="notes" required maxlength="4000" rows="3" placeholder="What happened, interventions, conditions and remaining uncertainty"></textarea></label></div><p class="projects-choice-heading">Retained trial source files</p>${checkboxes('source_ids',list(p.sources),item=>item.name)}<p class="projects-choice-heading">Confirmed measurements at this revision · needed for change verification</p><div id="trial-measurements">${trialEvidenceOptions()}</div><button type="submit" class="primary">Save reported trial</button>`)}</form>`+
    (list(p.trials).length ? `<div class="projects-records">${[...p.trials].reverse().map(trial=>`<article class="projects-record"><div class="projects-record-header"><h4>${esc(trial.task)}</h4><div class="projects-badges">${badge(trial.kind==='physical'?'Operator-reported physical trial':'Simulation')}${badge(trial.outcome,trial.outcome==='fail'?'bad':trial.outcome==='pass'?'good':'warning')}</div></div><dl><dt>Revision</dt><dd>${esc(revisionName(trial.revision_id))}</dd><dt>Robot</dt><dd>${esc(trial.robot_model)}</dd><dt>Prior prediction</dt><dd>${esc(label(trial.prediction))}</dd><dt>Occurred</dt><dd>${esc(date(trial.occurred_at))}</dd><dt>Source files</dt><dd>${esc(refNames(trial.source_ids,sourceName))}</dd><dt>Measured evidence</dt><dd>${esc(list(trial.measurement_evidence_ids).length)} linked record(s)</dd></dl><p>${esc(trial.notes)}</p>${trial.kind==='physical'?'<p>Reported observation; independent physical validation is not established by this record.</p>':''}</article>`).join('')}</div>` : empty('No trials recorded','Save a simulation or real-world trial with its revision, source files and observed result.'));
}
function renderActivity() {
  return title('Project activity','An attributed history of source uploads, revisions, reviews, changes and trial records.')+
    (list(state.project.events).length ? `<div class="projects-records">${[...state.project.events].reverse().map(event=>`<article class="projects-record"><div class="projects-record-header"><h4>${esc(label(event.type || event.action))}</h4><span class="projects-muted">${esc(date(event.created_at || event.at))}</span></div><p>${esc(event.actor_name || event.actor_id || event.actor?.name || '')}</p>${rawDetails('Event details',event)}</article>`).join('')}</div>` : empty('No activity yet','Changes to this project will appear here.'));
}
function renderPanel() {
  const renderers={overview:renderOverview,sources:renderSources,revisions:renderRevisions,evidence:renderEvidence,changes:renderChanges,trials:renderTrials,activity:renderActivity};
  $('project-panel').innerHTML=renderers[state.section]();
  setBusy(state.busy);
}

async function connect(event) {
  event.preventDefault();if(state.busy)return;
  const apiKey=$('project-api-key').value.trim();$('project-api-key').value='';
  if(!apiKey){notify('Enter your project API key.','error');return;}
  disconnect(false);
  try {state.client=createProjectsClient({apiKey});} catch(error) {showError(error);return;}
  const context=startRequest();setBusy(true);notify('Connecting to your project workspace…');
  try {
    const me=await context.client.me({signal:context.controller.signal});
    const response=await context.client.listProjects({signal:context.controller.signal});
    if(!isCurrent(context))return;
    state.me=me;state.projects=list(response.projects);renderConnection();renderList();
    const id=requestedProject();
    if(id){const result=await context.client.getProject(id,{signal:context.controller.signal});if(!isCurrent(context))return;acceptProject(result.project);}
    notify(`Connected as ${actor().name || actor().role}. ${state.projects.length} saved project${state.projects.length===1?'':'s'} available.`);
  } catch(error) {
    if(!isCurrent(context))return;
    if(!state.me){state.client?.clearApiKey();state.client=null;renderConnection();renderList();}
    showError(error);
  } finally {endRequest(context);if(isCurrent(context))setBusy(false);}
}
function disconnect(announce=true) {
  state.generation++;for(const controller of state.requests)controller.abort();state.requests.clear();
  state.client?.clearApiKey();state.client=null;state.me=null;state.projects=[];state.project=null;state.busy=false;clearRetry();$('project-api-key').value='';
  renderConnection();renderList();renderProject();
  if(announce)notify('Disconnected. The API key and loaded project data have been cleared from this page. Saved records remain in your workspace.');
}
async function refreshProjects() {
  if(!state.client||state.busy)return;
  const context=startRequest();setBusy(true);
  try{const result=await context.client.listProjects({signal:context.controller.signal});if(isCurrent(context)){state.projects=list(result.projects);renderList();notify('Project list refreshed.');}}
  catch(error){if(isCurrent(context))showError(error);}finally{endRequest(context);if(isCurrent(context))setBusy(false);}
}
async function openProject(id) {
  if(!state.client||state.busy)return;
  const context=startRequest();setBusy(true);notify('Loading saved project…');
  try{const result=await context.client.getProject(id,{signal:context.controller.signal});if(isCurrent(context)){acceptProject(result.project);clearRetry();notify('Latest project record loaded.');}}
  catch(error){if(isCurrent(context))showError(error);}finally{endRequest(context);if(isCurrent(context))setBusy(false);}
}

async function mutate(action,args,success,afterSuccess=null) {
  if(!state.client||state.busy)return;
  const descriptor={action,args:structuredClone(args),idempotencyKey:createIdempotencyKey(),success,afterSuccess,generation:state.generation};
  clearRetry();await performMutation(descriptor);
}
async function performMutation(descriptor) {
  if(state.busy||!state.client||descriptor.generation!==state.generation)return;
  const context=startRequest();setBusy(true);notify('Saving project record…');$('request-retry').hidden=true;
  try {
    const response=await context.client[descriptor.action](...descriptor.args,{idempotencyKey:descriptor.idempotencyKey,signal:context.controller.signal});
    if(!isCurrent(context))return;
    acceptProject(response.project);clearRetry();descriptor.afterSuccess?.();notify(descriptor.success);
  } catch(error) {
    if(!isCurrent(context))return;showError(error);
    if(!error?.status || error.status>=500){state.retry=descriptor;$('request-retry').hidden=false;notify('The save outcome could not be confirmed. Retry the same request to avoid creating a duplicate. '+(error?.message||''),'warning');}
  } finally {endRequest(context);if(isCurrent(context))setBusy(false);}
}
const str = (data,name) => String(data.get(name) || '').trim();
const ids = (data,name) => data.getAll(name).map(String);
function optionalNumber(data,name) {const value=str(data,name);if(value==='')return undefined;const number=Number(value);if(!Number.isFinite(number))throw Error('Enter a finite numeric value.');return number;}
function withNumber(target,key,data,name=key) {const value=optionalNumber(data,name);if(value!==undefined)target[key]=value;}
function baseBody() {if(!state.project)throw Error('Open a project first.');return {expected_version:state.project.version};}
function toBase64(bytes) {let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary);}
async function handleSubmit(event) {
  const form=event.target;
  if(form.id==='connect-form')return;
  const handled=['create-project-form','source-form','revision-form','evidence-form','change-form','trial-form'].includes(form.id)||form.dataset.evidenceReview||form.dataset.changeDecision;
  if(!handled)return;event.preventDefault();if(state.busy)return;
  const submitGeneration=state.generation;
  const data=new FormData(form);
  try {
    const permitted=form.dataset.evidenceReview?canReview():form.dataset.changeDecision?(str(data,'decision')==='implemented'?canWrite():canReview()):canWrite();
    if(!state.client||!permitted)throw Error('This credential does not have the scope required for this action.');
    if(form.id==='create-project-form') {await mutate('createProject',[{title:str(data,'title'),description:str(data,'description')}],'Project created.',()=>{form.reset();$('create-project-details').open=false;});return;}
    const projectId=state.project?.id,body=baseBody();
    if(form.id==='source-form') {
      const file=data.get('source_file');if(!file?.size)throw Error('Choose a nonempty source file.');
      if(file.size>MAX_SOURCE_BYTES)throw Error('This source exceeds 512 KiB. Retain a smaller exact file or excerpt; full videos stay in your capture workflow.');
      const generation=state.generation;setBusy(true);const bytes=new Uint8Array(await file.arrayBuffer());
      if(generation!==state.generation)return;setBusy(false);
      await mutate('addSource',[projectId,{...body,name:file.name,media_type:file.type||'application/octet-stream',data_base64:toBase64(bytes)}],'Exact source bytes retained.');
    } else if(form.id==='revision-form') {
      const robot={model:str(data,'robot_model')};withNumber(robot,'width_m',data);withNumber(robot,'margin_m',data);
      Object.assign(body,{label:str(data,'label'),kind:str(data,'kind'),source_ids:ids(data,'source_ids'),robot,task:{kind:str(data,'task_kind'),goal:str(data,'task_goal')}});
      if(!body.source_ids.length)throw Error('Select at least one retained source for this revision.');
      if(str(data,'parent_revision_id'))body.parent_revision_id=str(data,'parent_revision_id');
      await mutate('createRevision',[projectId,body],'Immutable revision saved. Review any changes affected by the new site state.');
    } else if(form.id==='evidence-form') {
      Object.assign(body,{revision_id:str(data,'revision_id'),source_id:str(data,'source_id'),kind:str(data,'kind'),claim:str(data,'claim'),locator:{note:str(data,'locator_note')}});
      for(const name of ['page','frame','time_seconds'])withNumber(body.locator,name,data);
      withNumber(body,'value',data);
      for(const name of ['unit','component_id','uncertainty'])if(str(data,name))body[name]=str(data,name);
      await mutate('addEvidence',[projectId,body],'Evidence added. Its review status is separate from the claim and source.');
    } else if(form.dataset.evidenceReview) {
      Object.assign(body,{decision:event.submitter?.value,reason:str(data,'reason')});
      await mutate('reviewEvidence',[projectId,form.dataset.evidenceReview,body],'Evidence review recorded.');
    } else if(form.id==='change-form') {
      Object.assign(body,{base_revision_id:str(data,'base_revision_id'),proposed_revision_id:str(data,'proposed_revision_id'),title:str(data,'title'),reason:str(data,'reason'),evidence_ids:ids(data,'evidence_ids')});
      await mutate('createChange',[projectId,body],'Change submitted. A separate reviewer must decide on your proposal.');
    } else if(form.dataset.changeDecision) {
      Object.assign(body,{decision:str(data,'decision'),reason:str(data,'reason')});if(str(data,'trial_id'))body.trial_id=str(data,'trial_id');
      await mutate('decideChange',[projectId,form.dataset.changeDecision,body],'Change decision recorded.');
    } else if(form.id==='trial-form') {
      const occurred=new Date(str(data,'occurred_at'));if(!Number.isFinite(occurred.getTime()))throw Error('Enter when the trial occurred.');
      Object.assign(body,{kind:str(data,'kind'),revision_id:str(data,'revision_id'),robot_model:str(data,'robot_model'),task:str(data,'task'),outcome:str(data,'outcome'),prediction:str(data,'prediction'),source_ids:ids(data,'source_ids'),measurement_evidence_ids:ids(data,'measurement_evidence_ids'),notes:str(data,'notes'),occurred_at:occurred.toISOString()});
      await mutate('createTrial',[projectId,body],'Trial saved with its kind, prediction and operator-reported outcome.');
    }
  } catch(error) {if(submitGeneration!==state.generation)return;setBusy(false);showError(error);}
}

function download(name,bytes,type='application/json') {
  const url=URL.createObjectURL(new Blob([bytes],{type})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadSource(sourceId) {
  if(!state.client||!state.project||state.busy)return;
  const context=startRequest();setBusy(true);
  try {const response=await context.client.getSource(state.project.id,sourceId,{signal:context.controller.signal});if(!isCurrent(context))return;
    if(typeof response.data_base64!=='string')throw Error('Source bytes were not included in the response.');
    const decoded=atob(response.data_base64),bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));download(response.source?.name || 'source.bin',bytes,response.source?.media_type||'application/octet-stream');notify('Retained source bytes downloaded.');
  } catch(error){if(isCurrent(context))showError(error);}finally{endRequest(context);if(isCurrent(context))setBusy(false);}
}
async function exportProject() {
  if(!state.client||!state.project||state.busy)return;
  const context=startRequest();setBusy(true);
  try{const result=await context.client.exportProject(state.project.id,{signal:context.controller.signal});if(!isCurrent(context))return;download(`brainsnn-project-${shortId(state.project.id)}.json`,JSON.stringify(result,null,2));notify('Project record downloaded. Source files can be downloaded separately from Sources.');}
  catch(error){if(isCurrent(context))showError(error);}finally{endRequest(context);if(isCurrent(context))setBusy(false);}
}
async function loadUsage() {
  if(!state.client||state.busy)return;
  const context=startRequest();setBusy(true);
  try{const result=await context.client.usage({signal:context.controller.signal});if(isCurrent(context))$('usage-result').innerHTML=rawDetails('Usage returned by the service',result);}
  catch(error){if(isCurrent(context))showError(error);}finally{endRequest(context);if(isCurrent(context))setBusy(false);}
}

function renderHandoff() {
  $('handoff-banner').hidden=!state.handoff;
  $('handoff-note').textContent=state.handoff ? `${state.handoff.name} · ${new TextEncoder().encode(state.handoff.content_text).length.toLocaleString()} bytes. Connect and select the project where it belongs.` : '';
  setBusy(state.busy);
}
async function saveHandoff() {
  if(!state.handoff||!state.project||state.busy)return;
  await mutate('addSource',[state.project.id,{...baseBody(),...state.handoff}],'Workspace snapshot retained as a source. Add a revision to record its robot, task and site state.',()=>{state.handoff=null;renderHandoff();state.section='sources';renderProject();});
}
window.addEventListener('message',event=>{
  if(!window.opener||event.source!==window.opener||event.origin!==location.origin||event.data?.type!=='brainsnn-project-source')return;
  const source=event.data.source;
  if(!source||typeof source.content_text!=='string'||typeof source.name!=='string'||source.name.length>160||new TextEncoder().encode(source.content_text).length>MAX_SOURCE_BYTES)return;
  state.handoff={name:source.name,media_type:'application/json',content_text:source.content_text};renderHandoff();
  window.opener.postMessage({type:'brainsnn-project-source-received'},location.origin);
});
if(window.opener)window.opener.postMessage({type:'brainsnn-project-ready'},location.origin);

$('connect-form').addEventListener('submit',connect);
document.addEventListener('submit',handleSubmit);
$('disconnect-button').addEventListener('click',()=>disconnect());
$('service-retry').addEventListener('click',()=>void checkService());
$('refresh-projects').addEventListener('click',()=>void refreshProjects());
$('refresh-project').addEventListener('click',()=>void openProject(state.project.id));
$('export-project').addEventListener('click',()=>void exportProject());
$('retry-request').addEventListener('click',()=>state.retry&&void performMutation(state.retry));
$('discard-retry').addEventListener('click',()=>{clearRetry();notify('Retry dismissed. Reload the project before creating a replacement request.','warning');});
$('save-handoff').addEventListener('click',()=>void saveHandoff());
$('dismiss-handoff').addEventListener('click',()=>{state.handoff=null;renderHandoff();});
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.projectId)void openProject(button.dataset.projectId);
  if(button.dataset.section&&state.project){state.section=button.dataset.section;renderProject();$('project-tabs').querySelector(`[data-section="${state.section}"]`)?.focus({preventScroll:true});}
  if(button.dataset.downloadSource)void downloadSource(button.dataset.downloadSource);
  if(button.id==='load-usage')void loadUsage();
  if(button.hasAttribute('data-trial-time-now')){const now=new Date();button.form.elements.occurred_at.value=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,-1);}
});
document.addEventListener('change',event=>{
  if(event.target.form?.id==='revision-form'&&event.target.name==='kind'){
    const parent=event.target.form.elements.parent_revision_id,proposed=event.target.value==='proposed';
    parent.innerHTML=revisionOptions(proposed?{kind:'as_is'}:{});parent.required=proposed;
    if(proposed&&state.project.current_as_is_revision_id)parent.value=state.project.current_as_is_revision_id;
  }
  if(event.target.form?.id==='evidence-form'&&event.target.name==='kind'){
    const measured=event.target.value==='measured';event.target.form.elements.value.required=measured;event.target.form.elements.unit.required=measured;
  }
  if(event.target.form?.id==='trial-form'&&event.target.name==='revision_id'){
    $('trial-measurements').innerHTML=trialEvidenceOptions(event.target.value);
    const revision=list(state.project?.revisions).find(item=>item.id===event.target.value);
    if(revision){event.target.form.elements.robot_model.value=revision.robot?.model || '';event.target.form.elements.task.value=revision.task?.goal || '';}
  }
});
window.addEventListener('hashchange',()=>{const id=requestedProject();if(id&&id!==state.project?.id&&state.client)void openProject(id);});
window.addEventListener('pagehide',()=>{disconnect(false);state.handoff=null;renderHandoff();});
renderConnection();void checkService();
