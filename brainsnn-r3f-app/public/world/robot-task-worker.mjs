import { loadRobotTaskPhysics, normalizeRobotTask, runRobotTask } from './robot-task-physics.mjs';

let physicsPromise;
let busy = false;

self.addEventListener('message', async ({data}) => {
  if (!data || !['run','kitchen-run'].includes(data.type) || !Number.isSafeInteger(data.id) || data.id < 0) return;
  const {id} = data;
  if (busy) {
    self.postMessage({type: 'error', id, message: 'A tabletop trial is already running.'});
    return;
  }
  busy = true;
  try {
    const kitchen = data.type==='kitchen-run';
    const config = kitchen ? null : normalizeRobotTask(data.config);
    physicsPromise ??= loadRobotTaskPhysics().catch(error => {
      physicsPromise = undefined;
      throw error;
    });
    const physics = await physicsPromise;
    const episode = kitchen ? (await import('./kitchen-pin-physics.mjs')).runKitchenPin(physics,data.controller) : runRobotTask(physics,config);
    self.postMessage({type: 'result', id, episode});
  } catch (error) {
    self.postMessage({type: 'error', id, message: error.message || 'The tabletop trial could not run.'});
  } finally {
    busy = false;
  }
});
