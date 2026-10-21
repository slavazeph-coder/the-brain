import React, { useEffect, useMemo, useState } from 'react';
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
const MAX_SINGLE = 150 * 1024 * 1024;
const MAX_TOTAL = 250 * 1024 * 1024;
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

export function WorldScan() {
  const [useCase, setUseCase] = useState(useCaseFromURL);
  const [spaceName, setSpaceName] = useState('');
  const [files, setFiles] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const previews = useMemo(() => files.map(file => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => {
    document.title = 'Capture a space | BrainSNN World Engine';
    track('world_capture_opened');
  }, []);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);

  function chooseFiles(list) {
    const received = Array.from(list || []);
    if (!received.length) return;
    if (received.length > MAX_FILES) { setError('Choose up to eight photos, or one short video.'); return; }
    if (received.some(file => !isSupported(file))) { setError('Use JPG, PNG, WebP, MP4, MOV or WebM files.'); return; }
    if (received.some(file => file.size > MAX_SINGLE) || received.reduce((sum,file) => sum + file.size, 0) > MAX_TOTAL) {
      setError('Keep files under 150 MB each and 250 MB combined.'); return;
    }
    if (received.filter(isVideo).length > 1) { setError('Choose one video at a time, or up to eight still photos.'); return; }
    if (received.some(isVideo) && received.length > 1) { setError('Choose a single video or a group of photos, not both in the same capture.'); return; }
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
  const workerUrl = '/arena/#playground?view=site&robot=g1&model=groot&task=Supported+reach&seed=42';
  return <div className="bh-site world-site world-capture-page" data-build-marker="world-engine-capture-v1">
    <a className="bh-skip" href="#capture-main">Skip to capture</a>
    <PublicNav active="scan" />
    <main id="capture-main" className="world-capture-main">
      <a className="world-capture-back" href="/"><ArrowLeft size={15} aria-hidden="true"/> World Engine</a>
      <header className="world-capture-header">
        <p className="world-section-kicker">BRAINSNN CAPTURE STUDIO / EARLY ACCESS</p>
        <h1>Capture a space.<br/><span>Make it a world.</span></h1>
        <p>Start with an ordinary video or photo set. Preview it privately in your browser, follow the capture checklist, and continue to the existing reconstruction workspace when you have a compatible GPU worker.</p>
      </header>
      <div className="world-capture-layout">
        <section className="world-drop-card" aria-labelledby="world-upload-title">
          <div className="world-drop-top"><strong id="world-upload-title">01 / Your capture</strong><span>Local preview · no auto-upload</span></div>
          <label className={'world-dropzone' + (dragOver ? ' is-over' : '')} onDragEnter={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={event => { event.preventDefault(); setDragOver(false); }} onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
            <UploadCloud size={35} strokeWidth={1.5} aria-hidden="true"/>
            <strong>{files.length ? 'Replace this capture' : 'Drop your video or photos here'}</strong>
            <span>or tap to choose files from your device</span>
            <small>MP4, MOV, WebM, JPG, PNG, WebP · up to 250 MB total</small>
            <input type="file" accept={ACCEPT} multiple onChange={event => { chooseFiles(event.target.files); event.target.value = ''; }} aria-label="Select phone video or photographs"/>
          </label>
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
            <p>{video ? 'Your video can be previewed here. A compatible reconstruction worker can accept a supported video after you select it again in the Arena.' : 'Your photos are ready for review. Multi-photo reconstruction will require a supported frame archive and connected worker; this page does not yet convert individual photos into a scene.'} {needMorePhotos ? ' For better geometry, capture more overlapping views before reconstructing.' : ''}</p>
            <div className="world-scan-actions">
              <a href={workerUrl} className="world-button world-button-primary" onClick={() => track('world_capture_worker_handoff', { use_case: useCase })}>Open reconstruction workspace <ArrowRight size={15} aria-hidden="true" /></a>
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
              <a className="world-button world-button-outline" href={workerUrl}><Bot size={16} aria-hidden="true" /> Existing Arena site tools <ArrowRight size={16} aria-hidden="true" /></a>
              <small>The Arena can process captures through a separately connected, compatible worker. You will need to select your file again there.</small>
            </div>
          </section>
          <div className="world-privacy-card"><CircleHelp size={20} aria-hidden="true"/><div><strong>What's available now?</strong><p>This page is a private capture preview and guide, not a live consumer reconstruction service. Dense reconstruction, automatic object segmentation and calibrated professional exports are planned capabilities.</p></div></div>
        </aside>
      </div>
    </main>
    <PublicFooter />
  </div>;
}
