import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Camera, CircleHelp, FileVideo, LockKeyhole, ScanLine, UploadCloud } from 'lucide-react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { track } from '../lib/analytics.js';
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
  const [useCase, setUseCase] = useState(useCaseFromURL);
  const [spaceName, setSpaceName] = useState('');
  const [files, setFiles] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const videoInput = useRef(null);
  const previews = useMemo(() => files.map(file => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => {
    document.title = 'Capture a space | BrainSNN World Engine';
    track('world_capture_opened');
  }, []);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);

  async function chooseFiles(list) {
    const received = Array.from(list || []);
    if (!received.length) return;
    if (received.length > MAX_FILES) { setError('Choose up to eight photos, or one video.'); return; }
    if (received.some(file => !isSupported(file))) { setError('Use JPG, PNG, WebP, MP4, MOV or WebM files.'); return; }
    if (received.filter(isVideo).length > 1) { setError('Choose one video at a time, or up to eight still photos.'); return; }
    if (received.some(isVideo) && received.length > 1) { setError('Choose a single video or a group of photos, not both in the same capture.'); return; }
    if (received.some(file => isVideo(file) ? file.size > MAX_VIDEO : file.size > MAX_PHOTO)) {
      setError('Videos can be up to 2 GB and photos up to 200 MB each. Record at 1080p for a smaller file.'); return;
    }
    const seconds = received.some(isVideo) ? await videoSeconds(received[0]) : null;
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
  function remove() { setFiles([]); setActiveIndex(0); setError(''); }
  const current = previews[activeIndex] || null;
  const video = files.some(isVideo);
  const needMorePhotos = files.length > 0 && !video && files.length < 6;
  const pilotSubject = encodeURIComponent('BrainSNN World Engine pilot - ' + USE_CASES.find(item => item.id === useCase)?.label);
  const workerUrl = '/world/index.html#workspace';
  return <div className="bh-site world-site world-capture-page" data-build-marker="world-engine-capture-v1">
    <a className="bh-skip" href="#capture-main">Skip to capture</a>
    <PublicNav active="scan" />
    <main id="capture-main" className="world-capture-main">
      <a className="world-capture-back" href="/"><ArrowLeft size={15} aria-hidden="true"/> World Engine</a>
      <header className="world-capture-header">
        <p className="world-section-kicker">BRAINSNN CAPTURE STUDIO / EARLY ACCESS</p>
        <h1>Capture a space.<br/><span>Make it a world.</span></h1>
        <p>Start with an ordinary video or photo set. Preview it privately in your browser, follow the capture checklist, and continue in World Builder to create a 3D preview, reconstruct a walkthrough with a connected worker and plan a robot route.</p>
      </header>
      <div className="world-capture-layout">
        <section className="world-drop-card" aria-labelledby="world-upload-title">
          <div className="world-drop-top"><strong id="world-upload-title">01 / Your capture</strong><span>Local preview · no auto-upload</span></div>
          <label className={'world-dropzone' + (dragOver ? ' is-over' : '')} onDragEnter={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={event => { event.preventDefault(); setDragOver(false); }} onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
            <UploadCloud size={35} strokeWidth={1.5} aria-hidden="true"/>
            <strong>{files.length ? 'Replace this capture' : 'Drop your video or photos here'}</strong>
            <span>or tap to choose files from your device</span>
            <small>MP4, MOV, WebM, JPG, PNG, WebP · videos up to 5 min and 2 GB · photos up to 200 MB each</small>
            <input type="file" accept={ACCEPT} multiple onChange={event => { chooseFiles(event.target.files); event.target.value = ''; }} aria-label="Select phone video or photographs"/>
          </label>
          {/* A video-only list gets the phone gallery's plain video picker; galleries treat a mixed photo and video list differently. */}
          <button type="button" className="world-button world-button-outline" onClick={() => videoInput.current?.click()}><FileVideo size={16} aria-hidden="true" /> Choose a walkthrough video</button>
          <input ref={videoInput} type="file" accept="video/*" hidden onChange={event => { chooseFiles(event.target.files); event.target.value = ''; }} aria-label="Select a walkthrough video"/>
          <p className="world-capture-note">On a phone, a long video can take a minute to prepare after you pick it; keep this page open.</p>
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
          <p className="world-capture-note"><LockKeyhole size={15} aria-hidden="true"/> Your files and space name stay on this page. No media is sent to BrainSNN or any worker automatically.</p>
          {files.length > 0 && <div className="world-scan-ready">
            <h3>Capture prepared</h3>
            <p>{video ? 'Your video can be previewed here. In World Builder, a connected reconstruction worker can turn it into points and camera poses, then a proposed robot planning map. Select the file again there.' : 'Your photos are ready for review. Multi-photo reconstruction will require a supported frame archive and connected worker; this page does not yet convert individual photos into a scene.'} {needMorePhotos ? ' For better geometry, capture more overlapping views before reconstructing.' : ''}</p>
            <div className="world-scan-actions">
              <a href={workerUrl} className="world-button world-button-primary" onClick={() => track('world_capture_worker_handoff', { use_case: useCase })}>Open World Builder <ArrowRight size={15} aria-hidden="true" /></a>
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
              <a className="world-button world-button-outline" href={workerUrl}><Bot size={16} aria-hidden="true" /> Continue in World Builder <ArrowRight size={16} aria-hidden="true" /></a>
              <small>World Builder processes captures through a separately connected, compatible worker. You will need to select your file again there.</small>
            </div>
          </section>
          <div className="world-privacy-card"><CircleHelp size={20} aria-hidden="true"/><div><strong>What's available now?</strong><p>This page is a private capture preview and guide, not a live consumer reconstruction service. Dense reconstruction, automatic object segmentation and calibrated professional exports are planned capabilities.</p></div></div>
        </aside>
      </div>
    </main>
    <PublicFooter />
  </div>;
}
