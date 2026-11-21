import {buildReviewedMapEpisodeScene} from './reviewed-map-episode.mjs';
import {mountShowroomRun} from './showroom-run-ui.mjs';

export function openReviewedMapRun(world, goal, source, opener = document.activeElement) {
  const scene = buildReviewedMapEpisodeScene(world, goal, source);
  const dialog = document.createElement('dialog');
  dialog.className = 'map-run-dialog';
  dialog.setAttribute('aria-labelledby','active-run-title');
  dialog.innerHTML = `<div class="showroom-view"><header><h2 id="active-run-title"></h2>
    <button type="button" data-close>Close</button></header>
    <details class="showroom-run" open></details></div>`;
  dialog.querySelector('h2').textContent = scene.title;
  const [x0,z0,x1,z1] = scene.bounds;
  const scale = Math.min(468/(x1-x0),258/(z1-z0));
  const project = (x,z) => [250+(x-(x0+x1)/2)*scale,145+(z-(z0+z1)/2)*scale];
  document.body.append(dialog);
  try {
    const run = mountShowroomRun(dialog.querySelector('details'),null,{project,initialScene:scene});
    dialog.addEventListener('close',()=>{
      run.dispose();
      dialog.remove();
      if (opener?.isConnected) opener.focus({preventScroll:true});
    },{once:true});
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.showModal();
  } catch (error) {
    dialog.remove();
    throw error;
  }
}
