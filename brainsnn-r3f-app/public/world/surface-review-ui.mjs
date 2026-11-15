/** Surface tools for the exact checked GLB currently open in the scene dialog. */
export function createSurfaceReview(stage) {
  const root=document.createElement('section');root.className='scene-evidence-card';root.id='scene-surface-review';root.hidden=true;
  root.innerHTML='<h3>Surface inspection</h3><label>Mesh view<select aria-label="Scene surface mode"><option value="original">Original materials</option><option value="zebra">Zebra stripes</option><option value="normals">Face normals</option><option value="wireframe">Wireframe</option></select></label><button type="button" data-surface-check>Check mesh topology</button><button type="button" data-surface-download disabled>Download surface report</button><p role="status">Visual inspection only. Sharp BIM corners may be intentional. Meshes cannot certify NURBS G2/G3 continuity or physical accuracy.</p>';
  stage.after(root);
  const mode=root.querySelector('select'),check=root.querySelector('[data-surface-check]'),save=root.querySelector('[data-surface-download]'),status=root.querySelector('[role=status]');
  let viewer=null,source=null,report=null;
  mode.onchange=()=>{try{viewer?.surfaceMode(mode.value);}catch(error){mode.value='original';status.textContent=error.message;}};
  check.onclick=()=>{
    report=null;save.disabled=true;
    if(!viewer||!source)return;
    try{
      report={...viewer.surfaceAudit(),source:{...source},sourceGeometryChanged:false};
      const t=report.totals;
      status.textContent=`${t.triangles} triangles; ${t.boundaryEdges} boundary, ${t.nonManifoldEdges} non-manifold and ${t.sharpEdges} sharp edges. Topology checks only. Sharp corners and open boundaries may be intentional; metric accuracy, analytic continuity and collision readiness remain unverified.`;
      save.disabled=false;
    }catch(error){status.textContent=error.message;}
  };
  save.onclick=()=>{
    if(!report)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='surface-inspection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  function clear(){viewer?.surfaceMode('original');viewer=null;source=null;report=null;root.hidden=true;mode.value='original';save.disabled=true;status.textContent='Visual inspection only. Sharp BIM corners may be intentional. Meshes cannot certify NURBS G2/G3 continuity or physical accuracy.';}
  return {clear,set(next,identity){clear();viewer=next;source={...identity};root.hidden=false;}};
}
