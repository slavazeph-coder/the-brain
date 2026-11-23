import {normalizeRobotCapability} from './robot-capability.mjs';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const angle=x=>Math.atan2(Math.sin(x),Math.cos(x));
export function advanceCapabilityWaypoint(route,pose,index,tolerance=.11) {
  while(index<route.length-1) {
    const target=route[index],prior=route[index-1]??target;
    const dx=target[0]-prior[0],dz=target[1]-prior[1],length=Math.hypot(dx,dz);
    const past=length>0&&((pose.x-target[0])*dx+(pose.z-target[1])*dz)>=0;
    const cross=length?Math.abs((pose.x-target[0])*dz-(pose.z-target[1])*dx)/length:0;
    if(Math.hypot(pose.x-target[0],pose.z-target[1])>=tolerance&&!(past&&cross<tolerance))break;
    index++;
  }
  return index;
}
function segmentDistance(x,z,a,b) {
  const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?clamp(((x-a[0])*dx+(z-a[1])*dz)/l,0,1):0;
  return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
}
function inside(x,z,poly) {
  let result=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}
function normalSource(seed) {
  let a=seed>>>0;
  const uniform=()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};
  return()=>Math.sqrt(-2*Math.log(Math.max(1e-10,uniform())))*Math.cos(2*Math.PI*uniform());
}

/** Pure predictive controller. Its rollout is an explicit approximation; MuJoCo provides the actual state. */
export function createCapabilityController(input,scene,{mode='waypoint',seed=7,samples=32,horizon=12}={}) {
  const profile=normalizeRobotCapability(input);
  if(!['waypoint','mppi'].includes(mode))throw Error('Choose waypoint or MPPI control for this robot.');
  if(!Number.isInteger(samples)||samples<8||samples>96||!Number.isInteger(horizon)||horizon<4||horizon>24)throw Error('Unsupported predictive-control budget.');
  const diff=profile.drive.kind==='differential',limit=profile.limits,dt=.1,random=normalSource(seed);
  const radius=Math.hypot(profile.body.width,profile.body.depth)/2+profile.marginM;
  const remaining=Array(scene.route.length).fill(0);
  for(let i=remaining.length-2;i>=0;i--)remaining[i]=remaining[i+1]+Math.hypot(scene.route[i+1][0]-scene.route[i][0],scene.route[i+1][1]-scene.route[i][1]);
  const obstacles=scene.obstacles.map(o=>({...o,x0:Math.min(...o.polygon.map(p=>p[0])),x1:Math.max(...o.polygon.map(p=>p[0])),z0:Math.min(...o.polygon.map(p=>p[1])),z1:Math.max(...o.polygon.map(p=>p[1]))}));
  let previous=[0,0];
  function bound(raw,prior,step) {
    if(diff) {
      const accel=(raw[0]<prior[0]?limit.brakingMps2:limit.accelerationMps2)*step;
      return [clamp(raw[0],Math.max(0,prior[0]-accel),Math.min(limit.speedMps,prior[0]+accel)),clamp(raw[1],-limit.yawRateRps,limit.yawRateRps)];
    }
    let [vx,vz]=raw;const mag=Math.hypot(vx,vz),s=Math.min(1,limit.speedMps/(mag||1));vx*=s;vz*=s;
    const dx=vx-prior[0],dz=vz-prior[1],change=Math.hypot(dx,dz),max=(Math.hypot(vx,vz)<Math.hypot(...prior)?limit.brakingMps2:limit.accelerationMps2)*step;
    const f=Math.min(1,max/(change||1));return[prior[0]+dx*f,prior[1]+dz*f];
  }
  function follow(pose,target) {
    const dx=target[0]-pose.x,dz=target[1]-pose.z,d=Math.hypot(dx,dz);
    if(!diff)return d?[dx/d*Math.min(limit.speedMps,2*d),dz/d*Math.min(limit.speedMps,2*d)]:[0,0];
    const error=angle(Math.atan2(dz,dx)-pose.heading);
    return [Math.abs(error)>.65?0:Math.min(limit.speedMps,1.8*d)*Math.max(0,Math.cos(error)),clamp(3.2*error,-limit.yawRateRps,limit.yawRateRps)];
  }
  function gap(x,z) {
    const [a,b,c,d]=scene.bounds;let best=Math.min(x-a,c-x,z-b,d-z)-radius;
    for(const ob of obstacles) {
      if(x<ob.x0-radius-.3||x>ob.x1+radius+.3||z<ob.z0-radius-.3||z>ob.z1+radius+.3)continue;
      if(inside(x,z,ob.polygon))return-radius;
      for(let i=0;i<ob.polygon.length;i++)best=Math.min(best,segmentDistance(x,z,ob.polygon[i],ob.polygon[(i+1)%ob.polygon.length])-radius);
    }
    return best;
  }
  function cost(pose,sequence,startIndex) {
    let p={...pose},prior=previous,total=0,index=startIndex;
    for(let t=0;t<horizon;t++) {
      const raw=sequence.slice(t*2,t*2+2),u=bound(raw,prior,dt);sequence[t*2]=u[0];sequence[t*2+1]=u[1];
      if(diff){const mid=p.heading+u[1]*dt/2;p.x+=u[0]*Math.cos(mid)*dt;p.z+=u[0]*Math.sin(mid)*dt;p.heading+=u[1]*dt;}
      else{p.x+=u[0]*dt;p.z+=u[1]*dt;}
      index=advanceCapabilityWaypoint(scene.route,p,index);
      const target=scene.route[index],dist=Math.hypot(target[0]-p.x,target[1]-p.z),clear=gap(p.x,p.z);
      if(clear<-.005)return 1e5+(horizon-t)*1e3;
      total+=5*(dist+remaining[index])*dt+Math.max(0,.15-clear)**2*20*dt+.08*((u[0]-prior[0])**2+(u[1]-prior[1])**2);
      if(diff)total+=.15*Math.abs(angle(Math.atan2(target[1]-p.z,target[0]-p.x)-p.heading))*dt;
      prior=u;
    }
    return total+8*(Math.hypot(scene.route[index][0]-p.x,scene.route[index][1]-p.z)+remaining[index]);
  }
  return {
    metadata:{kind:mode,model:diff?'acceleration-bounded-unicycle':'acceleration-bounded-planar-velocity',samples:mode==='mppi'?samples:0,horizonSeconds:mode==='mppi'?horizon*dt:0,seed,physicsModel:'MuJoCo state feedback; predictive rollout is approximate'},
    command(pose,index,controlDt=.05) {
      if(![pose.x,pose.z,pose.heading].every(Number.isFinite)||!Number.isInteger(index)||index<0||index>=scene.route.length)throw Error('Controller needs a finite pose and a route waypoint.');
      const base=follow(pose,scene.route[index]);
      if(mode==='waypoint'){previous=bound(base,previous,controlDt);return [...previous];}
      const sequences=[],costs=[];
      for(let k=0;k<samples;k++) {
        const seq=[];let prediction={...pose},prior=previous,targetIndex=index;
        for(let t=0;t<horizon;t++) {
          targetIndex=advanceCapabilityWaypoint(scene.route,prediction,targetIndex);
          let cmd=follow(prediction,scene.route[targetIndex]);
          if(k===1)cmd=[0,0];
          else if(k>1){cmd[0]+=random()*limit.speedMps*.22;cmd[1]+=random()*(diff?limit.yawRateRps:limit.speedMps)*.22;}
          cmd=bound(cmd,prior,dt);seq.push(...cmd);
          if(diff){const mid=prediction.heading+cmd[1]*dt/2;prediction.x+=cmd[0]*Math.cos(mid)*dt;prediction.z+=cmd[0]*Math.sin(mid)*dt;prediction.heading+=cmd[1]*dt;}
          else{prediction.x+=cmd[0]*dt;prediction.z+=cmd[1]*dt;}prior=cmd;
        }
        sequences.push(seq);costs.push(cost(pose,seq,index));
      }
      let best=0;for(let k=1;k<samples;k++)if(costs[k]<costs[best])best=k;
      const temperature=.15,weights=costs.map(c=>Math.exp(-(c-costs[best])/temperature)),sum=weights.reduce((a,b)=>a+b,0);
      const average=Array(horizon*2).fill(0);
      for(let k=0;k<samples;k++)for(let j=0;j<average.length;j++)average[j]+=weights[k]*sequences[k][j]/sum;
      const use=cost(pose,average,index)<=costs[best]+.1?average:sequences[best];
      previous=bound(use.slice(0,2),previous,controlDt);return[...previous];
    },
  };
}
