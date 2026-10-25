'use strict';
importScripts('arena-core.js');
function snapshot(s){return {width:s.width,height:s.height,seed:s.seed,opts:s.opts,walls:s.walls,objects:s.objects,robot:s.robot,goal:s.goal,steps:s.steps,collisions:s.collisions,retries:s.retries,delivered:s.delivered,done:s.done,success:s.success,failureReason:s.failureReason,trail:[]};}
onmessage = ({data}) => {
  const n=Math.max(100,Math.min(100000,Math.floor(data.trials))),baseSeed=data.baseSeed>>>0,config={...data.config,recordTrail:false};
  const agents=['greedy','planner','recovery'].map(agent=>({agent,trials:n,successes:0,steps:0,collisions:0,retries:0,failureCounts:{}})),sampleFailures=[];
  let done=0;
  for(let i=0;i<n;i++){
    for(const a of agents){const seed=(baseSeed+i)>>>0,r=BrainArena.run(seed,{...config,agent:a.agent});a.successes+=Number(r.success);a.steps+=r.steps;a.collisions+=r.collisions;a.retries+=r.retries;
      if(!r.success){a.failureCounts[r.failureReason]=(a.failureCounts[r.failureReason]||0)+1;if(!sampleFailures.some(f=>f.agent===a.agent))sampleFailures.push({agent:a.agent,seed,state:snapshot(r.state)});}done++;
    }
    if(i%150===0)postMessage({type:'progress',done,total:n*3});
  }
  postMessage({type:'complete',report:{version:'brainsnn-toy-grid-v1',evidenceType:'scripted-discrete-grid-simulation',modelInference:false,physicsSimulation:false,physicalRobot:false,cloudCompute:false,trialsPerScript:n,baseSeed,config,agents,sampleFailures,observationAccess:'Full grid occupancy for the planning scripts',notes:['Missions share a collection mechanic.','Scripts differ in planning and retry allowances.','Not a benchmark for an LLM or trained robot policy.','Sample failures are retained; this export does not contain every full episode trace.']}});
};
