// The capture report a worker writes next to reconstruction.json: where the walk registered and where it did not, in
// seconds of video, with what the frames support as the cause. Rendered as a timeline bar and the dropped stretches.
// It describes the capture, never the room: no geometry, scale or review flag depends on it.
export const CAPTURE_REPORT_SCHEMA = 'brainsnn.capture-report.v1';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = (v, lo = 0, hi = 1e6) => Number.isFinite(v) && v >= lo && v <= hi;

/** A validated, bounded view of a capture report, or null when the file is not one. */
export function readCaptureReport(report) {
  if (!report || typeof report !== 'object' || report.schema !== CAPTURE_REPORT_SCHEMA) return null;
  if (report.status !== 'ok') return { ok: false, verdict: typeof report.verdict === 'string' ? report.verdict.slice(0, 300) : 'No capture report.' };
  if (!num(report.seconds_total, 0.1) || !num(report.seconds_registered, 0, report.seconds_total + 1) || !Array.isArray(report.stretches)) return null;
  const stretches = report.stretches.slice(0, 2000).filter(s => num(s.start, 0, report.seconds_total + 1) && num(s.end, s.start, report.seconds_total + 1) && typeof s.registered === 'boolean')
    .map(s => ({ start: s.start, end: s.end, registered: s.registered }));
  if (!stretches.length) return null;
  const dropped = (Array.isArray(report.dropped) ? report.dropped : []).slice(0, 50)
    .filter(d => num(d.start) && num(d.end, d.start) && ['motion-blur', 'no-overlap'].includes(d.cause))
    .map(d => ({ start: d.start, end: d.end, seconds: Math.round(d.end - d.start), cause: d.cause,
                 reason: typeof d.reason === 'string' ? d.reason.slice(0, 300) : '', advice: typeof d.advice === 'string' ? d.advice.slice(0, 300) : '' }));
  const longest = report.longest_registered && num(report.longest_registered.start) && num(report.longest_registered.end) ? { start: report.longest_registered.start, end: report.longest_registered.end } : null;
  return { ok: true, total: report.seconds_total, registered: report.seconds_registered, share: Math.max(0, Math.min(1, report.seconds_registered / report.seconds_total)),
           stretches, dropped, longest, verdict: typeof report.verdict === 'string' ? report.verdict.slice(0, 400) : '',
           advice: (Array.isArray(report.advice) ? report.advice : []).slice(0, 5).filter(a => typeof a === 'string').map(a => a.slice(0, 300)),
           sharpnessMeasured: report.sharpness?.measured === true };
}

const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** HTML for the capture card: a timeline bar (green registered, grey dropped, amber blurred) and the dropped stretches. */
export function captureReportCard(report) {
  const r = readCaptureReport(report);
  if (!r) return '';
  if (!r.ok) return `<section class="capture-report" aria-label="Capture report"><h4>Capture</h4><p>${esc(r.verdict)}</p></section>`;
  const blurred = new Set(r.dropped.filter(d => d.cause === 'motion-blur').map(d => `${d.start}-${d.end}`));
  const bar = r.stretches.map(s => {
    const w = Math.max(0.2, 100 * (s.end - s.start) / r.total);
    const kind = s.registered ? 'registered' : blurred.has(`${s.start}-${s.end}`) ? 'blurred' : 'dropped';
    return `<i class="${kind}" style="width:${w.toFixed(2)}%" title="${mmss(s.start)}–${mmss(s.end)} ${s.registered ? 'registered' : kind}"></i>`;
  }).join('');
  const pct = Math.round(100 * r.share);
  const list = r.dropped.length ? `<ol>${r.dropped.map(d => `<li><b>${mmss(d.start)}–${mmss(d.end)}</b> (${d.seconds} s) ${esc(d.reason)} <em>${esc(d.advice)}</em></li>`).join('')}</ol>` : '';
  return `<section class="capture-report" aria-label="Capture report">
    <h4>Capture: ${pct}% of the walk registered</h4>
    <div class="timeline" role="img" aria-label="Timeline of the video: ${esc(r.verdict)}">${bar}</div>
    <p class="micro">0:00 → ${mmss(r.total)} · green registered · grey did not join · amber blurred${r.sharpnessMeasured ? '' : ' (sharpness not measured)'}</p>
    <p>${esc(r.verdict)}</p>${list}${r.advice.length ? `<p class="micro">${r.advice.map(esc).join(' ')}</p>` : ''}
    <p class="micro">A report on the capture only. It changes no geometry, scale or review flag.</p>
  </section>`;
}
