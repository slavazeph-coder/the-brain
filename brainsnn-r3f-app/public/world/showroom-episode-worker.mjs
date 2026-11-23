import {loadRobotTaskPhysics} from './robot-task-physics.mjs';
import {runShowroomEpisode} from './showroom-episode-physics.mjs';
import {imitationVelocity} from './showroom-episode-policy.mjs';
import {showroomDriver} from './assets/showroom-driver.mjs';

let physics, busy=false;
self.addEventListener('message',async ({data})=>{
  if(data?.type!=='run' || !Number.isSafeInteger(data.id) || data.id<0) return;
  const {id}=data;
  if(busy) {
    self.postMessage({type:'error',id,message:'A room run is already in progress.'});
    return;
  }
  busy=true;
  try {
    const controller=data.controller??'waypoint';
    const choices=data.scene?.robotCapability?['waypoint','mppi']:['waypoint','imitation'];
    if (!choices.includes(controller)) throw Error('Choose a driver supported by this exact robot model.');
    const options=controller!=='imitation' ? {controller} : {controller,trainingId:showroomDriver.id,
      act:observation=>imitationVelocity(showroomDriver,observation)};
    physics??=loadRobotTaskPhysics().catch(error=>{physics=undefined; throw error;});
    const episode=await runShowroomEpisode(await physics,data.scene,options);
    self.postMessage({type:'result',id,episode});
  } catch(error) {
    self.postMessage({type:'error',id,message:error.message || 'The room simulation could not run.'});
  } finally {busy=false;}
});
