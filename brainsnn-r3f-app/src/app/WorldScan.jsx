import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Camera, CircleHelp, FileVideo, LockKeyhole, ScanLine, Type, UploadCloud, Volume2 } from 'lucide-react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { track } from '../lib/analytics.js';
import { WORLD_GOALS, goalById, goalFromSearch } from './worldGoals.js';
import '../styles/world-engine.css';

const USE_CASES = [
  { id: 'general', label: 'Explore a space' },
  { id: 'real-estate', label: 'Real estate' },
  { id: 'trades', label: 'Construction / trades' },
  { id: 'architecture', label: 'Architecture / design' },
  { id: 'robotics', label: 'Robotics' },
  { id: 'industrial', label: 'Industrial / facilities' },
  { id: 'developers', label: 'Developer / API' },
];
const ACCEPT = 'video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp';
const MAX_FILES = 8;
// The same limits as World Builder, where the capture is processed: photos 200 MiB each, one video of up to five
// minutes and 2 GiB. A 2:22 phone video at 1080p60 or 4K is 200-400 MB, over the 150 MB this page allowed before.
const MAX_PHOTO = 200 * 1024 * 1024;
const MAX_VIDEO = 2 * 1024 ** 3;
const MAX_VIDEO_SECONDS = 300;
function formatSize(size) { return (size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0) + ' MB'; }
function useCaseFromURL() {
  if (typeof window === 'undefined') return 'general';
  const value = new URLSearchParams(window.location.search).get('use');
  return USE_CASES.some(option => option.id === value) ? value : 'general';
}
function isSupported(file) {
  return ['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    || /\.(mp4|mov|webm|jpe?g|png|webp)$/i.test(file.name);
}
function isVideo(file) { return file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name); }
/** A video's length from its metadata; null when this browser cannot tell (World Builder's worker checks again). */
function videoSeconds(file) {
  return new Promise(resolve => {
    const node = document.createElement('video'), url = URL.createObjectURL(file);
    let timer = 0;
    const done = value => { if (!timer) return; clearTimeout(timer); timer = 0; node.removeAttribute('src'); node.load(); URL.revokeObjectURL(url); resolve(Number.isFinite(value) && value > 0 ? value : null); };
    timer = setTimeout(() => done(null), 8000);
    node.preload = 'metadata'; node.muted = true;
    node.onloadedmetadata = () => done(node.duration); node.onerror = () => done(null);
    node.src = url;
  });
}

export function WorldScan() {
  const [goal, setGoal] = useState(() => goalFromSearch(typeof window === 'undefined' ? '' : window.location.search));
  const [useCase, setUseCase] = useState(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('use')) return useCaseFromURL();
    return goalById(goalFromSearch(typeof window === 'undefined' ? '' : window.location.search)).useCase;
  });
  const [largeText, setLargeText] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [files, setFiles] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const videoInput = useRef(null);
  const anyInput = useRef(null);
  // Each choice (and Clear) starts a new selection; a video's length check that finishes after a newer one is dropped.
  const selection = useRef(0);
  const previews = useMemo(() => files.map(file => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => {
    document.title = 'Capture a space | BrainSNN World Engine';
    track('world_capture_opened');
  }, []);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);
  // Spoken guidance is opt-in and uses the browser's own voice; no capture is sent to speech services by this page.
  useEffect(() => () => { if (typeof window !== 'undefined') window.speechSynthesis?.cancel(); }, []);
  // A picker that returns no file (closed, or on iPhone a video whose conversion failed) says so instead of doing nothing.
  useEffect(() => {
    const inputs = [videoInput.current, anyInput.current].filter(Boolean);
    const none = () => setError('No file came back from your phone\'s picker. On iPhone, a video picked from Photo Library is converted first and that can fail for a long video: in Photos, tap Share → Save to Files, then pick it here with Choose File.');
    inputs.forEach(input => input.addEventListener('cancel', none));
    return () => inputs.forEach(input => input.removeEventListener('cancel', none));
  }, []);

  async function chooseFiles(list) {
    const received = Array.from(list || []);
    if (!received.length) return;
    const mine = ++selection.current;
    if (received.length > MAX_FILES) { setError('Choose up to eight photos, or one video.'); return; }
    if (received.some(file => !isSupported(file))) { setError('Use JPG, PNG, WebP, MP4, MOV or WebM files.'); return; }
    if (received.filter(isVideo).length > 1) { setError('Choose one video at a time, or up to eight still photos.'); return; }
    if (received.some(isVideo) && received.length > 1) { setError('Choose a single video or a group of photos, not both in the same capture.'); return; }
    if (received.some(file => isVideo(file) ? file.size > MAX_VIDEO : file.size > MAX_PHOTO)) {
      setError('Videos can be up to 2 GB and photos up to 200 MB each. Record at 1080p for a smaller file.'); return;
    }
    const seconds = received.some(isVideo) ? await videoSeconds(received[0]) : null;
    if (mine !== selection.current) return;
    if (seconds !== null && seconds > MAX_VIDEO_SECONDS + 1) { setError(`This video is ${(seconds / 60).toFixed(1)} minutes long. Walkthroughs can be up to five minutes; trim it, then choose it again.`); return; }
    setFiles(received);
    setActiveIndex(0);
    setError('');
    track('world_capture_local_files_prepared', { kind: received.some(isVideo) ? 'video' : 'photos', count: received.length });
  }
  function handleDrop(event) {
    event.preventDefault();
    setDragOver(false);
    chooseFiles(event.dataTransfer?.files);
  }
  function remove() { selection.current += 1; setFiles([]); setActiveIndex(0); setError(''); }
  // Explicit click, local same-origin transfer, no worker upload. iOS may refuse large IndexedDB writes,
  // in which case the fallback leaves the original capture untouched and asks for a fresh picker.
  async function continueWithCapture() {
    if (!files.length || handoffBusy) return;
    const chosen = selection.current;
    setHandoffBusy(true);
    setError('');
    try {
      const { stageLocalCapture, clearLocalCapture } = await import(/* @vite-ignore */ '/world/capture-handoff.mjs');
      const id = await stageLocalCapture(files, { goal });
      if (chosen !== selection.current) { await clearLocalCapture(id); return; }
      track('world_capture_local_handoff', { goal, count: files.length, kind: files.some(isVideo) ? 'video' : 'photos' });
      window.location.assign('/world/index.html#handoff=' + id);
    } catch (reason) {
      setError('This browser could not move the selected capture privately to World Builder. Your original file is unchanged. Open World Builder below and choose the file again. ' + (reason?.message || 'Local storage failed.'));
    } finally { setHandoffBusy(false); }
  }
  function selectGoal(id) {
    const next = goalById(id);
    setGoal(next.id);
    setUseCase(next.useCase);
    setError('');
    track('world_capture_goal_selected', { goal: next.id });
  }
  function speakGuide() {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      setError('Spoken instructions are unavailable in this browser. All the steps are written below.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(selectedGoal.title + '. ' + selectedGoal.guidance + ' ' + selectedGoal.captureTip);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }
  const selectedGoal = goalById(goal);
  const current = previews[activeIndex] || null;
  const video = files.some(isVideo);
  const needMorePhotos = files.length > 0 && !video && files.length < 6;
  const pilotSubject = encodeURIComponent('BrainSNN World Engine pilot - ' + USE_CASES.find(item => item.id === useCase)?.label);
  const workerUrl = '/world/index.html#workspace';
  return <div className={'bh-site world-site world-capture-page' + (largeText ? ' is-large-text' : '')} data-build-marker="world-engine-capture-v1">
    <a className="bh-skip" href="#capture-main">Skip to capture</a>
    <PublicNav active="scan" />
    <main id="capture-main" className="world-capture-main">
      <a className="world-capture-back" href="/"><ArrowLeft size={15} aria-hidden="true"/> World Engine</a>
      <header className="world-capture-header">
        <p className="world-section-kicker">BRAINSNN CAPTURE STUDIO / EARLY ACCESS</p>
        <h1>Capture a space.<br/><span>Make it a world.</span></h1>
        <p>Take a photo or video. Choose what you want to do, follow a few simple steps and explore your space. Advanced reconstruction, building models and robot planning require a connected worker and review.</p>
      </header>
      <section className="world-goal-section" aria-labelledby="world-goal-title">
        <div className="world-goal-header">
          <div>
            <p className="world-section-kicker">START WITH YOUR GOAL</p>
            <h2 id="world-goal-title">What would you like to do?</h2>
          </div>
          <div className="world-goal-accessibility" aria-label="Reading options">
            <button type="button" aria-pressed={largeText} onClick={() => setLargeText(value => !value)}><Type size={18} aria-hidden="true" /> Larger text</button>
            <button type="button" onClick={speakGuide}><Volume2 size={18} aria-hidden="true" /> Hear the steps</button>
          </div>
        </div>
        <div className="world-goal-grid" role="group" aria-label="Choose an activity">
          {WORLD_GOALS.map((item, index) => <button type="button" key={item.id} className={'world-goal-card' + (goal === item.id ? ' is-selected' : '')} aria-pressed={goal === item.id} onClick={() => selectGoal(item.id)}>
            <span className="world-goal-availability">{String(index + 1).padStart(2, '0')} / {item.availability}</span>
            <strong>{item.title}</strong>
            <span>{item.summary}</span>
          </button>)}
        </div>
        <p className="world-goal-guidance" role="status">{selectedGoal.guidance}</p>
        <a className="world-goal-next" href="#capture-card">Continue to capture <ArrowRight size={16} aria-hidden="true" /></a>
      </section>
      <div className="world-capture-layout">
        <section id="capture-card" className="world-drop-card" aria-labelledby="world-upload-title">
          <div className="world-drop-top"><strong id="world-upload-title">01 / Your capture</strong><span>Local preview · no auto-upload</span></div>
          <p className="world-goal-capture-tip">{selectedGoal.captureTip}</p>
          <label className={'world-dropzone' + (dragOver ? ' is-over' : '')} onDragEnter={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={event => { event.preventDefault(); setDragOver(false); }} onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
            <UploadCloud size={35} strokeWidth={1.5} aria-hidden="true"/>
            <strong>{files.length ? 'Replace this capture' : 'Drop your video or photos here'}</strong>
            <span>or tap to choose files from your device</span>
            <small>MP4, MOV, WebM, JPG, PNG, WebP · videos up to 5 min and 2 GB · photos up to 200 MB each</small>
            <input ref={anyInput} type="file" accept={ACCEPT} multiple onChange={event => { chooseFiles(event.target.files); event.target.value = ''; }} aria-label="Select phone video or photographs"/>
          </label>
          {/* A video-only list gets the phone gallery's plain video picker; galleries treat a mixed photo and video list differently. */}
          <button type="button" className="world-button world-button-outline" onClick={() => videoInput.current?.click()}><FileVideo size={16} aria-hidden="true" /> Choose a walkthrough video</button>
          <input ref={videoInput} type="file" accept="video/*" hidden onChange={event => { chooseFiles(event.target.files); event.target.value = ''; }} aria-label="Select a walkthrough video"/>
          <p className="world-capture-note">On iPhone, Photo Library converts a video before this page gets it, which can take minutes for a long 4K video. Faster: in Photos, Share → Save to Files, then pick it here with Choose File.</p>
          {error && <p className="world-capture-alert" role="alert">{error}</p>}
          {current && <div className="world-upload-preview">
            {isVideo(current.file)
              ? <video key={current.url} src={current.url} controls playsInline preload="metadata" aria-label="Local video preview" />
              : <img key={current.url} src={current.url} alt={'Local photo preview ' + (activeIndex + 1)} />}
            <div className="world-upload-preview-footer"><span>{current.file.name} · {formatSize(current.file.size)}</span><button type="button" onClick={remove}>Clear</button></div>
          </div>}
          {previews.length > 1 && <div className="world-file-list" role="group" aria-label="Preview selected photos">
            {previews.map((item, index) => <button type="button" aria-pressed={index === activeIndex} onClick={() => setActiveIndex(index)} key={index}>{index + 1}. {item.file.name}</button>)}
          </div>}
          <details className="world-capture-advanced"><summary>More details (optional)</summary>
          <div className="world-capture-options">
            <label className="world-capture-field">What will you use the 3D world for?
              <select value={useCase} onChange={event => setUseCase(event.target.value)}>
                {USE_CASES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="world-capture-field">Name your space (optional)
              <input type="text" maxLength={80} placeholder="e.g. Gym floor, living room" value={spaceName} onChange={event => setSpaceName(event.target.value)} />
            </label>
          </div>
          </details>
          <p className="world-capture-note"><LockKeyhole size={15} aria-hidden="true"/> Your files stay on this device until you approve a worker upload. Continue privately stores a temporary local browser copy, valid for 20 minutes and cleared after import. Unused copies are deleted when the handoff is revisited after expiry.</p>
          {files.length > 0 && <div className="world-scan-ready">
            <h3>Capture prepared</h3>
            <p>{video ? 'Your video is ready for World Builder. A compatible connected worker can reconstruct camera poses and points. Reconstruction can be partial and must be reviewed before using dimensions or routes.' : 'Your photos are ready to explore in World Builder. Individual photos support visual previews; calibrated multi-photo reconstruction still needs a compatible capture and worker.'} {needMorePhotos ? ' For better geometry, capture more overlapping views before reconstructing.' : ''}</p>
            <div className="world-scan-actions">
              <button type="button" disabled={handoffBusy} className="world-button world-button-primary" onClick={continueWithCapture}>{handoffBusy ? 'Preparing private handoff…' : 'Continue with this capture'} <ArrowRight size={15} aria-hidden="true" /></button>
              <a href={workerUrl} className="world-button world-button-outline">Open without transfer</a>
              <a href={'mailto:info@xioai.ca?subject=' + pilotSubject} className="world-button world-button-outline">Request pilot access <ArrowRight size={15} aria-hidden="true" /></a>
            </div>
          </div>}
        </section>
        <aside>
          <section className="world-guide-card" aria-label="Capture checklist">
            <h2>For a better 3D scan</h2>
            <div className="world-guide-step"><span>01</span><div><strong>Walk slowly</strong><p>Keep the room in view. Avoid rapid turns, motion blur and large jumps between camera positions.</p></div></div>
            <div className="world-guide-step"><span>02</span><div><strong>Overlap your views</strong><p>Film the same surfaces from several angles. Move around furniture and reveal corners where possible.</p></div></div>
            <div className="world-guide-step"><span>03</span><div><strong>Include a measurement</strong><p>Record a known dimension or reference marker if you intend to use the reconstruction for measurements.</p></div></div>
            <div className="world-guide-cta">
              {files.length ? <button type="button" disabled={handoffBusy} className="world-button world-button-outline" onClick={continueWithCapture}><Bot size={16} aria-hidden="true" /> {handoffBusy ? 'Preparing transfer…' : 'Continue with selected file'} <ArrowRight size={16} aria-hidden="true" /></button> : <a className="world-button world-button-outline" href={workerUrl}><Bot size={16} aria-hidden="true" /> Open World Builder <ArrowRight size={16} aria-hidden="true" /></a>}
              <small>Files are transferred within this browser after you choose Continue; they are not uploaded to any worker automatically. If transfer is unavailable, open World Builder and select the file there.</small>
            </div>
          </section>
          <div className="world-privacy-card"><CircleHelp size={20} aria-hidden="true"/><div><strong>What's available now?</strong><p>This page previews files privately. Advanced reconstruction and IFC/Rhino exports require an authorized worker, measurements and human review. Public hosted signup is not available.</p></div></div>
        </aside>
      </div>
    </main>
    <PublicFooter />
  </div>;
}
