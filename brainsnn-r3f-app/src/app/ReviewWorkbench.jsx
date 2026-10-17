import React, { useEffect, useRef, useState } from 'react';
import { EngineWorkspace } from '../features/engine/EngineWorkspace.jsx';
import { MediaInputPanel } from '../features/scan/MediaInputPanel.jsx';
import { KnownLimits, SourceEvidence } from '../features/review/ReviewEvidence.jsx';
import { buildVideoReview, inspectPassage, REVIEW_TABS, reviewTabFromSearch, splitClaimCues } from '../features/review/reviewModel.js';
import { loadMemory, loadQueue, saveQueue } from '../lib/storage.js';
import { useScanHistory } from '../features/memory/useScanHistory.js';
import { analyzeContentLocally } from '../lib/analysisEngine.js';
import { ImprovementWorkspace } from '../features/improve/ImprovementWorkspace.jsx';
import { formatTranscriptTime } from '../lib/timedTranscript.js';
import './review-workbench.css';

const SAMPLE = 'Act now! This guaranteed solution will change everything. Everyone knows it is the only choice.';
const MAX_CHARS = 8000;

function downloadRecord(record, filename = 'brainsnn-review.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function TextReview({ kind, input, setInput, onSave, onEdit }) {
  const claims = kind === 'claims';
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setRecord(null); setError(''); }, [input]);
  function run(event) {
    event.preventDefault();
    if (!input.trim() || input.length > MAX_CHARS) { setError('Enter 1–8,000 characters to review.'); return; }
    setError('');
    setRecord({ ...(claims ? splitClaimCues(input) : inspectPassage(input)), kind, generatedAt: new Date().toISOString(), mode: 'local-lexical-cues', factsVerified: false });
  }
  return <>
    <form className="review-panel" onSubmit={run} noValidate>
      <div className="review-panel-heading"><h2>{claims ? 'Separate the claim from its wording.' : 'Which words triggered the detector?'}</h2><button type="button" className="review-secondary" onClick={() => setInput(SAMPLE)}>Load example</button></div>
      <p>{claims ? 'Locate claim wording, evidence-like wording and framing in the same source. A number or an evidence word is not verification; check the underlying source yourself.' : 'Look for lexical pressure cues in a passage. The score describes wording detected by a rule set; it does not measure a reader or verify the text.'}</p>
      <label htmlFor={`review-input-${kind}`}>{claims ? 'Claim passage' : 'Passage to review'}</label>
      <textarea id={`review-input-${kind}`} rows={7} value={input} maxLength={MAX_CHARS} onChange={(event) => setInput(event.target.value)} placeholder={claims ? 'Paste a claim and its surrounding context…' : 'Paste the passage you want to inspect…'} aria-describedby={`review-privacy-${kind}`} />
      <p id={`review-privacy-${kind}`} className="review-note">Runs in this browser. Your passage is not sent to a model. {input.length.toLocaleString()} / 8,000 characters.</p>
      <div className="review-actions"><button type="submit" className="review-primary">{claims ? 'Split claim cues' : 'Review passage'}</button><span role="status">{record ? 'Review complete. Inspect the source and known limitations.' : 'Ready for your text.'}</span></div>
      {error && <p role="alert" className="review-error">{error}</p>}
    </form>
    {record && <section className="review-panel" aria-label={claims ? 'Claim split results' : 'Passage results'}>
      <div className="review-result-grid"><div>
        {claims ? <div className="review-score"><strong>{record.findings.length}</strong><div>Cues to inspect<p>Claim support remains unverified.</p></div></div> : <div className="review-score"><strong>{record.pressure}<small>/100</small></strong><div>Lexical pressure<p>Input-level heuristic, not a factual verdict.</p><a href="#review-source-passage">Inspect the source cues ↓</a></div></div>}
        <SourceEvidence id={`review-source-${kind}`} content={record.content} findings={record.findings} />
      </div><KnownLimits /></div>
      <div className="review-actions"><button type="button" className="review-secondary" onClick={() => downloadRecord(record)}>Download review JSON</button><button type="button" className="review-secondary" onClick={() => onSave(analyzeContentLocally({ content: record.content, contentType: 'text' }))}>Save on this device</button><button type="button" className="review-secondary" onClick={() => onEdit(analyzeContentLocally({ content: record.content, contentType: 'text' }))}>Edit this draft</button></div>
    </section>}
  </>;
}

function VideoReview({ input, setInput }) {
  const [media, setMedia] = useState(null);
  const [record, setRecord] = useState(null);
  const [selected, setSelected] = useState(null);
  const player = useRef(null);
  useEffect(() => { setRecord(null); setSelected(null); }, [input, media]);
  function seek(event, timestamp) {
    event.preventDefault();
    setSelected(timestamp);
    if (player.current) {
      player.current.currentTime = timestamp;
      player.current.focus({ preventScroll: true });
      player.current.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }
  function editTranscript(value) {
    setInput(value);
    if (media?.localTranscript) setMedia({ ...media, localTranscript: null });
  }
  const cueLink = (timestamp, label) => <a href={`#review-video-source`} onClick={(event) => seek(event, timestamp)}>{formatTranscriptTime(timestamp)} · {label}</a>;
  return <>
    <section className="review-panel">
      <h2>Go back to the moment.</h2>
      <p>Inspect sampled visual changes, audio energy and timestamped caption wording. Object and action recognition are unavailable in this workbench.</p>
      <MediaInputPanel media={media} onMedia={setMedia} transcript={input} onTranscript={setInput} />
      <label htmlFor="review-video-captions">Timestamped captions</label>
      <textarea id="review-video-captions" rows={6} value={input} maxLength={40000} onChange={(event) => editTranscript(event.target.value)} placeholder={'00:02 This will save time.\n00:08 We tested it on three tasks.'} aria-describedby="review-video-help" />
      <p id="review-video-help" className="review-note">Paste SRT, VTT or timestamped lines. Untimed text is not assigned invented timestamps. Video and cue review stay in this browser.</p>
      <button type="button" className="review-primary" disabled={!input.trim() && !media} onClick={() => { setRecord(buildVideoReview({ transcript: input, media })); setSelected(null); }}>Review video cues</button>
    </section>
    {media?.previewUrl && <section className="review-panel"><h3>Source video</h3><video id="review-video-source" className="review-video" ref={player} src={media.previewUrl} controls preload="metadata" aria-label="Source video playback" tabIndex={-1} /></section>}
    {record && <section className="review-panel" aria-label="Video cue results">
      <h3>Timestamped evidence</h3>
      <p role="status">{selected == null ? 'Select a timestamp to inspect that moment.' : `${media?.previewUrl ? 'Playback positioned at' : 'Selected caption timestamp'} ${formatTranscriptTime(selected)}.`}</p>
      {!media && <p id="review-video-source" className="review-empty">Playback unavailable. Add the matching local video to check these supplied timestamps.</p>}
      <div className="review-video-grid"><div><h4>Caption cues</h4><p className="review-note">{record.captionOrigin}. Classification checks words, not the truth of a claim.</p>
        {record.untimed && <p className="review-empty">Caption cues unavailable: no usable timestamps. Add timecodes or review these words in Passage.</p>}
        {!record.captions.length && !record.untimed && <p className="review-empty">No caption cues available.</p>}
        <ol className="review-findings">{record.captions.map((cue) => <li key={cue.id} className={selected === cue.start ? 'is-selected' : ''}>{cueLink(cue.start, cue.tags.includes('claim') ? 'Claim wording' : cue.tags.includes('proof') ? 'Evidence-like wording' : 'Caption')}<blockquote>{cue.text}</blockquote></li>)}</ol>
        {record.omittedCaptions > 0 && <p className="review-note">{record.omittedCaptions} caption cues fall outside this video's duration and are omitted.</p>}
      </div><div><h4>Measured media cues</h4>
        <p className="review-note">Pixel change and relative audio energy, sampled locally. These cues do not identify objects, speakers or meaning.</p>
        {record.visual.length ? <ol className="review-findings">{record.visual.map((cue, index) => <li key={`visual-${index}`}>{cueLink(cue.timestamp, cue.label)}<p>Pixel-change intensity {cue.intensity.toFixed(2)} / 1</p></li>)}</ol> : <p className="review-empty">Visual cues unavailable. Choose a browser-decodable video.</p>}
        {record.audio.length ? <ol className="review-findings">{record.audio.map((cue, index) => <li key={`audio-${index}`}>{cueLink(cue.timestamp, 'Audio energy')}<p>Relative energy {cue.energy} / 100 · largest sampled changes</p></li>)}</ol> : <p className="review-empty">Audio energy unavailable. No usable decoded audio samples.</p>}
      </div></div>
      <p className="review-note">Caption detection can miss paraphrases and flag benign wording. Sparse visual samples can miss changes between frames. Relative audio energy cannot establish speech or emotion.</p>
      <button type="button" className="review-secondary" onClick={() => downloadRecord(record, 'brainsnn-video-cues.json')}>Download cues JSON</button>
    </section>}
  </>;
}

function SavedReviews({ saved, queue, onRestore, onCompare, onApprove }) {
  return <details className="review-panel review-saved"><summary>Saved reviews on this device <span>{saved.length}</span></summary>
    <p>Your earlier saved scans and versions remain here. Opening a source starts a fresh review; the original record stays available to download.</p>
    {!saved.length && <p className="review-note">No saved reviews on this device yet.</p>}
    <ul>{saved.map((item) => <li key={item.id}><strong>{item.title}</strong><small>{item.savedAt?.slice(0, 10)} · {item.inputType}</small>
      <div className="review-actions"><button type="button" className="review-secondary" onClick={() => onRestore(item.result.rawContent || '', item.inputType)}>Open source</button><button type="button" className="review-secondary" onClick={() => downloadRecord(item, `brainsnn-saved-${item.id.replace(/[^a-z0-9_-]/gi, '_')}.json`)}>Download original record</button></div>
      {item.versions?.length > 0 && <details><summary>Versions ({item.versions.length})</summary><ul>{item.versions.map((version, index) => <li key={version.id || index}><span>{version.label || `Version ${index + 1}`}</span><button type="button" className="review-secondary" onClick={() => onRestore(version.content || version.result?.rawContent || '', item.inputType)}>Open version</button>{index > 0 && <button type="button" className="review-secondary" onClick={() => onCompare(item.result.rawContent || '', version.content || version.result?.rawContent || '')}>Compare with original</button>}</li>)}</ul></details>}
    </li>)}</ul>
    <h3>Review queue</h3><p className="review-note">Approval is your recorded decision, not a model verdict.</p>
    {!queue.length && <p>No drafts in the review queue.</p>}
    <ul>{queue.map(item => <li key={item.id}><strong>{item.title}</strong><small>{item.status}</small><div className="review-actions"><button className="review-secondary" type="button" onClick={() => onRestore(item.versions?.at(-1)?.content || item.result?.rawContent || '', 'text')}>Open queued draft</button><button className="review-secondary" type="button" onClick={() => downloadRecord(item)}>Download queued record</button>{item.status !== 'Approved' && <button className="review-secondary" type="button" onClick={() => onApprove(item.id)}>Approve this draft</button>}</div></li>)}</ul>
  </details>;
}

export function ReviewWorkbench({ initialInput = '' }) {
  const history = useScanHistory();
  const [queue, setQueue] = useState(loadQueue);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState(() => reviewTabFromSearch(window.location.search));
  const [inputs, setInputs] = useState({ passage: initialInput, claims: '', video: '' });
  const [comparison, setComparison] = useState({ sequence: 0, original: '', candidate: '' });
  useEffect(() => {
    const update = () => setTab(reviewTabFromSearch(window.location.search));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  useEffect(() => { document.title = `${REVIEW_TABS.find(({ id }) => id === tab).label} · Review | BrainSNN`; }, [tab]);
  function changeTab(next, event) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    event?.preventDefault();
    const url = new URL(window.location.href);
    url.pathname = '/office'; url.searchParams.set('tab', next); url.hash = '';
    if (tab !== next || window.location.search !== url.search) window.history.pushState({}, '', `${url.pathname}${url.search}`);
    setTab(next);
  }
  function save(result) {
    const record = history.addResult(result);
    setNotice(record && loadMemory().some(item => item.id === record.id) ? 'Review saved on this device.' : 'This review could not be saved.');
  }
  function queueDraft(result, content, comparison, status = 'Ready') {
    const item = { id: `${result.id}-${Date.now().toString(36)}`, title: result.title || 'Review draft', status, updatedAt: new Date().toISOString(), result: comparison || result, versions: [{ id: 'v1', label: 'Original', content: result.rawContent }, { id: 'v2', label: 'Edited draft', content }] };
    saveQueue([item, ...queue]);
    const persisted = loadQueue();
    setQueue(persisted);
    setNotice(!persisted.some(entry => entry.id === item.id) ? 'This browser could not save the queued draft.' : status === 'Approved' ? 'Your approval was recorded on this device.' : 'Draft added to your review queue on this device.');
  }
  function restore(content, type) {
    const target = type === 'video' || type === 'script' ? 'video' : 'passage';
    setInputs((current) => ({ ...current, [target]: content }));
    changeTab(target);
    document.getElementById('review-tabs')?.scrollIntoView({ block: 'start' });
  }
  return <main id="review-main" className="review-workbench" data-testid="review-workbench">
    <header className="review-intro"><p className="review-eyebrow">REVIEW</p><h1>Follow the signal.<br /><span>Check the source.</span></h1><p>One workbench for a passage, an edit, a claim or a moment in video. Keep the evidence and the misses in view.</p></header>
    <nav id="review-tabs" className="review-tabs" aria-label="Review tabs">{REVIEW_TABS.map(({ id, label }) => <a key={id} href={`/office?tab=${id}`} aria-current={id === tab ? 'page' : undefined} onClick={(event) => changeTab(id, event)}>{label}</a>)}</nav>
    {['passage', 'claims'].map((kind) => <section key={kind} className="review-tab-panel" hidden={tab !== kind} aria-label={kind === 'claims' ? 'Claim split' : 'Passage'}><TextReview onSave={save} onEdit={(result) => { setEditing(result); changeTab('drafts'); }} kind={kind} input={inputs[kind]} setInput={(value) => setInputs((current) => ({ ...current, [kind]: value }))} /></section>)}
    <section className="review-tab-panel" hidden={tab !== 'drafts'} aria-label="Two drafts"><EngineWorkspace embedded key={comparison.sequence} initialInputs={comparison} />
      <details className="review-panel" open={editing ? true : undefined}><summary>Edit a draft with suggested fixes</summary>
        {editing ? <ImprovementWorkspace embedded result={editing} onGoToCortex={() => changeTab('passage')} onCompare={(original, candidate) => { setComparison(current => ({ sequence: current.sequence + 1, original, candidate })); document.getElementById('ew-input-title')?.scrollIntoView({ block: 'start' }); }} onSaveVersion={(result, text, scored) => { history.addVersion(result, text, scored); setNotice(loadMemory().some(item => item.id === result.id && item.versions.some(version => version.content === text)) ? 'Version saved on this device.' : 'This browser could not save the version.'); }} onQueue={queueDraft} onApprove={(result, text, scored) => queueDraft(result, text, scored, 'Approved')} /> : <p>Review a passage, then choose “Edit this draft” to apply and undo source-based edits.</p>}
      </details>
    </section>
    <section className="review-tab-panel" hidden={tab !== 'video'} aria-label="Video cues"><VideoReview input={inputs.video} setInput={(value) => setInputs((current) => ({ ...current, video: value }))} /></section>
    {notice && <p role="status" className="review-note">{notice}</p>}
    <SavedReviews saved={history.items} queue={queue} onApprove={(id) => setQueue(saveQueue(queue.map(item => item.id === id ? { ...item, status: 'Approved', updatedAt: new Date().toISOString() } : item)))} onRestore={restore} onCompare={(original, candidate) => { setComparison((current) => ({ sequence: current.sequence + 1, original, candidate })); changeTab('drafts'); document.getElementById('review-tabs')?.scrollIntoView({ block: 'start' }); }} />
  </main>;
}
