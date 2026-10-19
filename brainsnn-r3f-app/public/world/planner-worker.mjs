import {planWorld} from './core.mjs';
self.onmessage = ({data}) => {
  try { self.postMessage({id:data.id, result:planWorld(data.world,data.robot)}); }
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
