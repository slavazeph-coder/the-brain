export function frameSummary(samples) {
  const rows = samples.filter(v => Number.isFinite(v) && v > 0).sort((a,b) => a-b);
  if (!rows.length) return { frames: 0, fps: null, medianMs: null, p95Ms: null };
  return { frames: rows.length, fps: 1000 * rows.length / rows.reduce((a,b)=>a+b,0),
    medianMs: rows[Math.floor((rows.length-1)*.5)], p95Ms: rows[Math.ceil(rows.length*.95)-1] };
}

// Reject remote resources before GLTFLoader runs. This tool never uploads scans.
export function inspectGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20 || buffer.byteLength > 40*1024**2)
    throw new Error('Choose a self-contained GLB smaller than 40 MiB.');
  const view = new DataView(buffer);
  if (view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==buffer.byteLength)
    throw new Error('Expected a complete GLB version 2 file.');
  const length = view.getUint32(12,true);
  if (view.getUint32(16,true)!==0x4e4f534a || length > 4*1024**2 || 20+length > buffer.byteLength)
    throw new Error('Invalid or oversized GLB JSON chunk.');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)).trim());
  if ((json.nodes?.length || 0)>2000 || (json.accessors?.length || 0)>10000 || (json.extensionsRequired?.length || 0)>0)
    throw new Error('Use an uncompressed GLB with at most 2,000 nodes and no required extensions.');
  const walk = value => {
    if (!value || typeof value!=='object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key==='uri' && (typeof child!=='string' || !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,/.test(child)))
        throw new Error('External GLB resources are refused. Embed every buffer and image.');
      walk(child);
    }
  };
  walk(json);
  if ((json.accessors || []).some(a=>!Number.isSafeInteger(a.count) || a.count<0 || a.count>6_000_000))
    throw new Error('GLB accessor exceeds the bounded preview limit.');
  return json;
}

export function receipt({mode, source, counts, samples, viewport, compileMs, settings, interrupted=false}) {
  return { schema:'brainsnn.meshlets-benchmark.v1', three:'0.187.0', mode, source, counts,
    viewport, compileMs, settings, interrupted, cadence:frameSummary(samples),frameIntervalsMs:[...samples],
    timingScope:'requestAnimationFrame intervals during a fixed-camera foreground run; not GPU execution timestamps',
    physicalAccuracyValidated:false, simulationValidated:false,
    caveats:['Repeated procedural geometry is not a unique scanned scene.',
      'Meshlet counters include padded triangles and exclude regular-pipeline draws.',
      'Display LOD does not change source GLB, BIM exports, collision geometry or robot routes.'] };
}
