import {
  prepareProjectReview, defaultReviewRates, localProposal, validateProposal, priceProposal,
  approveReview, validateApproval, exportReviewJSON, exportReviewMarkdown, demoSceneText,
} from './project-review.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsonStable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const SOURCE_LIMIT = 256 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const AI_DEADLINE = 110_000;
const money = (value,currency) => new Intl.NumberFormat('en-CA',{style:'currency',currency,maximumFractionDigits:2}).format(value);
const number = value => new Intl.NumberFormat('en-CA',{maximumFractionDigits:2}).format(value);
const when = value => { const date=new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : ''; };
const text = (value,max=1600) => typeof value === 'string' ? value.slice(0,max) : '';

async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
}

async function responseJSON(response) {
  const reader=response.body?.getReader();
  if(!reader)throw Error('The review service returned an empty response.');
  const chunks=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>RESPONSE_LIMIT)throw Error('The review response is too large.');chunks.push(value);}
  } finally { void reader.cancel().catch(()=>{}); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('The review service returned invalid JSON.');}
  if(!response.ok)throw Error(text(data?.detail,350)||`The review request failed (${response.status}).`);
  return data;
}

function polygon(component) {
  if(!Array.isArray(component.centre)||!Array.isArray(component.size))return [];
  const [x,,z]=component.centre,[w,,d]=component.size,a=(component.yaw||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([i,j])=>[x+c*i*w+s*j*d,z-s*i*w+c*j*d]);
}

function planSVG(input, report, selected) {
  const parts=input.components.map(part=>({part,points:polygon(part)})).filter(item=>item.points.length===4);
  if(!parts.length)return '<div class="pr-preview-empty"><p>This model has no compatible plan envelopes.</p></div>';
  const coords=parts.flatMap(p=>p.points),xs=coords.map(p=>p[0]),zs=coords.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const scale=Math.min(510/Math.max(.1,maxX-minX),260/Math.max(.1,maxZ-minZ));
  const x=p=>300+(p-(minX+maxX)/2)*scale,z=p=>155-(p-(minZ+maxZ)/2)*scale;
  const chosen=new Set(report?.options.find(o=>o.id===selected)?.items.map(i=>i.componentId)||[]);
  const ordered=[...parts].sort((a,b)=>(a.part.kind==='floor'?-1:0)-(b.part.kind==='floor'?-1:0));
  return `<svg viewBox="0 0 600 320" role="img" aria-label="Plan of the compiled source model. Highlighted components belong to the selected scope."><defs><pattern id="pr-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="#1f3448" stroke-width=".5"/></pattern></defs><rect width="600" height="320" fill="url(#pr-grid)" opacity=".6"/>${ordered.map(({part,points})=>{
    const active=chosen.has(part.componentId),floor=part.kind==='floor',wall=part.kind==='wall';
    const fill=active?(floor?'#68eaff25':'#68eaffad'):floor?'#172b3b':wall?'#436577':'#947cff1f';
    const stroke=active?'#8bf0ff':wall?'#83b6c5':'#947cffa0';
    return `<polygon points="${points.map(p=>`${x(p[0]).toFixed(2)},${z(p[1]).toFixed(2)}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${active?2:1}" vector-effect="non-scaling-stroke"><title>${esc(part.label)} · ${esc(part.kind)}${active?' · selected scope':''}</title></polygon>`;
  }).join('')}<text x="18" y="300" fill="#91a7bc" font-size="10" letter-spacing="1.2">SOURCE PLAN · METRES</text><text x="582" y="300" fill="#91a7bc" font-size="10" text-anchor="end">GEOMETRY UNVERIFIED</text></svg>`;
}

function findingText(finding) {
  if(typeof finding==='string')return finding;
  return text(finding?.message||finding?.detail||finding?.description||finding?.title,1200);
}

function surfaceBasis(item) {
  return item.quantityBasis==='compiled-floor-envelope'?'Floor envelope':'Wall face with openings deducted';
}

function sourceDetailsHTML(item) {
  return `<details class="pr-source-details"><summary aria-label="Source details for ${esc(item.label)}">Source details</summary><dl><dt>Component ID</dt><dd><code>${esc(item.componentId)}</code></dd><dt>Calculation reference</dt><dd><code>${esc(item.quantityBasis)}</code></dd></dl></details>`;
}

function initialEstimateHTML(report,collapsible=false) {
  const review=report.reviews?.estimator;
  if(!review)return '';
  const note=report.execution.revisionApplied
    ? 'The estimator reviewed the first proposal and a planner revision followed. These earlier findings describe that first proposal; the final reviewer identifies remaining issues.'
    : 'The estimator reviewed the initial proposal. No planner revision was applied; consider these findings alongside the final review.';
  const content=`<p class="pr-subnote">${esc(note)}</p><p>${esc(review.summary)}</p><ul class="pr-caveats">${review.findings.map(f=>`<li>${esc(findingText(f))}</li>`).join('')||'<li>No additional findings were recorded.</li>'}</ul>`;
  return collapsible?`<details style="margin-top:18px"><summary>Initial estimate review${report.execution.revisionApplied?' · before revision':''}</summary>${content}</details>`:`<section><h2>Initial estimate review</h2>${content}</section>`;
}

function reportHTML(input,report,approval,receipt,plain) {
  const selected=report.options.find(option=>option.id===approval?.optionId);
  const range=option=>option.subtotal ? `${money(option.subtotal.low,report.currency)} – ${money(option.subtotal.high,report.currency)}` : 'Pricing incomplete';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(report.brief.title)} · BrainSNN project review</title><style>body{max-width:980px;margin:45px auto;padding:0 24px;font:15px/1.65 system-ui,sans-serif;color:#172536}h1{font-size:36px;line-height:1.15;letter-spacing:-1px}h2{margin:30px 0 10px}h3{margin:18px 0 8px}p{margin:8px 0}small{color:#506477}header{border-bottom:2px solid #76cddd;padding-bottom:24px}.tag{font-size:12px;letter-spacing:1px;color:#345a6c}section{padding:15px 0;border-bottom:1px solid #dce3eb}.note{padding:15px 20px;background:#f4f8fa;border-left:3px solid #76cddd}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:12px 8px;border-bottom:1px solid #dce3eb}th{color:#506477}th:last-child,td:last-child{text-align:right}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}li{margin:5px 0}@media print{body{margin:20px auto}section{break-inside:avoid}details{display:none}}</style></head><body><header><p class="tag">BRAINSNN / XIO VISION · PRELIMINARY PROJECT REVIEW</p><h1>${esc(report.brief.title)}</h1><p>${esc(report.brief.goal)}</p>${report.brief.constraints?`<p><strong>Constraints:</strong> ${esc(report.brief.constraints)}</p>`:''}<small>${esc(input.source.label)} · ${report.execution?.mode==='ai-team'?'AI-assisted review with calculation-backed quantities':'Local template comparison and calculations'}</small></header><div class="note"><strong>${approval?'Approved for preliminary review':'Draft for review'}</strong><p>${approval?`${esc(approval.reviewer)} selected ${esc(selected?.title||approval.optionId)}. `:''}Geometry remains unverified. This is a bounded finish scope, not a final quotation, complete construction scope or compliance certification.</p></div>${report.options.map(option=>`<section><p class="tag">${esc(option.id)}${approval?.optionId===option.id?' · SELECTED':''}</p><h2>${esc(option.title)}</h2><p>${esc(option.summary)}</p><h3>${esc(range(option))}</h3><p><small>Selected lines only. Taxes, hidden conditions and other project work are excluded unless explicitly entered in the scope.</small></p><table><thead><tr><th>Component / work</th><th>Quantity</th><th>Rate source</th><th>Amount</th></tr></thead><tbody>${option.items.map(item=>`<tr><td>${esc(item.label)}<br><small>${esc(item.rateLabel)} · ${esc(surfaceBasis(item))}</small>${sourceDetailsHTML(item)}</td><td>${number(item.quantity)} m²<br><small>${esc(item.evidence)}</small></td><td>${esc(item.rateSource||'Not supplied')}<br><small>${esc(item.rateDate||'No date')}</small></td><td>${item.priced?`${money(item.low,report.currency)} – ${money(item.high,report.currency)}`:'Not priced'}</td></tr>`).join('')}</tbody></table>${option.assumptions?.length?`<h3>Assumptions</h3><ul>${option.assumptions.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:''}${option.questions?.length?`<h3>Open questions</h3><ul>${option.questions.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:''}</section>`).join('')}<section><h2>Review findings</h2><ul>${[...(report.findings||[]),...(report.questions||[]),...(report.reviews?.reviewer?.findings||[])].map(f=>`<li>${esc(findingText(f))}</li>`).join('')}</ul>${report.reviews?.reviewer?.summary?`<p>${esc(report.reviews.reviewer.summary)}</p>`:''}</section>${initialEstimateHTML(report)}<section><h2>Source and decision</h2><p>Source: ${esc(input.source.label)}</p><p>Origin: ${esc(input.source.origin)}</p>${approval?`<p>Reviewer: ${esc(approval.reviewer)}</p><p>Note: ${esc(approval.note||'No additional note')}</p>`:''}<small>Input SHA-256: ${esc(input.inputSha256)}<br>Scene SHA-256: ${esc(input.source.sceneSha256)}</small></section><details><summary>Complete text brief</summary><pre>${esc(plain)}</pre></details><details><summary>Source-bound review receipt</summary><pre>${esc(receipt)}</pre></details></body></html>`;
}

/** Shared studio for the main World Builder and the standalone file review page. */
export function mountProjectReview({host,getToken=()=>null,onConnect=null,onStatus=()=>{},onSourceIntent=()=>{}}) {
  if(!host)throw Error('Project review needs a host element.');
  let alive=true,epoch=0,decisionGeneration=0,approvalPending=false,sourceReadGeneration=0,source=null,preview=null,input=null,report=null,approval=null,selected='option-a';
  let pending=null,sourcePending=null,connectionPending=null,sessionToken=null,apiStatus=null,lastInputNotice=false;
  const history=[],listeners=new AbortController();
  const $=selector=>host.querySelector(selector);
  host.classList.add('pr-studio');
  host.dataset.buildMarker='world-project-review-v1';
  host.innerHTML=`<div class="pr-header"><div class="pr-header-copy"><p class="pr-kicker">WORLD BUILDER / PROJECT REVIEW</p><h1>Make the next decision clearer.</h1><p>Compare two scopes for your space, trace the quantities and choose what happens next.</p></div><div class="pr-header-status"><span class="pr-pill" id="pr-mode" data-state="draft">DRAFT WORKSPACE</span><small>Human approval stays with you.</small></div></div>
    <div class="pr-team" aria-label="Project review roles"><div class="pr-agent"><div class="pr-agent-avatar" aria-hidden="true">01</div><div><strong>Scope planner</strong><span>Two bounded alternatives</span></div></div><div class="pr-agent"><div class="pr-agent-avatar" aria-hidden="true">02</div><div><strong>Estimator</strong><span>Quantities × your rates</span></div></div><div class="pr-agent"><div class="pr-agent-avatar" aria-hidden="true">03</div><div><strong>Reviewer</strong><span>Gaps, assumptions, decisions</span></div></div></div>
    <div class="pr-layout"><aside class="pr-inputs" aria-label="Project inputs">
      <section class="pr-panel"><div class="pr-panel-heading"><h3>Your space</h3><span class="pr-step-number">01</span></div><p class="pr-source-name" id="pr-source-name">Open a compiled building model.</p><p class="pr-source-meta" id="pr-source-meta">Choose its original scene.json, or explore an authored example.</p><div class="pr-source-actions"><button type="button" id="pr-open-source">Open scene.json</button><button type="button" id="pr-example">Try example</button></div><input type="file" id="pr-source-file" accept=".json,application/json" aria-label="Open original BrainSNN scene JSON"><button type="button" class="pr-text-button" id="pr-clear-source" hidden>Clear this source</button></section>
      <section class="pr-panel"><div class="pr-panel-heading"><h3>Project brief</h3><span class="pr-step-number">02</span></div><div class="pr-fields"><label>Project name<input id="pr-title" maxlength="100" value="Room refresh" autocomplete="off"></label><label>What would you like to change?<textarea id="pr-goal" maxlength="3000" rows="4">Compare standard and upgraded wall and floor finishes while keeping the existing layout.</textarea></label><label>Constraints and known conditions<textarea id="pr-constraints" maxlength="2000" rows="2" placeholder="Keep existing services. Note access, exclusions or conditions to check."></textarea></label><div class="pr-field-pair"><label>Currency<select id="pr-currency"><option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>Budget, optional<input id="pr-budget" type="number" min="0" step=".01" placeholder="Not set"></label></div></div></section>
      <section class="pr-panel"><details id="pr-rate-details"><summary><span>Your rate table</span></summary><p class="pr-subnote">Enter your own range per square metre. Missing or unreviewed rates remain unpriced.</p><div class="pr-rates" id="pr-rates"></div></details></section>
      <section class="pr-panel"><h3>Compare the options</h3><p>Local mode uses fixed finish templates and calculations. The AI team also reasons about your brief and critiques its proposal.</p><div class="pr-actions"><button type="button" class="pr-primary" id="pr-run-local" disabled>Compare locally</button><label class="pr-check"><input type="checkbox" id="pr-ai-consent"><span>Send this scene, brief and rates to BrainSNN for AI review. The model receives a compact project summary.</span></label><button type="button" class="pr-ai" id="pr-run-ai" disabled>Run AI team</button><button type="button" class="pr-secondary" id="pr-cancel" hidden>Cancel review</button></div><p id="pr-api-status" class="pr-subnote">Checking AI availability…</p><details class="pr-login" id="pr-login"><summary>Owner connection</summary><p class="pr-subnote">Use your BrainSNN processing passcode to open an owner session. The session is kept in this tab.</p><div class="pr-login-fields"><label>Passcode<input type="password" id="pr-passcode" autocomplete="current-password" maxlength="512"></label><button type="button" id="pr-connect">Connect</button></div><p id="pr-login-status" class="pr-subnote"></p></details><p id="pr-status" class="pr-run-status" role="status" aria-live="polite">Open a model to begin.</p></section>
    </aside><div class="pr-review-main"><section class="pr-preview" aria-label="Source model plan"><div class="pr-preview-header"><strong id="pr-plan-title">Your model, in context</strong><span id="pr-plan-basis">Source geometry stays unchanged</span></div><div class="pr-preview-canvas" id="pr-plan"><div class="pr-preview-empty"><div class="pr-empty-icon" aria-hidden="true">⌑</div><p>Start with a space.<br>Your model and selected scope will appear here.</p></div></div><div class="pr-preview-caption"><span class="pr-observed-key">Compiled component envelopes</span><span>Unknown conditions stay open</span></div></section>
      <div id="pr-results"><section class="pr-empty-results"><p class="pr-kicker">A SHARED BRIEF. A CLEAR DECISION.</p><h3>Two options. Their numbers. Your call.</h3><p>Add a model and your brief. The review will keep selected work, missing evidence and pricing assumptions visible.</p><div class="pr-empty-steps"><span><b>01</b>Compare scope</span><span><b>02</b>Check quantities</span><span><b>03</b>Approve a proposal</span></div></section></div>
      <details class="pr-panel" id="pr-history-details"><summary>Decision history <span id="pr-history-count">0 events</span></summary><div class="pr-history" id="pr-history"></div></details><p class="pr-origin" id="pr-origin">A review workspace, not a final quote or a physical validation.</p>
    </div></div>`;

  const initialRates=defaultReviewRates();
  $('#pr-rates').innerHTML=initialRates.map(rate=>`<div class="pr-rate-row" data-rate="${esc(rate.id)}"><div class="pr-rate-title"><strong>${esc(rate.label)}</strong><span>per m²</span></div><label class="pr-subnote">Finish / work description<input data-rate-label maxlength="100" value="${esc(rate.label)}"></label><div class="pr-rate-inputs"><label>Low<input data-rate-low type="number" min="0" step=".01" placeholder="—" aria-label="${esc(rate.label)} low rate"></label><label>High<input data-rate-high type="number" min="0" step=".01" placeholder="—" aria-label="${esc(rate.label)} high rate"></label></div><label class="pr-subnote">Rate source<input data-rate-source maxlength="240" placeholder="Your supplier or cost sheet"></label><label class="pr-subnote">Rate date<input data-rate-date type="date"></label><label class="pr-check"><input data-rate-reviewed type="checkbox"><span>I reviewed this rate range.</span></label></div>`).join('');

  const current=generation=>alive&&generation===epoch;
  function status(message,error=false) {if(!alive)return;$('#pr-status').textContent=message;$('#pr-status').dataset.error=String(error);onStatus(message,error);}
  function record(role,summary,detail='') {
    history.push({role,summary,detail,at:new Date().toISOString()});if(history.length>60)history.shift();renderHistory();
  }
  function renderHistory() {
    $('#pr-history-count').textContent=`${history.length} event${history.length===1?'':'s'}`;
    $('#pr-history').innerHTML=history.map((entry,i)=>`<div class="pr-history-item"><span class="pr-history-index">${String(i+1).padStart(2,'0')}</span><div><strong>${esc(entry.role)} · ${esc(entry.summary)}</strong>${entry.detail?`<p>${esc(entry.detail)}</p>`:''}<small>${esc(when(entry.at))}</small></div></div>`).join('')||'<p class="pr-subnote">Your source changes, completed reviews and approvals will appear here.</p>';
  }
  function mode(label,state='draft') {$('#pr-mode').textContent=label;$('#pr-mode').dataset.state=state;}
  function controls() {
    if(!alive)return;
    const busy=Boolean(pending||sourcePending);
    $('#pr-run-local').disabled=!source||busy;
    $('#pr-run-ai').disabled=!source||busy||apiStatus?.available!==true;
    $('#pr-cancel').hidden=!pending;
    $('#pr-open-source').disabled=busy;
    $('#pr-example').disabled=busy;
    $('#pr-clear-source').hidden=!source;
    const quick=$('[data-pr-quick-run]');if(quick)quick.disabled=!source||busy;
  }
  function emptyResults() {
    $('#pr-results').innerHTML=`<section class="pr-empty-results"><p class="pr-kicker">READY FOR YOUR BRIEF</p><h3>Compare the next possibilities.</h3><p>Run a local comparison or the AI team. All quantities will come from this model; prices will use only your reviewed rates.</p>${source?'<button type="button" class="pr-primary" data-pr-quick-run>Compare locally →</button>':''}</section>`;
  }
  function invalidate(message='Inputs changed. Run the comparison again.') {
    if(!alive)return;
    epoch++;decisionGeneration++;pending?.abort();pending=null;report=null;input=null;approval=null;selected='option-a';
    if(source){emptyResults();if(preview)$('#pr-plan').innerHTML=planSVG(preview,null,selected);}
    mode('DRAFT WORKSPACE');controls();status(message);
  }
  function brief() {
    const budget=$('#pr-budget').value;
    return {title:$('#pr-title').value,goal:$('#pr-goal').value,constraints:$('#pr-constraints').value,currency:$('#pr-currency').value,budget:budget===''?null:Number(budget)};
  }
  function rates() {
    return initialRates.map(rate=>{const row=host.querySelector(`[data-rate="${rate.id}"]`),low=row.querySelector('[data-rate-low]').value,high=row.querySelector('[data-rate-high]').value;
      return {...rate,label:row.querySelector('[data-rate-label]').value,low:low===''?null:Number(low),high:high===''?null:Number(high),source:row.querySelector('[data-rate-source]').value,asOf:row.querySelector('[data-rate-date]').value,reviewed:row.querySelector('[data-rate-reviewed]').checked};
    });
  }
  function request() {if(!source)throw Error('Open a compiled model first.');return {sceneText:source.sceneText,sourceLabel:source.sourceLabel,brief:brief(),rates:rates()};}
  function token() {return sessionToken||getToken();}

  async function setSource(value) {
    if(!alive)return;
    sourceReadGeneration++;
    invalidate('Checking this model and its source binding…');sourcePending?.abort();const controller=new AbortController();sourcePending=controller;
    source=null;preview=null;const generation=epoch;controls();
    try {
      if(typeof value?.sceneText!=='string'||new TextEncoder().encode(value.sceneText).length>SOURCE_LIMIT)throw Error('Use an original scene.json up to 256 KiB.');
      if(value.sceneSha256&&await digest(value.sceneText)!==value.sceneSha256)throw Error('This scene does not match its original artifact hash.');
      const sourceLabel=text(value.sourceLabel||value.label||'Imported building model',160);
      const normalized=await prepareProjectReview({sceneText:value.sceneText,sourceLabel,brief:{title:'Source preview',goal:'Review the original source geometry.',constraints:'',currency:'CAD',budget:null},rates:defaultReviewRates()});
      if(!current(generation)||controller.signal.aborted)return;
      source={sceneText:value.sceneText,sourceLabel};preview=normalized;
      $('#pr-source-name').textContent=normalized.source.label;
      $('#pr-source-meta').textContent=normalized.source.origin==='authored-example'?'Authored practice model. No real capture or measured result.':`${normalized.components.length} source components · compiled geometry in metres · dimensions unverified`;
      $('#pr-plan').innerHTML=planSVG(normalized,null,selected);$('#pr-plan-title').textContent='Your source model';
      $('#pr-plan-basis').textContent=normalized.source.origin==='authored-example'?'Authored example':'Compiled geometry · unverified';
      $('#pr-origin').innerHTML=`Original model preserved. Source SHA-256 <code>${esc(normalized.source.sceneSha256)}</code>`;
      emptyResults();mode(normalized.source.origin==='authored-example'?'AUTHORED EXAMPLE':'SOURCE READY',normalized.source.origin==='authored-example'?'authored':'ready');
      record('Source','Model opened',`${normalized.source.label}. ${normalized.components.length} compiled components. Geometry remains unverified.`);
      status('Source ready. Review your brief and rates, then compare the options.');lastInputNotice=false;
    } catch(error) {
      if(current(generation)&&!controller.signal.aborted){source=null;preview=null;$('#pr-source-name').textContent='Model could not be opened.';$('#pr-source-meta').textContent='Use an original metric BrainSNN scene.json with stable component IDs.';$('#pr-plan').innerHTML='<div class="pr-preview-empty"><p>No model is active. Choose another source.</p></div>';emptyResults();status(error.message,true);}
      if(current(generation)&&!controller.signal.aborted)throw error;
    } finally {if(sourcePending===controller)sourcePending=null;controls();}
  }

  async function loadFile(file) {
    if(!file)return;
    clear();status('Reading the selected source…');
    const reading=++sourceReadGeneration;
    try {
      if(file.size>SOURCE_LIMIT)throw Error('Use a scene.json up to 256 KiB.');
      const sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
      if(!alive||reading!==sourceReadGeneration)return;
      await setSource({sceneText:sourceText,sourceLabel:file.name});
    } catch(error) {if(alive&&reading===sourceReadGeneration)status(error.message,true);}
  }

  async function example() {
    try {await setSource({sceneText:demoSceneText(),sourceLabel:'Example room · authored practice model'});}
    catch(error){status(error.message,true);}
  }

  function clear() {
    if(!alive)return;
    sourceReadGeneration++;
    invalidate('Source cleared. Open a model to begin.');sourcePending?.abort();sourcePending=null;source=null;preview=null;history.length=0;renderHistory();
    $('#pr-source-name').textContent='Open a compiled building model.';$('#pr-source-meta').textContent='Choose its original scene.json, or explore an authored example.';
    $('#pr-plan').innerHTML='<div class="pr-preview-empty"><div class="pr-empty-icon" aria-hidden="true">⌑</div><p>Start with a space.<br>Your model and selected scope will appear here.</p></div>';
    $('#pr-source-file').value='';$('#pr-origin').textContent='A review workspace, not a final quote or a physical validation.';emptyResults();controls();
  }

  function renderResults() {
    if(!report||!input)return;
    const option=report.options.find(o=>o.id===selected)||report.options[0];selected=option.id;
    const isAI=report.execution?.mode==='ai-team';
    mode(approval?'PRELIMINARY APPROVAL':isAI?'AI REVIEW COMPLETE':'LOCAL COMPARISON',approval?'approved':'ready');
    $('#pr-plan').innerHTML=planSVG(input,report,selected);$('#pr-plan-title').textContent=option.title;
    const totals=o=>o.subtotal?`${money(o.subtotal.low,report.currency)} – ${money(o.subtotal.high,report.currency)}`:'Rates needed';
    const findings=[...(report.findings||[]),...(report.questions||[]),...(option.questions||[]),...(report.reviews?.reviewer?.findings||[])];
    const unique=[...new Map(findings.map(f=>[findingText(f),f])).values()].filter(f=>findingText(f));
    $('#pr-results').innerHTML=`<div class="pr-results-heading"><div><h2>Compare your options</h2><p>${isAI?'AI suggestions, checked against the source and calculated rates.':'Fixed local templates. No AI model was called.'}</p></div><span class="pr-pill">${esc(report.currency)} · PRELIMINARY</span></div>
      <div class="pr-options">${report.options.map((o,index)=>`<article class="pr-option" data-selected="${o.id===selected}"><div class="pr-option-label"><span>OPTION ${index===0?'A':'B'}</span><span>${o.id===selected?'SELECTED':'COMPARE'}</span></div><h3>${esc(o.title)}</h3><p>${esc(o.summary)}</p><div class="pr-option-cost"><strong>${esc(totals(o))}</strong><span>${o.complete?'Selected finish lines only · before tax':`${o.unpricedCount} line${o.unpricedCount===1?'':'s'} without a reviewed rate`}</span>${!o.complete&&o.knownSubtotal?.high?`<span>Priced lines: ${money(o.knownSubtotal.low,report.currency)} – ${money(o.knownSubtotal.high,report.currency)}</span>`:''}</div><ul><li>${o.items.length} component line${o.items.length===1?'':'s'}</li><li>${o.complete?'Every selected line has a reviewed rate.':'The full selected subtotal is withheld.'}</li><li>${({within:'Selected subtotal is within your budget.',over:'Selected subtotal exceeds your budget.',overlap:'Budget falls within the selected price range.',incomplete:'Budget comparison awaits complete pricing.','not-set':'No budget limit supplied.'})[o.budgetStatus]||'Preliminary scope for review.'}</li></ul><button type="button" data-pr-select="${esc(o.id)}" aria-pressed="${o.id===selected}">${o.id===selected?'Selected for review':'Review this option'}</button></article>`).join('')}</div>
      <section class="pr-panel"><div class="pr-panel-heading"><h3>Check the quantities</h3><span class="pr-step-number">${option.items.length} LINES</span></div><p>Each line refers to a component in the original model. Wall areas deduct valid openings; quantities remain inferred.</p><p class="pr-table-scroll-hint" id="pr-quantity-scroll-hint">Swipe or use arrow keys to compare all columns.</p><div class="pr-quantity-wrap" role="region" tabindex="0" aria-label="Selected scope quantities and rates" aria-describedby="pr-quantity-scroll-hint"><table class="pr-quantity-table"><caption>${esc(option.title)} · selected finish scope</caption><thead><tr><th>Component / work</th><th>Area</th><th>Rate / m²</th><th>Amount</th></tr></thead><tbody>${option.items.map(item=>`<tr><td><strong>${esc(item.label)}</strong><small>${esc(item.rateLabel)}<br>${esc(surfaceBasis(item))}</small>${sourceDetailsHTML(item)}</td><td>${number(item.quantity)} m²<small>${esc(item.evidence)}</small></td><td>${item.rateReviewed?`${money(item.rateLow,report.currency)} – ${money(item.rateHigh,report.currency)}`:'Not reviewed'}<small>${esc(item.rateSource||'No source')} ${esc(item.rateDate||'')}</small></td><td>${item.priced?`${money(item.low,report.currency)} – ${money(item.high,report.currency)}`:'Unpriced'}</td></tr>`).join('')}</tbody></table></div><p class="pr-subnote">A complete selected subtotal does not mean a complete project estimate. Scope exclusions and unknown conditions remain below.</p></section>
      <section class="pr-panel" style="margin-top:18px"><div class="pr-panel-heading"><h3>What needs your judgment</h3><span class="pr-step-number">REVIEW</span></div>${report.reviews?.reviewer?.summary?`<p class="pr-kicker">FINAL REVIEW</p><p>${esc(report.reviews.reviewer.summary)}</p>`:''}<ul class="pr-caveats">${unique.map(f=>`<li>${f?.severity==='blocker'?'<strong>Resolve before proceeding</strong>':''}${esc(findingText(f))}</li>`).join('')||'<li>Review scope coverage and site conditions before using this proposal.</li>'}</ul>${initialEstimateHTML(report,true)}${option.assumptions.length?`<details style="margin-top:18px"><summary>Scope assumptions</summary><ul class="pr-caveats">${option.assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></details>`:''}<div class="pr-review-note"><p>These options cover selected wall and floor finish lines. Hidden conditions, structural work, services, permits, site logistics and taxes are outside this calculation unless separately scoped.</p></div></section>
      <section class="pr-panel pr-approval" data-approved="${Boolean(approval)}" style="margin-top:18px"><div class="pr-panel-heading"><h3>${approval?'Decision recorded':'Your decision'}</h3><span class="pr-step-number">${approval?'APPROVED':'HUMAN REVIEW'}</span></div><p>${approval?`${esc(approval.reviewer)} approved ${esc(option.title)} for preliminary review.`:'Choose an option, review the assumptions and record your preliminary approval.'}</p><div class="pr-fields"><label>Reviewer<input id="pr-reviewer" maxlength="100" autocomplete="name" value="${esc(approval?.reviewer||'')}"></label><label>Decision note<textarea id="pr-decision-note" maxlength="1000" rows="2" placeholder="Record the conditions or follow-up needed.">${esc(approval?.note||'')}</textarea></label></div><label class="pr-check"><input type="checkbox" id="pr-approval-check" ${approval?'checked':''}><span>I reviewed this scope and its assumptions. This is a preliminary decision, not a final quotation or certification of the model.</span></label><div class="pr-approval-actions"><button type="button" class="pr-primary" id="pr-approve">${approval?'Update preliminary approval':'Approve preliminary option'}</button><button type="button" id="pr-export-html">Download proposal</button><button type="button" id="pr-export-json">Save review JSON</button></div><p class="pr-subnote" id="pr-approval-status">${approval?'Approval is bound to this exact brief, source, rates and review.':'Downloads keep the draft status until you approve. Changing an input clears the decision.'}</p></section>`;
    $('#pr-origin').innerHTML=`${isAI?`AI team: ${esc(report.execution.model||'configured model')} · ${report.execution.callCount} calls.`:'Local templates and calculations.'} Source SHA-256 <code>${esc(input.source.sceneSha256)}</code><br>Review input <code>${esc(input.inputSha256)}</code>`;
  }

  async function runLocal() {
    invalidate('Calculating two local finish options…');const generation=epoch;
    try {
      const prepared=await prepareProjectReview(request());
      if(!current(generation))return;
      input=prepared;report=priceProposal(input,localProposal(input));renderResults();lastInputNotice=false;
      record('Local comparison','Two options calculated','Fixed scope templates and deterministic quantities. No AI model was called.');
      status('Local comparison ready. Review rates, open questions and the selected scope.');
    }catch(error){if(current(generation))status(error.message,true);}
    finally{controls();}
  }

  async function checkedAIReport(prepared,value) {
    if(!value||value.inputSha256!==prepared.inputSha256||!Array.isArray(value.options))throw Error('The AI result belongs to different project inputs.');
    const proposal=validateProposal(prepared,{options:value.options.map(o=>({id:o.id,title:o.title,summary:o.summary,items:o.items.map(i=>({componentId:i.componentId,rateId:i.rateId})),assumptions:o.assumptions,questions:o.questions})),questions:value.questions});
    const calculated=priceProposal(prepared,proposal);
    for(const key of Object.keys(calculated))if(jsonStable(calculated[key])!==jsonStable(value[key]))throw Error('The AI result does not match the local quantity and rate checks.');
    if(value.execution?.mode!=='ai-team'||!Number.isInteger(value.execution.callCount)||value.execution.callCount<3||value.execution.callCount>4||!Array.isArray(value.transcript)||value.transcript.length!==value.execution.callCount||value.transcript.some(t=>t.inputSha256!==prepared.inputSha256))throw Error('The AI service returned an incomplete execution record.');
    // Reuse the complete core receipt check: role order, critique schema,
    // proposal hashes and final calculation binding must all pass before display.
    await exportReviewJSON(prepared,value,null);
    return value;
  }

  async function runAI() {
    if(!$('#pr-ai-consent').checked){status('Confirm sending the scene, brief and rate table to BrainSNN before running the AI team.',true);$('#pr-ai-consent').focus();return;}
    if(!token()){ $('#pr-login').open=true;$('#pr-passcode').focus();status('Connect the owner session to run the AI team.',true);return; }
    invalidate('The AI team is reviewing your brief. Calculations will be checked before the result appears.');
    const generation=epoch,controller=new AbortController();pending=controller;const timeout=setTimeout(()=>controller.abort(new Error('The AI review exceeded its time limit.')),AI_DEADLINE);controls();mode('AI TEAM WORKING','working');
    try {
      const original=request(),prepared=await prepareProjectReview(original);
      if(!current(generation)||controller.signal.aborted)return;
      const answer=await responseJSON(await fetch('/api/world/project-review',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`},credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,body:JSON.stringify({...original,consent:true,inputSha256:prepared.inputSha256})}));
      if(!current(generation)||controller.signal.aborted)return;
      const checked=await checkedAIReport(prepared,answer.report);
      if(!current(generation)||controller.signal.aborted)return;
      input=prepared;report=checked;renderResults();lastInputNotice=false;
      for(const turn of report.transcript)record(({ 'scope-planner':'Scope planner',estimator:'Estimator',reviewer:'Reviewer'})[turn.role]||'AI team',turn.stage==='revision'?'Proposal revised':turn.stage==='proposal'?'Options proposed':turn.stage==='estimate-review'?'Estimate reviewed':'Review completed',text(turn.summary,1800));
      status('AI review complete. Check both options and the reviewer’s findings before recording your decision.');
    } catch(error) {
      if(current(generation)){mode('DRAFT WORKSPACE');status(controller.signal.aborted?(controller.signal.reason?.message||'AI review cancelled.'):error.message,true);record('AI team','Review not completed',controller.signal.aborted?'The request was cancelled or timed out. No approval was recorded.':text(error.message,350));}
    } finally {clearTimeout(timeout);if(pending===controller)pending=null;controls();}
  }

  async function connect() {
    const passcode=$('#pr-passcode').value;if(!passcode){$('#pr-login-status').textContent='Enter the owner processing passcode.';return;}
    $('#pr-connect').disabled=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);connectionPending=controller;
    try {
      const answer=await responseJSON(await fetch('/api/world/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode}),credentials:'same-origin',cache:'no-store',signal:controller.signal}));
      if(answer.kind!=='owner'||typeof answer.token!=='string')throw Error('An owner session is required for the AI team.');
      if(!alive)return;sessionToken=answer.token;onConnect?.(answer.token);$('#pr-passcode').value='';$('#pr-login-status').textContent='Owner connected for this tab.';$('#pr-login').open=false;status('Owner connected. Confirm the data to send, then run the AI team.');
    } catch(error){if(alive)$('#pr-login-status').textContent=error.message||'Owner connection failed.';}
    finally {clearTimeout(timer);if(connectionPending===controller)connectionPending=null;if(alive)$('#pr-connect').disabled=false;}
  }

  async function approve() {
    if(approvalPending)return;
    const generation=epoch,decision=decisionGeneration,currentReport=report,currentInput=input;
    const details={optionId:selected,reviewer:$('#pr-reviewer').value,note:$('#pr-decision-note').value,acknowledged:$('#pr-approval-check').checked};
    approvalPending=true;$('#pr-approve').disabled=true;
    try {
      if(!currentInput||!currentReport)throw Error('Run a review first.');
      const next=await approveReview(currentInput,currentReport,details);
      if(!current(generation)||decisionGeneration!==decision||report!==currentReport||input!==currentInput)return;
      approval=next;decisionGeneration++;record('Human decision','Preliminary option approved',`${next.reviewer} selected ${report.options.find(o=>o.id===next.optionId).title}. ${next.note||''}`);renderResults();status('Your preliminary decision is recorded. The exported proposal will include its assumptions and source binding.');
    } catch(error) {if(current(generation)&&decisionGeneration===decision){$('#pr-approval-status').textContent=error.message;status(error.message,true);}}
    finally {approvalPending=false;if(alive&&$('#pr-approve'))$('#pr-approve').disabled=false;}
  }

  function download(name,value,type) {
    const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function exportFile(kind) {
    const generation=epoch,decision=decisionGeneration,currentReport=report,currentInput=input,currentApproval=approval;
    const unchanged=()=>current(generation)&&decisionGeneration===decision&&report===currentReport&&input===currentInput&&approval===currentApproval;
    try {
      if(!currentInput||!currentReport)throw Error('Run a review before exporting.');
      if(currentApproval){await validateApproval(currentInput,currentReport,currentApproval);if(!unchanged())return;}
      const receipt=await exportReviewJSON(currentInput,currentReport,currentApproval);
      if(!unchanged())return;
      if(kind==='json')download('brainsnn-project-review.json',receipt,'application/json');
      else {
        const plain=await exportReviewMarkdown(currentInput,currentReport,currentApproval);if(!unchanged())return;
        download('brainsnn-project-proposal.html',reportHTML(currentInput,currentReport,currentApproval,receipt,plain),'text/html');
      }
      record('Export',currentApproval?'Approved preliminary proposal saved':'Draft review saved',kind==='json'?'Source-bound JSON review.':'Standalone readable HTML proposal, with text brief and source receipt.');
      status(`${currentApproval?'Approved preliminary proposal':'Draft review'} downloaded.`);
    }catch(error){if(current(generation))status(error.message,true);}
  }

  host.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||!host.contains(button))return;
    if(button.id==='pr-open-source'){onSourceIntent();$('#pr-source-file').click();}
    else if(button.id==='pr-example'){onSourceIntent();void example();}
    else if(button.id==='pr-clear-source'){onSourceIntent();clear();}
    else if(button.id==='pr-run-local'||button.hasAttribute('data-pr-quick-run'))void runLocal();
    else if(button.id==='pr-run-ai')void runAI();
    else if(button.id==='pr-cancel'){invalidate('Review cancelled. No decision was recorded.');record('Review','Cancelled');}
    else if(button.id==='pr-connect')void connect();
    else if(button.id==='pr-approve')void approve();
    else if(button.id==='pr-export-html')void exportFile('html');
    else if(button.id==='pr-export-json')void exportFile('json');
    else if(button.dataset.prSelect&&report){if(selected!==button.dataset.prSelect){decisionGeneration++;selected=button.dataset.prSelect;approval=null;record('Selection','Option selected',report.options.find(o=>o.id===selected)?.title||'');renderResults();status('Option selected. Review the assumptions before recording approval.');}}
  },{signal:listeners.signal});
  host.addEventListener('input',event=>{
    const target=event.target;
    if(target.closest('#pr-rates')||['pr-title','pr-goal','pr-constraints','pr-currency','pr-budget'].includes(target.id)){
      if(target.closest('[data-rate]')&&!target.hasAttribute('data-rate-reviewed'))target.closest('[data-rate]').querySelector('[data-rate-reviewed]').checked=false;
      invalidate();if(!lastInputNotice){record('Inputs','Brief or rate table changed','Earlier calculations and approval were cleared.');lastInputNotice=true;}
    } else if(['pr-reviewer','pr-decision-note','pr-approval-check'].includes(target.id)){
      decisionGeneration++;
      if(approval){
        approval=null;mode('DECISION CHANGED');
        const card=$('.pr-approval');card.dataset.approved='false';card.querySelector('h3').textContent='Decision changed';card.querySelector('.pr-step-number').textContent='HUMAN REVIEW';card.querySelector(':scope > p').textContent='Review your revised decision details, then record preliminary approval again.';
        $('#pr-approve').textContent='Approve preliminary option';$('#pr-approval-status').textContent='Decision changed. Approve again before exporting an approved proposal.';
      }
    }
  },{signal:listeners.signal});
  $('#pr-source-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file){onSourceIntent();void loadFile(file);}},{signal:listeners.signal});
  $('#pr-passcode').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void connect();}},{signal:listeners.signal});
  const statusController=new AbortController(),statusTimer=setTimeout(()=>statusController.abort(),10000);
  void (async()=>{
    try {apiStatus=await responseJSON(await fetch('/api/world/project-review',{cache:'no-store',credentials:'same-origin',signal:statusController.signal}));}
    catch{apiStatus={available:false};}
    finally {clearTimeout(statusTimer);if(alive){$('#pr-api-status').textContent=apiStatus.available?'AI team available for an owner session. Your data is sent only when you run it.':'AI team is not configured on this site. Local comparison remains available.';controls();}}
  })();
  renderHistory();
  return {setSource,clear,example,cancel(){if(sourcePending)clear();else if(pending)invalidate('Review cancelled. Your source and inputs are kept.');},get hasSource(){return Boolean(source);},get sourceSha256(){return preview?.source.sceneSha256||null;},dispose(){alive=false;epoch++;decisionGeneration++;pending?.abort();sourcePending?.abort();connectionPending?.abort();statusController.abort();listeners.abort();sessionToken=null;host.replaceChildren();}};
}
