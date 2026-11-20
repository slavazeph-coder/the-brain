import {planWorld} from './core.mjs';
self.onmessage = ({data}) => {
  try { self.postMessage({id:data.id, result:planWorld(data.world,data.robot)}); }
  // Advice (for a blocked start, the nearest spot where this robot fits) travels with the message so the page can offer it.
  catch(error){self.postMessage({id:data.id,error:error.message,advice:error.advice||null});}
};
