import React, { useMemo, useRef, useState } from 'react';
import { buildHoldoutReport } from '../../lib/holdoutReport.js';
import { isSourceFinding } from './reviewModel.js';

export function KnownLimits({ comparison = false }) {
  const report = useMemo(() => buildHoldoutReport(), []);
  const missed = report.items.find((item) => item.kind === 'paraphrase' && item.missed.length);
  const falseAlarm = report.items.find((item) => item.falseAlarm);
  return <aside className="review-limits" aria-label="Known detector misses and false alarms">
    <h3>Known misses & false alarms</h3>
    <p>{comparison ? 'Related lexical-detector evaluation, not calibration of these comparison scores.' : 'Published lexical-detector evaluation, not findings about your input.'}</p>
    <ul><li>{report.classesExpected - report.classesFound} of {report.classesExpected} annotated techniques missed.</li><li>{report.falseAlarmCount} false alarms across {report.trapCount} benign passages.</li><li>{Math.round((1 - (report.paraphraseRecall ?? 0)) * 100)}% of paraphrased techniques missed.</li></ul>
    {missed && <p><strong>Missed example:</strong> “{missed.content}”</p>}
    {falseAlarm && <p><strong>False alarm example:</strong> “{falseAlarm.content}”</p>}
    <a href="/evidence">Inspect the passages and labels →</a>
  </aside>;
}

export function SourceEvidence({ id, content, findings = [], label = 'Source passage' }) {
  const [selection, setSelection] = useState(null);
  const source = useRef(null);
  const verified = findings.filter((finding) => isSourceFinding(content, finding));
  const active = selection && isSourceFinding(content, selection) ? selection : null;
  function select(event, finding) {
    event.preventDefault();
    setSelection(finding);
    source.current?.focus({ preventScroll: true });
    source.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  return <div className="review-source-evidence">
    <h3>{label}</h3>
    <pre id={id} ref={source} tabIndex={-1} className="review-source ew-source" aria-label={label}>{active ? <>{content.slice(0, active.start)}<mark>{active.quotation}</mark>{content.slice(active.end)}</> : content}</pre>
    <p className="review-note">Select a cue to highlight its exact source span.</p>
    {verified.length ? <ol className="review-findings ew-findings">{verified.map((finding, index) => <li key={`${finding.start}-${finding.end}-${index}`}>
      <a href={`#${id}`} onClick={(event) => select(event, finding)}><strong>{finding.signal}</strong><span>“{finding.quotation}”</span></a>
      <p>{finding.explanation}</p>
    </li>)}</ol> : <p className="review-empty">No localized cues returned. This does not establish that the passage is accurate or free of pressure.</p>}
    {verified.length < findings.length && <p className="review-note">Some outputs could not be matched to the exact input and are not shown as findings.</p>}
  </div>;
}
