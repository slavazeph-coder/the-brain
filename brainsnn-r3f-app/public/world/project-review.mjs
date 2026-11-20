/** Bounded preliminary scope reviews over immutable compiler geometry.
 * Language models select references and write commentary. This module owns
 * quantities, prices, source binding and the explicit human review receipt.
 */
import {sceneBinding, sceneInventory, sha256} from './operational-twin.mjs';

export const REVIEW_SCHEMA = 'brainsnn.project-review.v1';
export const REVIEW_INPUT_SCHEMA = 'brainsnn.project-review-input.v1';
export const REVIEW_LIMITS = Object.freeze({sceneBytes:256*1024,components:128,items:32,rates:16,reportBytes:256*1024,packageBytes:512*1024});
export const REVIEW_VALIDATION = Object.freeze({metricVerified:false,certified:false,physicalRobotValidated:false,finalQuotation:false});
const currencies = new Set(['CAD','USD','EUR','GBP']);
const tasks = new Set(['wall-finish','floor-finish']);
const prepared = new WeakSet();
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const bytes = value => new TextEncoder().encode(value).byteLength;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const keys = (value, allowed, name) => { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`Unsupported ${name} fields.`); };
const list = (value, max, name) => { if (!Array.isArray(value) || value.length > max) fail(`${name} must be a list of at most ${max}.`); return value; };
const number = (value, low, high, name) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`Invalid ${name}.`); return value; };
const text = (value, max, name, empty=false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail(`Invalid ${name}.`);
  return value.trim();
};
const id = value => { text(value,64,'rate ID'); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) fail('Invalid rate ID.'); return value; };
const strings = (value, name) => list(value,12,name).map(v=>text(v,500,name));
const unique = values => new Set(values).size === values.length;
const canonical = value => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
const equal = (a,b) => canonical(a) === canonical(b);
const cents = value => { const result = Math.round((value + Number.EPSILON) * 100); if (!Number.isSafeInteger(result) || result > 1e14) fail('Calculated price exceeds the supported amount.'); return result; };
function finiteJSON(value, maxBytes) {
  const walk = (item, depth=0) => {
    if (depth > 32) fail('Review JSON is too deeply nested.');
    if (typeof item === 'number' && !Number.isFinite(item)) fail('Use finite JSON.');
    if (item === null || ['string','number','boolean'].includes(typeof item)) return;
    if (!Array.isArray(item) && !object(item)) fail('Use plain JSON.');
    Object.values(item).forEach(child=>walk(child,depth+1));
  };
  walk(value);
  if (bytes(JSON.stringify(value)) > maxBytes) fail('Review exceeds its byte limit.');
}
function calendarDate(value, required=false) {
  if (value === '' && !required) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Use a valid rate date.');
  const parsed = new Date(value+'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) fail('Use a valid rate date.');
  return value;
}
function normalizeBrief(value) {
  keys(value,['title','goal','constraints','currency','budget'],'project brief');
  const currency=value.currency??'CAD'; if (!currencies.has(currency)) fail('Choose CAD, USD, EUR or GBP.');
  return {title:text(value.title,120,'project title'),goal:text(value.goal,3000,'project goal'),constraints:text(value.constraints??'',2000,'project constraints',true),currency,budget:value.budget==null?null:number(value.budget,0,1e10,'project budget')};
}
function normalizeRates(value) {
  const result=list(value,REVIEW_LIMITS.rates,'Rates').map(rate=>{
    keys(rate,['id','label','task','low','high','source','asOf','reviewed'],'rate');
    if (!tasks.has(rate.task) || typeof rate.reviewed!=='boolean') fail('Use a supported rate task and explicit review status.');
    const low=rate.low==null?null:number(rate.low,0,1e6,'low unit rate'),high=rate.high==null?null:number(rate.high,0,1e6,'high unit rate');
    if (low!==null && high!==null && high<low) fail('The high rate must be at least the low rate.');
    const source=text(rate.source??'',500,'rate source',!rate.reviewed),asOf=calendarDate(rate.asOf??'',rate.reviewed);
    if (rate.reviewed && (low===null||high===null)) fail('Reviewed rates require both amounts, a source and a date.');
    return {id:id(rate.id),label:text(rate.label,100,'rate label'),task:rate.task,unit:'m2',low,high,source,asOf,reviewed:rate.reviewed};
  });
  if (!unique(result.map(rate=>rate.id))) fail('Rate IDs must be unique.');
  return result;
}
export function defaultReviewRates() {
  return [['wall-standard','Wall finish · standard','wall-finish'],['wall-premium','Wall finish · alternative','wall-finish'],['floor-standard','Floor finish · standard','floor-finish'],['floor-premium','Floor finish · alternative','floor-finish']].map(([id,label,task])=>({id,label,task,low:null,high:null,source:'',asOf:'',reviewed:false}));
}
function openingDeductions(scene) {
  const walls=new Map((scene.walls??[]).map(wall=>[wall.name,wall])),holes=list(scene.openings??[],32,'Hosted openings'),result=new Map();
  if (walls.size!==(scene.walls??[]).length) fail('Wall source names must be unique.');
  if (!unique(holes.map(hole=>hole.id))) fail('Opening IDs must be unique.');
  for (const hole of holes) {
    const wall=walls.get(hole.hostWall);
    if (!wall || hole.reviewed!==true || !['door','opening'].includes(hole.kind)) fail('Openings require an existing wall and explicit geometric review.');
    const host={centre:wall.centre,size:wall.size,yaw_degrees:wall.yaw_degrees??0};
    if (!equal(hole.host,host) || hole.hostComponentId!==wall.componentId) fail('Opening host geometry or identity is stale.');
    for (const [key,low,high] of [['offsetMeters',0,1e5],['widthMeters',.05,100],['heightMeters',.05,100],['sillMeters',0,100]]) number(hole[key],low,high,key);
    if (hole.offsetMeters+hole.widthMeters>wall.size[0]+1e-9 || hole.sillMeters+hole.heightMeters>wall.size[1]+1e-9 || hole.kind==='door'&&hole.sillMeters!==0) fail('Opening does not fit its host wall.');
    result.set(hole.hostWall,(result.get(hole.hostWall)??0)+hole.widthMeters*hole.heightMeters);
  }
  for (let i=0;i<holes.length;i++) for (let j=i+1;j<holes.length;j++) {
    const a=holes[i],b=holes[j];
    if (a.hostWall===b.hostWall && Math.min(a.offsetMeters+a.widthMeters,b.offsetMeters+b.widthMeters)-Math.max(a.offsetMeters,b.offsetMeters)>1e-9 && Math.min(a.sillMeters+a.heightMeters,b.sillMeters+b.heightMeters)-Math.max(a.sillMeters,b.sillMeters)>1e-9) fail('Hosted openings must not overlap.');
  }
  return result;
}

/** Always call at a trust boundary; normalized quantities sent by a client are not authority. */
export async function prepareProjectReview(request) {
  finiteJSON(request,REVIEW_LIMITS.sceneBytes+32*1024);
  keys(request,['sceneText','sourceLabel','brief','rates'],'project review request');
  if (typeof request.sceneText!=='string' || bytes(request.sceneText)>REVIEW_LIMITS.sceneBytes) fail('Scene JSON exceeds 256 KiB.');
  // Snapshot caller data synchronously before the first digest yields.
  const sceneText=request.sceneText,sourceLabel=text(request.sourceLabel??'Building model',160,'source label'),brief=normalizeBrief(clone(request.brief)),rates=normalizeRates(clone(request.rates));
  let scene; try { scene=JSON.parse(sceneText); } catch { fail('Open a valid scene JSON document.'); }
  finiteJSON(scene,REVIEW_LIMITS.sceneBytes);
  const inventory=sceneInventory(scene);
  if (inventory.length>REVIEW_LIMITS.components) fail('Project reviews support at most 128 components. Select a smaller scene.');
  const sceneSha256=await sha256(sceneText),binding=sceneBinding(scene,sceneSha256);
  if (scene.cloudPointsSha256!==undefined && scene.cloudPointsSha256!==binding.sourceSha256) fail('Scene and component graph have different source hashes.');
  if (!unique(inventory.filter(p=>p.kind!=='opening').map(p=>p.sourceName))) fail('Internal component names must be unique.');
  const deductions=openingDeductions(scene);
  const components=inventory.map(part=>{
    // A user-editable display label cannot turn a cabinet into a floor takeoff.
    const floor=part.kind==='object'&&part.sourceName==='floor_observed';
    const kind=floor?'floor':part.kind,task=kind==='wall'?'wall-finish':floor?'floor-finish':null;
    let quantity=null;
    if (task) {
      if (!part.size) fail('A priced surface needs compiled dimensions.');
      const gross=kind==='wall'?part.size[0]*part.size[1]:part.size[0]*part.size[2],openingDeduction=kind==='wall'?(deductions.get(part.sourceName)??0):0;
      const value=number(Math.max(0,gross-openingDeduction),0,1e8,'surface quantity');
      quantity={value,unit:'m2',gross,openingDeduction,basis:kind==='wall'?'compiled-net-wall-face':'compiled-floor-envelope',evidence:'inferred'};
    }
    return {componentId:part.componentId,sourceName:part.sourceName,label:part.label,kind,centre:part.centre,size:part.size,yaw:part.yaw,task,quantity};
  });
  const origin=scene.scale?.source==='authored-example'||scene.componentGraph.namespaceBasis==='legacy-scene-geometry-sha256'&&scene.walls?.every(w=>w.provenance==='authored-example')?'authored-example':'compiled-model';
  const source={...binding,label:sourceLabel,declaredSource:text(typeof scene.source==='string'?scene.source:'Compiler scene',500,'declared source'),origin,validation:{...REVIEW_VALIDATION}};
  const body={schema:REVIEW_INPUT_SCHEMA,source,components,brief,currency:brief.currency,rates};
  const input={...body,inputSha256:await sha256(canonical(body))};
  freeze(input);prepared.add(input);return input;
}
function requireInput(input) { if (!prepared.has(input)) fail('Prepare the original project request before reviewing it.'); return input; }
export async function reviewInputHash(input) { requireInput(input);const {inputSha256,...body}=input;return sha256(canonical(body)); }

export function validateProposal(input,value) {
  requireInput(input);finiteJSON(value,64*1024);keys(value,['options','questions'],'proposal');
  const options=list(value.options,2,'Options');if (options.length!==2 || !unique(options.map(o=>o.id)) || !options.every(o=>['option-a','option-b'].includes(o.id))) fail('Provide exactly option-a and option-b.');
  const components=new Map(input.components.map(c=>[c.componentId,c])),rates=new Map(input.rates.map(r=>[r.id,r]));
  const result=options.map(option=>{
    keys(option,['id','title','summary','items','assumptions','questions'],'option');
    const items=list(option.items,REVIEW_LIMITS.items,'Option items').map(item=>{
      keys(item,['componentId','rateId'],'scope item');
      const component=components.get(item.componentId),rate=rates.get(item.rateId);
      if (!component || !rate || !component.quantity || rate.task!==component.task) fail('Select an existing component and compatible rate.');
      return {componentId:component.componentId,rateId:rate.id};
    });
    if (!unique(items.map(item=>item.componentId))) fail('A component may appear only once per option.');
    return {id:option.id,title:text(option.title,100,'option title'),summary:text(option.summary,1200,'option summary'),items,assumptions:strings(option.assumptions,'assumptions'),questions:strings(option.questions,'questions')};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  return {options:result,questions:strings(value.questions,'proposal questions')};
}

/** Fixed templates, explicitly without AI execution or inferred brief interpretation. */
export function localProposal(input) {
  requireInput(input);
  const ratesFor=task=>input.rates.filter(r=>r.task===task),wallRates=ratesFor('wall-finish'),floorRates=ratesFor('floor-finish');
  const walls=input.components.filter(c=>c.task==='wall-finish'),floors=input.components.filter(c=>c.task==='floor-finish');
  const use=(components,rate)=>rate?components.slice(0,REVIEW_LIMITS.items).map(c=>({componentId:c.componentId,rateId:rate.id})):[];
  const a=wallRates.length&&walls.length?use(walls,wallRates[0]):use(floors,floorRates[0]);
  const b=[...use(walls,wallRates[1]??wallRates[0]),...use(floors,floorRates[1]??floorRates[0])].slice(0,REVIEW_LIMITS.items);
  const questions=['Confirm which model surfaces belong in the scope and check their dimensions on site.','What preparation, removal, access, waste and disposal work should be separately allowed for?'];
  if (walls.length+floors.length>REVIEW_LIMITS.items) questions.push('This local template is limited to 32 selected surfaces; review the remaining surfaces separately.');
  if (!wallRates.length&&walls.length || !floorRates.length&&floors.length) questions.push('Add a compatible rate row to include the remaining surface types.');
  return validateProposal(input,{options:[
    {id:'option-a',title:'Refresh selected finishes',summary:'A fixed local template for the listed wall faces, or the floor when no wall rate is available. Review this scope against your brief.',items:a,assumptions:['Existing layout is retained. No structural or service changes are included.','One face of each selected wall is counted. Compiled dimensions remain provisional.'],questions:[]},
    {id:'option-b',title:'Renew walls and floor',summary:'A fixed local template combining available wall and floor finishes using the alternative rate rows where supplied.',items:b,assumptions:['The listed floor is a compiled envelope; its full coverage and finish condition need review.','Only listed surfaces and unit rates are included.'],questions:[]}
  ],questions});
}
export const createLocalProposal=localProposal;

export function priceProposal(input,value) {
  requireInput(input);const proposal=validateProposal(input,value),components=new Map(input.components.map(c=>[c.componentId,c])),rates=new Map(input.rates.map(r=>[r.id,r]));
  const options=proposal.options.map(option=>{
    let lowCents=0,highCents=0;
    const items=option.items.map(item=>{
      const c=components.get(item.componentId),r=rates.get(item.rateId),priced=r.reviewed&&r.low!==null&&r.high!==null;
      const low=priced?cents(c.quantity.value*r.low):null,high=priced?cents(c.quantity.value*r.high):null;
      if (priced) {lowCents+=low;highCents+=high;}
      return {...item,label:c.label,task:r.task,quantity:c.quantity.value,unit:'m2',quantityBasis:c.quantity.basis,evidence:'inferred',rateLabel:r.label,rateLow:r.low,rateHigh:r.high,rateSource:r.source,rateDate:r.asOf,rateReviewed:r.reviewed,priced,low:low===null?null:low/100,high:high===null?null:high/100};
    });
    if (!Number.isSafeInteger(lowCents)||!Number.isSafeInteger(highCents)) fail('Subtotal exceeds the supported amount.');
    const unpricedCount=items.filter(item=>!item.priced).length,complete=items.length>0&&unpricedCount===0,knownSubtotal={low:lowCents/100,high:highCents/100};
    const budgetStatus=input.brief.budget===null?'not-set':!complete?'incomplete':knownSubtotal.low>input.brief.budget?'over':knownSubtotal.high<=input.brief.budget?'within':'overlap';
    return {...option,items,knownSubtotal,subtotal:complete?clone(knownSubtotal):null,complete,unpricedCount,budgetStatus};
  });
  const findings=[{code:'dimensions-provisional',severity:'review',message:'Quantities use compiled geometry. Independent physical dimensions and coverage have not been established by this review.'},{code:'selected-scope-only',severity:'review',message:'Amounts cover listed surfaces and approved unit rates only. Preparation, removals, hidden conditions, taxes and other work need explicit scope review.'}];
  if (input.source.origin==='authored-example') findings.push({code:'authored-example',severity:'info',message:'This is an authored example, not a captured or measured customer space.'});
  if (!input.components.some(c=>c.task==='floor-finish')) findings.push({code:'no-floor-quantity',severity:'review',message:'No fixed compiler floor component is available; no floor or ceiling quantity was inferred.'});
  if (options.some(o=>!o.items.length)) findings.push({code:'empty-scope',severity:'review',message:'An option has no priced surface scope; a zero known subtotal is not an estimate.'});
  if (options.some(o=>o.unpricedCount)) findings.push({code:'unpriced-items',severity:'review',message:'Some listed items lack approved dated rates. Known subtotals are partial amounts, not complete estimates.'});
  return {schema:REVIEW_SCHEMA,inputSha256:input.inputSha256,source:clone(input.source),brief:clone(input.brief),currency:input.currency,options,questions:clone(proposal.questions),findings,validation:{...REVIEW_VALIDATION}};
}

function isoTime(value) {
  if (typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) fail('Invalid review timestamp.');
  return Date.parse(value);
}
function critique(input,value) {
  keys(value,['summary','findings','needsRevision','recommendedOptionId'],'team critique');
  text(value.summary,1200,'team summary');
  if (typeof value.needsRevision!=='boolean'||value.recommendedOptionId!==null&&!['option-a','option-b'].includes(value.recommendedOptionId)) fail('Invalid team recommendation.');
  const componentIds=new Set(input.components.map(c=>c.componentId));
  for (const finding of list(value.findings,16,'Team findings')) {
    keys(finding,['severity','message','componentIds','optionIds'],'team finding');
    if (!['info','warning','blocker'].includes(finding.severity)) fail('Invalid finding severity.');
    text(finding.message,500,'team finding');
    if (!unique(list(finding.componentIds,16,'Finding components'))||finding.componentIds.some(id=>!componentIds.has(id))) fail('Finding refers to an unknown component.');
    if (!unique(list(finding.optionIds,2,'Finding options'))||finding.optionIds.some(id=>!['option-a','option-b'].includes(id))) fail('Finding refers to an unknown option.');
  }
  if (value.findings.some(f=>f.severity==='blocker')&&!value.needsRevision) fail('Blockers must remain flagged for revision.');
  return value;
}
function teamShape(input,report) {
  if (!['execution','reviews','transcript'].some(key=>Object.hasOwn(report,key))) return;
  const execution=report.execution;
  keys(execution,['mode','provider','model','identityStatus','callCount','maxCalls','startedAt','completedAt','revisionApplied'],'team execution');
  if (execution.mode!=='ai-team'||execution.identityStatus!=='configured-provider-declaration'||execution.maxCalls!==4||![3,4].includes(execution.callCount)||execution.revisionApplied!==(execution.callCount===4)) fail('Invalid team execution record.');
  if (typeof execution.provider!=='string'||!/^[a-z0-9-]{1,60}$/.test(execution.provider)||typeof execution.model!=='string'||!execution.model||execution.model.length>160||!/^[A-Za-z0-9_./:-]+$/.test(execution.model)) fail('Invalid configured model declaration.');
  if (isoTime(execution.completedAt)<isoTime(execution.startedAt)) fail('Invalid team execution times.');
  keys(report.reviews,['estimator','reviewer'],'team reviews');
  critique(input,report.reviews.estimator);critique(input,report.reviews.reviewer);
  const expected=execution.revisionApplied?[['scope-planner','proposal'],['estimator','estimate-review'],['scope-planner','revision'],['reviewer','final-review']]:[['scope-planner','proposal'],['estimator','estimate-review'],['reviewer','final-review']];
  const transcript=list(report.transcript,4,'Team transcript');
  if (transcript.length!==expected.length) fail('Team transcript does not match its executed call count.');
  for (const [index,entry] of transcript.entries()) {
    keys(entry,['role','stage','status','startedAt','completedAt','inputSha256','proposalSha256','summary','output'],'transcript entry');
    if (entry.role!==expected[index][0]||entry.stage!==expected[index][1]||entry.status!=='completed'||entry.inputSha256!==input.inputSha256||typeof entry.proposalSha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.proposalSha256)) fail('Transcript source or execution order is invalid.');
    if (isoTime(entry.completedAt)<isoTime(entry.startedAt)) fail('Invalid transcript times.');
    text(entry.summary,2800,'transcript summary');
    if (entry.role==='scope-planner') validateProposal(input,entry.output);else critique(input,entry.output);
  }
  if (!equal(report.reviews.estimator,transcript[1].output)||!equal(report.reviews.reviewer,transcript.at(-1).output)) fail('Team findings do not match the recorded execution.');
  if (report.reviews.estimator.needsRevision!==execution.revisionApplied) fail('Estimator revision request and recorded execution differ.');
}
function reportProposal(report) {
  return {options:list(report.options,2,'Report options').map(option=>({id:option.id,title:option.title,summary:option.summary,items:list(option.items,REVIEW_LIMITS.items,'Report items').map(item=>({componentId:item.componentId,rateId:item.rateId})),assumptions:option.assumptions,questions:option.questions})),questions:report.questions};
}
async function teamHashes(input,report) {
  if (!report.execution) return;
  let current=null;
  for (const entry of report.transcript) {
    if (entry.role==='scope-planner') current=validateProposal(input,entry.output);
    if (entry.proposalSha256!==await sha256(canonical(current))) fail('Transcript proposal digest differs from its recorded proposal.');
  }
  if (!equal(current,reportProposal(report))) fail('The final scope differs from the recorded planner output.');
}
function checkedReport(input,raw) {
  requireInput(input);finiteJSON(raw,REVIEW_LIMITS.reportBytes);const report=clone(raw);
  keys(report,['schema','inputSha256','source','brief','currency','options','questions','findings','validation','execution','reviews','transcript'],'review report');
  if (report.schema!==REVIEW_SCHEMA || report.inputSha256!==input.inputSha256 || !equal(report.source,input.source)) fail('Review belongs to a different source, brief or rates.');
  const expected=priceProposal(input,reportProposal(report));
  for (const key of Object.keys(expected)) if (!equal(expected[key],report[key])) fail('Review calculations or evidence changed; run the review again.');
  teamShape(input,report);return freeze(report);
}
export async function approveReview(input,report,value) {
  report=checkedReport(input,report);keys(value,['optionId','reviewer','note','acknowledged'],'approval request');
  if (value.acknowledged!==true || !report.options.some(option=>option.id===value.optionId)) fail('Select an option and acknowledge preliminary scope review.');
  const optionId=value.optionId,reviewer=text(value.reviewer,100,'reviewer'),note=text(value.note??'',1000,'review note',true);
  await teamHashes(input,report);const reportSha256=await sha256(canonical(report));
  return {schema:'brainsnn.project-review-approval.v1',inputSha256:input.inputSha256,reportSha256,optionId,reviewer,note,acknowledged:true,purpose:'preliminary-scope-review',selfReported:true,reviewedAt:new Date().toISOString(),validation:{...REVIEW_VALIDATION}};
}
export async function validateApproval(input,report,approval) {
  report=checkedReport(input,report);finiteJSON(approval,4096);approval=clone(approval);
  keys(approval,['schema','inputSha256','reportSha256','optionId','reviewer','note','acknowledged','purpose','selfReported','reviewedAt','validation'],'approval');
  await teamHashes(input,report);
  if (approval.schema!=='brainsnn.project-review-approval.v1'||approval.inputSha256!==input.inputSha256||approval.reportSha256!==await sha256(canonical(clone(report)))) fail('Approval is stale for this source, brief, rates or review.');
  if (approval.acknowledged!==true||approval.selfReported!==true||approval.purpose!=='preliminary-scope-review'||!report.options.some(option=>option.id===approval.optionId)||!equal(approval.validation,REVIEW_VALIDATION)) fail('Invalid preliminary review approval.');
  text(approval.reviewer,100,'reviewer');text(approval.note,1000,'review note',true);
  isoTime(approval.reviewedAt);
  return clone(approval);
}
export async function exportReviewJSON(input,report,approval=null) {
  report=checkedReport(input,report);if (approval!==null) {finiteJSON(approval,4096);approval=clone(approval);}
  await teamHashes(input,report);const checked=approval===null?null:await validateApproval(input,report,approval);
  const value={schema:'brainsnn.project-review-package.v1',input:clone(input),report:clone(report),approval:checked};
  finiteJSON(value,REVIEW_LIMITS.packageBytes);return JSON.stringify(value);
}
const md=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g,'\\$&').replace(/[\r\n]+/g,' ');
export async function exportReviewMarkdown(input,report,approval=null) {
  report=checkedReport(input,report);if (approval!==null) {finiteJSON(approval,4096);approval=clone(approval);}
  await teamHashes(input,report);if (approval!==null) approval=await validateApproval(input,report,approval);
  const money=value=>`${input.currency} ${value.toFixed(2)}`;
  const lines=[`# ${md(input.brief.title)}`,'','Preliminary scope review. Quantities remain provisional; this is not a final quotation or certification.','',`Source: ${md(input.source.label)}`,`Scene SHA-256: ${input.source.sceneSha256}`,`Review input SHA-256: ${input.inputSha256}`,'',`Goal: ${md(input.brief.goal)}`,`Constraints: ${md(input.brief.constraints)||'None supplied.'}`,''];
  for (const option of report.options) {
    lines.push(`## ${md(option.title)}`,'',md(option.summary),'','| Surface | Task / rate | Quantity | Rate source / date | Amount |','| --- | --- | --- | --- | --- |');
    for (const item of option.items) lines.push(`| ${md(item.label)} | ${md(item.rateLabel)} | ${item.quantity.toFixed(3)} m², inferred | ${md(item.rateSource)||'Missing'} / ${md(item.rateDate)||'Missing'} | ${item.priced?`${money(item.low)}–${money(item.high)}`:'Unpriced'} |`);
    lines.push('',`${option.complete?'Selected-scope estimate':'Known subtotal (partial; complete estimate unavailable)'}: ${money(option.knownSubtotal.low)}–${money(option.knownSubtotal.high)}`,'');
    for (const value of [...option.assumptions,...option.questions]) lines.push(`- ${md(value)}`);
    lines.push('');
  }
  lines.push('## Review points','',...report.findings.map(f=>`- ${md(f.message)}`),...report.questions.map(q=>`- ${md(q)}`),'');
  if (report.execution) {
    lines.push('## AI team review','',`Configured model: ${md(report.execution.model)}. ${report.execution.callCount} recorded calls. Identity is provider-declared; commentary is advisory.`,'');
    for (const role of ['estimator','reviewer']) {
      const review=report.reviews[role];lines.push(`### ${role==='estimator'?'Estimator':'Reviewer'}`,'',md(review.summary),'');
      for (const finding of review.findings) lines.push(`- ${md(finding.severity)}: ${md(finding.message)}${finding.optionIds.length?` (${finding.optionIds.join(', ')})`:''}`);
      if (review.needsRevision) lines.push(role==='estimator'&&report.execution.revisionApplied?'- The estimator requested the recorded planner revision. See the final reviewer for remaining issues.':'- Further revision or human resolution remains requested.');
      lines.push('');
    }
  } else lines.push('Review mode: local templates and calculations; no model was executed.','');
  lines.push('## Human decision','',approval?`${md(approval.reviewer)} reviewed ${md(approval.optionId)} for preliminary scope on ${md(approval.reviewedAt)}. ${md(approval.note)}`:'Not yet reviewed by a person.');
  return lines.join('\n')+'\n';
}

// Generated by the existing component_graph.ensure_component_ids helper from a
// small authored room. Its geometry-scoped namespace is not a camera source.
const DEMO_SCENE = {"schema":"brainsnn.scene.v1","source":"Authored Project Review example. No camera capture or physical measurements.","units":"m","scale":{"source":"authored-example","metresPerUnit":1,"verified":false},"floor_y":0,"unknown":[],"walls":[{"name":"wall_north","label":"wall north","centre":[0,1.35,-2.4],"size":[6,2.7,0.16],"yaw_degrees":0,"provenance":"authored-example","componentId":"cdf8bc46-c801-5cc0-bac7-98354abbdc0c"},{"name":"wall_south","label":"wall south","centre":[0,1.35,2.4],"size":[6,2.7,0.16],"yaw_degrees":0,"provenance":"authored-example","componentId":"1ed07e60-5005-5ea1-8572-9432b013eb15"},{"name":"wall_west","label":"wall west","centre":[-3,1.35,0],"size":[4.8,2.7,0.16],"yaw_degrees":90,"provenance":"authored-example","componentId":"86728ae6-b55e-50c7-8bd6-a38292674bde"},{"name":"wall_east","label":"wall east","centre":[3,1.35,0],"size":[4.8,2.7,0.16],"yaw_degrees":90,"provenance":"authored-example","componentId":"2b307bd2-9fa1-574e-9da3-18495b57a6fd"}],"objects":[{"name":"floor_observed","label":"Example floor","centre":[0,-0.02,0],"size":[6,0.04,4.8],"yaw_degrees":0,"provenance":"authored-example","componentId":"6bc39514-a748-58de-9a37-6f22ea8f76b6"}],"openings":[{"id":"example-door","hostWall":"wall_north","offsetMeters":0.6,"widthMeters":0.9,"heightMeters":2.1,"sillMeters":0,"kind":"door","reviewed":true,"componentId":"ae5bda86-888e-5916-8590-98c306783788","hostComponentId":"cdf8bc46-c801-5cc0-bac7-98354abbdc0c","host":{"centre":[0,1.35,-2.4],"size":[6,2.7,0.16],"yaw_degrees":0},"doorComponentId":"042d6ec1-1c19-5afc-a015-262dd4a97ae3"}],"metric_verified":false,"metricVerified":false,"certified":false,"clearanceVerified":false,"physicalRobotValidated":false,"componentGraph":{"schema":"brainsnn.component-graph.v1","sourceSha256":"6a00cde4b867f74fdad4db9772ec378dd3ad48b66711c3e10574f89cdb98d13d","namespaceBasis":"legacy-scene-geometry-sha256","sourceSceneSha256":"775e294257c9a0d46376c62ea6cd2495045b27dc1d49a9419066fd115c50ef52","contentSha256":"98d3405b6b8e558ddcf369f25f48f7c36bdf47e05718dffb425e3192cfab193e","revision":0,"components":[{"componentId":"cdf8bc46-c801-5cc0-bac7-98354abbdc0c","kind":"wall","index":0,"sourceName":"wall_north"},{"componentId":"1ed07e60-5005-5ea1-8572-9432b013eb15","kind":"wall","index":1,"sourceName":"wall_south"},{"componentId":"86728ae6-b55e-50c7-8bd6-a38292674bde","kind":"wall","index":2,"sourceName":"wall_west"},{"componentId":"2b307bd2-9fa1-574e-9da3-18495b57a6fd","kind":"wall","index":3,"sourceName":"wall_east"},{"componentId":"6bc39514-a748-58de-9a37-6f22ea8f76b6","kind":"object","index":0,"sourceName":"floor_observed"},{"componentId":"ae5bda86-888e-5916-8590-98c306783788","kind":"opening","index":0,"sourceName":"example-door","hostComponentId":"cdf8bc46-c801-5cc0-bac7-98354abbdc0c","doorComponentId":"042d6ec1-1c19-5afc-a015-262dd4a97ae3"}],"editHistory":[],"evidenceStatus":"source-scene","invalidatedEvidence":[],"metricVerified":false,"certified":false}};
export function demoSceneText() { return JSON.stringify(DEMO_SCENE); }
