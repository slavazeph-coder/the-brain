// Choose the primary result to open after a completed worker job. Evidence files
// remain available for explicit inspection and download in the Evidence panel.
export function automaticReviewArtifact(job){
  const artifacts=Array.isArray(job?.artifacts)?job.artifacts:[];
  const find=(type,predicate)=>{const index=artifacts.findIndex(predicate);return index<0?null:{type,index};};
  if(job?.engine==='locate-photo')return find('localization',a=>a.name==='localization.json'&&a.kind==='evidence');
  if(job?.engine==='scene-usd'){
    const scene=find('scene',a=>a.kind==='visual'&&a.name==='scene.glb');
    if(scene)return scene;
  }
  return find('visual',a=>a.kind==='visual'&&/\.(ply|splat)$/i.test(a.name)&&Number.isSafeInteger(a.size)&&a.size>0&&a.size<=64*1024**2)
    ||find('observations',a=>a.name==='observations.json'&&a.kind==='observations')
    ||find('scene',a=>a.kind==='visual'&&/\.glb$/i.test(a.name));
}
