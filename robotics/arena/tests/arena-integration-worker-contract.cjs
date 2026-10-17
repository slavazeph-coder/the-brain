/* Cross-language schema integration only. No weights, simulation or server is run.
 * Uses the real Python worker profile and real browser runtime validator. */
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {spawnSync}=require('child_process');
const dir=path.resolve(__dirname,'..');
const python=spawnSync('python',['-c','import json; from workers.arena.core import profile_contract; p=profile_contract("fixture-checkpoint-revision"); p.update(ready=True); print(json.dumps(p))'],{cwd:dir,encoding:'utf8'});
assert.equal(python.status,0,python.stderr);
const profile=JSON.parse(python.stdout);
const response=body=>({ok:true,status:200,text:async()=>JSON.stringify(body)});
const requests=[];
const frame={version:1,sessionId:'integration-session',profileId:profile.id,seq:1,simTime:0,status:'ready',policyExecuted:false,cameras:[],bodies:[],metrics:{},events:[]};
const fetch=async(url,opts)=>{requests.push({url,...opts});if(url.endsWith('/v1/capabilities'))return response({version:1,profiles:[profile]});if(opts.method==='POST'&&url.endsWith('/v1/sessions'))return response({version:1,sessionId:frame.sessionId,profileId:profile.id,robotId:profile.robotId,modelId:profile.modelId,checkpoint:profile.checkpoint,profile,status:'ready',frame});if(opts.method==='DELETE')return response({version:1,closed:true});throw Error('Unexpected request '+url)};
const context={console,URL,AbortController,setTimeout,clearTimeout,fetch};context.window=context;vm.createContext(context);
for(const file of ['arena-profiles.js','arena-runtime.js'])vm.runInContext(fs.readFileSync(path.join(dir,'dist',file),'utf8'),context,{filename:file});
context.document={readyState:'loading',addEventListener(){}};
context.addEventListener=()=>{};
vm.runInContext(fs.readFileSync(path.join(dir,'dist','arena-campaign.js'),'utf8'),context,{filename:'arena-campaign.js'});
const campaignPlan=context.BrainSNNCampaign.buildPlan({totalTrials:'10',maxWorkers:'1',startSeed:'7',costCeilingUSD:'100',loadingMinutes:'0',storageUSD:'0',egressUSD:'0',provider:'own',taskId:'libero_spatial:0',protocol:'benchmark'},context.BrainSNNArenaProfiles.find(profile.id));
const normalized=spawnSync('python',['-c','import json,sys; from inspection.campaign import normalize_plan; print(json.dumps(normalize_plan(json.load(sys.stdin))))'],{cwd:dir,input:JSON.stringify(campaignPlan),encoding:'utf8'});
assert.equal(normalized.status,0,normalized.stderr);
const cases=JSON.parse(normalized.stdout).cases;
assert.equal(cases.length,10);assert.equal(cases[0].seed,7);assert.equal(cases[9].seed,16);assert(cases.every(item=>item.taskId==='libero_spatial:0'));
console.log('PASS actual browser campaign export is accepted by the Python execution-plan validator');
(async()=>{const client=context.BrainSNNRuntime.createClient({fetch});const selection={robotId:'panda',modelId:'pi05',profileId:profile.id,seed:42,task:profile.tasks[0].id,protocol:'practice'};let s=await client.connect({url:'https://worker.example.test',token:'fixture-only-secret',selection});assert.equal(s.status,'connected',JSON.stringify(s.error));assert.equal(s.profile.checkpoint,profile.checkpoint);s=await client.start(selection);assert.equal(s.status,'ready',JSON.stringify(s.error));assert.equal(s.sessionId,frame.sessionId);assert.equal(s.lastFrame.policyExecuted,false);const request=JSON.parse(requests.find(r=>r.method==='POST').body);assert.equal(request.robotId,profile.robotId);assert.equal(request.modelId,profile.modelId);assert.equal(request.profileId,profile.id);assert.equal(request.task,profile.tasks[0].id);assert.equal(request.checkpoint,profile.checkpoint);assert(!JSON.stringify(client.getState()).includes('fixture-only-secret'));await client.disconnect();assert.equal(requests.at(-1).method,'DELETE');console.log('PASS Python worker profile, frontend recipe, and browser session contract agree')})().catch(error=>{console.error('FAIL worker/browser cross-language contract:',error.stack);process.exitCode=1});
