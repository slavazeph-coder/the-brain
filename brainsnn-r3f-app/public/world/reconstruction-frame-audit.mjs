// Source-bound camera registration audit. No depth, geometry or scale is inferred here.
// Prepared-frame order is a sampled-video index, not necessarily original video PTS.
const HASH=/^[a-f0-9]{64}$/;
const IMAGE=/^image_\d{1,8}\.(?:jpe?g|png)$/i;

function spans(rows,registered){
  const runs=[];let start=-1;
  for(let i=0;i<=rows.length;i++){
    if(i<rows.length&&rows[i].registered===registered){if(start<0)start=i;}
    else if(start>=0){runs.push({start:start,end:i-1,length:i-start});start=-1;}
  }
  return runs;
}

export function reconstructionFrameAudit(evidence){
  if(evidence?.schema!=='brainsnn.reconstruction.v1')return null;
  const capture=evidence.capture||{};
  const count=capture.images,used=capture.registered_images;
  const frames=capture.frames,cameras=evidence.cameras;
  if(!Number.isInteger(count)||count<1||count>5000||!Number.isInteger(used)||used<0||used>count
    ||!Array.isArray(frames)||frames.length!==count||!Array.isArray(cameras)||cameras.length!==used)return null;

  const names=new Set(),cameraNames=new Map();
  for(const frame of frames){
    if(!frame||typeof frame.image!=='string'||!IMAGE.test(frame.image)||names.has(frame.image))return null;
    names.add(frame.image);
  }
  for(const camera of cameras){
    if(!camera||!names.has(camera.image)||cameraNames.has(camera.image))return null;
    cameraNames.set(camera.image,camera);
  }
  const source=evidence.sources?.find(s=>s?.kind==='video'&&HASH.test(s?.sha256));
  const rows=frames.map((frame,index)=>{
    const camera=cameraNames.get(frame.image);
    const timestamp=typeof frame.timestamp==='number'&&Number.isFinite(frame.timestamp)&&frame.timestamp>=0?frame.timestamp:null;
    const sha=frame.preparation?.preparedSha256;
    return {
      sample_index:index,prepared_image:frame.image,
      prepared_sha256:typeof sha==='string'&&HASH.test(sha)?sha:null,
      registered:Boolean(camera),
      frame_id:typeof camera?.frame_id==='string'&&HASH.test(camera.frame_id)?camera.frame_id:null,
      source_timestamp_seconds:timestamp,
      // Never turn missing debug data into claimed sensor measurements.
      blur_score:null,matched_features:null,reprojection_error_px:null,rejection_reason:null
    };
  });
  const missingSpans=spans(rows,false).sort((a,b)=>b.length-a.length||a.start-b.start);
  const registeredSpans=spans(rows,true).sort((a,b)=>b.length-a.length||a.start-b.start);
  return {
    schema:'brainsnn.reconstruction-frame-audit.v1',
    source_video_sha256:source?.sha256||null,
    total_frames:count,registered_frames:used,unregistered_frames:count-used,
    registration_fraction:used/count,
    metric_verified:evidence.metric_verified===true,
    consistency_status:capture.consistency?.status||'not_recorded',
    models_found:Number.isInteger(capture.models_found)?capture.models_found:null,
    longest_gap:missingSpans[0]||null,missing_spans:missingSpans,
    longest_registered_run:registeredSpans[0]||null,
    original_source_pts_available:rows.every(row=>row.source_timestamp_seconds!==null),
    timeline_basis:'sampled-frame order; original source PTS unavailable where blank',
    quality_note:'Frame registration is not surface coverage or metric accuracy. Missing blur, matches, per-frame reprojection error and rejection causes were not recorded by this reconstruction.',
    rows
  };
}

function csvValue(value){
  if(value===null||value===undefined)return '';
  const s=String(value);
  return /[\r\n,"]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
}

export function reconstructionFrameCSV(evidence){
  const audit=reconstructionFrameAudit(evidence);
  if(!audit)throw Error('No complete, self-consistent frame ledger available for export.');
  const columns=['sample_index','prepared_image','prepared_sha256','registered','frame_id','source_timestamp_seconds','blur_score','matched_features','reprojection_error_px','rejection_reason'];
  return columns.join(',')+'\n'+audit.rows.map(row=>columns.map(key=>csvValue(row[key])).join(',')).join('\n')+'\n';
}
