import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256} from '../../brainsnn-r3f-app/public/world/operational-twin.mjs';
import {prepareProjectReview,defaultReviewRates,localProposal,validateProposal,priceProposal,approveReview,validateApproval,exportReviewJSON,exportReviewMarkdown,reviewInputHash,demoSceneText,REVIEW_VALIDATION} from '../../brainsnn-r3f-app/public/world/project-review.mjs';

const request=()=>({sceneText:demoSceneText(),sourceLabel:'Authored room',brief:{title:'Room finish review',goal:'Compare two finish scopes',constraints:'Keep the layout',currency:'CAD',budget:2000},rates:defaultReviewRates()});
const pricedRequest=()=>{const r=request();r.rates=r.rates.map((rate,i)=>({...rate,low:[10,12,20,30][i],high:[15,18,25,35][i],source:'Owner-supplied test schedule',asOf:'2026-11-18',reviewed:true}));return r;};
const mutateScene=(r,fn)=>{const s=JSON.parse(r.sceneText);fn(s);r.sceneText=JSON.stringify(s);return r;};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);

test('source bytes, graph identities, brief and rates bind an immutable inferred review input',async()=>{
  const r=request(),input=await prepareProjectReview(r);
  assert.equal(input.source.sceneSha256,await sha256(r.sceneText));assert.equal(input.source.origin,'authored-example');
  assert.equal(input.inputSha256,await reviewInputHash(input));assert.equal(input.components.length,6);
  assert.deepEqual(input.source.validation,REVIEW_VALIDATION);assert.ok(Object.isFrozen(input.components[0].quantity));
  assert.throws(()=>input.components[0].quantity.value=999,TypeError);
  assert.equal(r.sceneText,demoSceneText());
  assert.throws(()=>priceProposal(JSON.parse(JSON.stringify(input)),localProposal(input)),/Prepare the original/);
  for (const change of [x=>x.sceneText+=' ',x=>x.sourceLabel+=' renamed',x=>x.brief.goal+=' with trim',x=>x.rates[0].low=0]) {
    const r2=request();change(r2);assert.notEqual((await prepareProjectReview(r2)).inputSha256,input.inputSha256);
  }
});

test('a reviewed door removes exactly its rectangle from one wall face; no ceiling or unseen floor is invented',async()=>{
  const input=await prepareProjectReview(request()),wall=input.components.find(c=>c.sourceName==='wall_north'),floor=input.components.find(c=>c.kind==='floor');
  close(wall.quantity.gross,6*2.7);close(wall.quantity.openingDeduction,.9*2.1);close(wall.quantity.value,6*2.7-.9*2.1);close(floor.quantity.value,6*4.8);
  assert.ok(input.components.every(c=>c.quantity===null||c.quantity.evidence==='inferred'));
  const r=mutateScene(request(),s=>{s.objects[0].name='cabinet';s.objects[0].label='floor';s.componentGraph.components.find(c=>c.kind==='object').sourceName='cabinet';});
  const renamed=await prepareProjectReview(r);assert.equal(renamed.components.find(c=>c.sourceName==='cabinet').quantity,null);
  assert.ok(priceProposal(renamed,localProposal(renamed)).findings.some(f=>f.code==='no-floor-quantity'));
});

test('stale source and host metadata, overlap, impossible openings and nonmetric scenes fail before pricing',async()=>{
  for (const change of [s=>s.units='ft',s=>s.cloudPointsSha256='b'.repeat(64),s=>s.componentGraph.components[0].sourceName='wrong',s=>s.openings[0].host.size[0]=5,s=>s.openings[0].hostComponentId=s.walls[1].componentId,s=>s.openings[0].widthMeters=20,s=>s.openings[0].reviewed=false,s=>s.openings[0].sillMeters=.1]) await assert.rejects(prepareProjectReview(mutateScene(request(),change)));
  const overlapping=mutateScene(request(),s=>{const hole={...structuredClone(s.openings[0]),id:'second',componentId:'00000000-0000-0000-0000-000000000099'};s.openings.push(hole);s.componentGraph.components.push({componentId:hole.componentId,kind:'opening',index:1,sourceName:hole.id});});
  await assert.rejects(prepareProjectReview(overlapping),/must not overlap/);
});

test('input snapshots cannot race mutations while exact source hashing yields',async()=>{
  const r=pricedRequest(),pending=prepareProjectReview(r);r.brief.title='Changed';r.rates[0].low=999;r.sceneText='{}';
  const input=await pending;assert.equal(input.brief.title,'Room finish review');assert.equal(input.rates[0].low,10);assert.equal(input.source.sceneSha256,await sha256(demoSceneText()));
});

test('rates are dated and explicitly reviewed; zero is a real price while missing and unreviewed prices are not',async()=>{
  const r=request();r.rates[0]={...r.rates[0],low:0,high:0,source:'Included by owner',asOf:'2026-11-18',reviewed:true};
  r.rates[1]={...r.rates[1],low:12,high:20};
  const input=await prepareProjectReview(r),report=priceProposal(input,localProposal(input));
  assert.equal(report.options[0].complete,true);assert.deepEqual(report.options[0].subtotal,{low:0,high:0});
  assert.equal(report.options[1].complete,false);assert.equal(report.options[1].subtotal,null);assert.ok(report.options[1].items.every(i=>!i.priced));
  for (const change of [rate=>rate.reviewed=true,rate=>rate.low=-1,rate=>{rate.low=2;rate.high=1;},rate=>rate.asOf='2026-02-30']) {const bad=request();change(bad.rates[0]);await assert.rejects(prepareProjectReview(bad));}
  const duplicate=request();duplicate.rates[1].id=duplicate.rates[0].id;await assert.rejects(prepareProjectReview(duplicate),/IDs must be unique/);
});

test('integer-cent line arithmetic produces traceable subtotals and explicit budget ranges',async()=>{
  const input=await prepareProjectReview(pricedRequest()),report=priceProposal(input,localProposal(input));
  // Independent arithmetic: 56.43 m² wall face total after the 1.89 m² opening.
  assert.deepEqual(report.options[0].subtotal,{low:564.3,high:846.45});
  assert.deepEqual(report.options[1].subtotal,{low:1541.16,high:2023.74});
  assert.equal(report.options[0].budgetStatus,'within');assert.equal(report.options[1].budgetStatus,'overlap');
  assert.ok(report.options.every(o=>o.items.every(i=>i.rateSource==='Owner-supplied test schedule'&&i.rateDate==='2026-11-18')));
  const r=pricedRequest();r.brief.budget=0;const zero=await prepareProjectReview(r);assert.equal(priceProposal(zero,localProposal(zero)).options[0].budgetStatus,'over');
});

test('known subtotal remains partial when only some selected rate records are approved',async()=>{
  const r=pricedRequest();r.rates[3].reviewed=false;const input=await prepareProjectReview(r),report=priceProposal(input,localProposal(input));
  assert.equal(report.options[1].complete,false);assert.equal(report.options[1].subtotal,null);assert.equal(report.options[1].unpricedCount,1);
  assert.deepEqual(report.options[1].knownSubtotal,{low:677.16,high:1015.74});assert.equal(report.options[1].budgetStatus,'incomplete');
});

test('model outputs cannot invent quantities, money, surfaces, incompatible rates or approval flags',async()=>{
  const input=await prepareProjectReview(pricedRequest());
  for (const change of [p=>p.options[0].items[0].quantity=99,p=>p.options[0].subtotal=1,p=>p.metricVerified=true,p=>p.options[0].items[0].componentId='missing',p=>p.options[0].items[0].rateId='missing',p=>p.options[0].items[0].rateId='floor-standard',p=>p.options[0].items.push({...p.options[0].items[0]}),p=>p.options[1].id='option-a',p=>p.options[0].summary='x'.repeat(1201)]) {
    const proposal=localProposal(input);change(proposal);assert.throws(()=>validateProposal(input,proposal));
  }
  const p=localProposal(input);p.options.forEach(o=>o.items=[]);const report=priceProposal(input,p);
  assert.ok(report.options.every(o=>o.subtotal===null&&!o.complete));assert.ok(report.findings.some(f=>f.code==='empty-scope'));
});

test('human scope approval binds exact calculations, option content and input, never geometric accuracy',async()=>{
  const input=await prepareProjectReview(pricedRequest()),report=priceProposal(input,localProposal(input));
  const approval=await approveReview(input,report,{optionId:'option-a',reviewer:'Slava',note:'Review measurements on site',acknowledged:true});
  assert.equal(approval.purpose,'preliminary-scope-review');assert.equal(approval.selfReported,true);assert.deepEqual(approval.validation,REVIEW_VALIDATION);
  assert.deepEqual(await validateApproval(input,report,approval),approval);
  const changed=structuredClone(report);changed.options[0].summary='A changed scope';await assert.rejects(validateApproval(input,changed,approval),/stale/);
  const numeric=structuredClone(report);numeric.options[0].items[0].quantity+=1;await assert.rejects(approveReview(input,numeric,{optionId:'option-a',reviewer:'Slava',acknowledged:true}),/calculations/);
  const claimed=structuredClone(report);claimed.validation.metricVerified=true;await assert.rejects(exportReviewJSON(input,claimed),/calculations/);
  const r=pricedRequest();r.rates[0].low=11;await assert.rejects(validateApproval(await prepareProjectReview(r),report,approval),/different/);
  await assert.rejects(approveReview(input,report,{optionId:'option-a',reviewer:'Slava',acknowledged:false}),/acknowledge/);
});

test('approval and export snapshot the checked report before any asynchronous digest',async()=>{
  const input=await prepareProjectReview(pricedRequest()),report=priceProposal(input,localProposal(input)),old=structuredClone(report);
  const pending=approveReview(input,report,{optionId:'option-a',reviewer:'Owner',acknowledged:true});report.options[0].items[0].quantity=999;
  const approval=await pending;await validateApproval(input,old,approval);
  const exportPending=exportReviewJSON(input,old,approval);old.options[0].items[0].low=999;
  const exported=JSON.parse(await exportPending);assert.notEqual(exported.report.options[0].items[0].low,999);
});

test('exports preserve the submitted human decision when caller-owned approval changes while hashing',async()=>{
  const input=await prepareProjectReview(pricedRequest()),report=priceProposal(input,localProposal(input));
  const approval=await approveReview(input,report,{optionId:'option-a',reviewer:'Original reviewer',note:'Check original conditions',acknowledged:true});
  const jsonPending=exportReviewJSON(input,report,approval),markdownPending=exportReviewMarkdown(input,report,approval);
  approval.reviewer='Changed reviewer';approval.optionId='option-b';approval.note='Changed conditions';
  const exported=JSON.parse(await jsonPending),markdown=await markdownPending;
  assert.equal(exported.approval.reviewer,'Original reviewer');assert.equal(exported.approval.optionId,'option-a');assert.equal(exported.approval.note,'Check original conditions');
  assert.match(markdown,/Original reviewer reviewed option\\-a/);assert.match(markdown,/Check original conditions/);assert.doesNotMatch(markdown,/Changed reviewer|Changed conditions/);
});

async function teamReport(input) {
  const proposal=localProposal(input),report=priceProposal(input,proposal),proposalSha256=await sha256(canonical(proposal)),time='2026-11-18T17:00:00.000Z';
  const finding={severity:'warning',message:'Allow for substrate repair before fixing a price.',componentIds:[],optionIds:['option-b']};
  const estimator={summary:'Review site preparation.',findings:[finding],needsRevision:false,recommendedOptionId:null};
  const reviewer={summary:'Keep assumptions visible.',findings:[finding],needsRevision:false,recommendedOptionId:'option-a'};
  const entry=(role,stage,output)=>({role,stage,status:'completed',startedAt:time,completedAt:time,inputSha256:input.inputSha256,proposalSha256,summary:role==='scope-planner'?proposal.options.map(o=>`${o.title}: ${o.summary}`).join('\n'):output.summary,output});
  return {...report,execution:{mode:'ai-team',provider:'test-fixture',model:'fixture-model',identityStatus:'configured-provider-declaration',callCount:3,maxCalls:4,startedAt:time,completedAt:time,revisionApplied:false},reviews:{estimator,reviewer},transcript:[entry('scope-planner','proposal',proposal),entry('estimator','estimate-review',estimator),entry('reviewer','final-review',reviewer)]};
}
test('team findings survive exports and exact transcript changes invalidate prior approvals',async()=>{
  const input=await prepareProjectReview(pricedRequest()),report=await teamReport(input),approval=await approveReview(input,report,{optionId:'option-a',reviewer:'Owner',acknowledged:true});
  assert.match(await exportReviewMarkdown(input,report,approval),/Allow for substrate repair/);
  assert.equal(JSON.parse(await exportReviewJSON(input,report,approval)).report.transcript.length,3);
  const changed=structuredClone(report);changed.transcript[2].summary='Different commentary';await assert.rejects(validateApproval(input,changed,approval),/stale/);
  const forged=structuredClone(report);forged.execution.metricVerified=true;await assert.rejects(exportReviewJSON(input,forged),/Unsupported/);
  const badHash=structuredClone(report);badHash.transcript[0].proposalSha256='f'.repeat(64);await assert.rejects(exportReviewJSON(input,badHash),/digest/);
  const badRefs=structuredClone(report);badRefs.reviews.reviewer.findings[0].componentIds=['missing'];await assert.rejects(exportReviewJSON(input,badRefs),/unknown component/);
});

test('exports escape model/project markup and label an unapproved local draft honestly',async()=>{
  const r=request();r.brief.title='<script>bad</script> [link](javascript:bad)';const input=await prepareProjectReview(r),report=priceProposal(input,localProposal(input));
  const markdown=await exportReviewMarkdown(input,report);assert.ok(!markdown.includes('<script>'));assert.ok(!markdown.includes('[link]('));assert.match(markdown,/local templates and calculations; no model was executed/);assert.match(markdown,/Known subtotal \(partial/);
  const data=JSON.parse(await exportReviewJSON(input,report));assert.equal(data.approval,null);assert.deepEqual(data.report.validation,REVIEW_VALIDATION);
});

test('accepts the existing source-bound scene fixture and rejects oversized or invalid JSON inputs',async()=>{
  const r=request();r.sceneText=await readFile(new URL('../../brainsnn-r3f-app/public/world/fixtures/asbuilt-current.scene.json',import.meta.url),'utf8');
  const input=await prepareProjectReview(r);assert.equal(input.components.length,6);assert.equal(input.components.filter(c=>c.task).length,3);
  for (const sceneText of ['{','{}',' '.repeat(256*1024+1)]) await assert.rejects(prepareProjectReview({...r,sceneText}));
  await assert.rejects(prepareProjectReview({...r,brief:{...r.brief,budget:Infinity}}),/finite/);
});
