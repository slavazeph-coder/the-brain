import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Box, CircleHelp, LockKeyhole, UploadCloud } from 'lucide-react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { track } from '../lib/analytics.js';
import {
  MAX_PHOTOS, MAX_UPLOAD_BYTES, reconstructionInput, rememberWorld, rememberedWorlds, requestTicket, uploadCapture,
  worldStatus, zipPhotos,
} from '../lib/worldClient.js';
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
const MAX_SINGLE = 150 * 1024 * 1024;

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
  const [service, setService] = useState(null);
  const [sending, setSending] = useState(null);
  const [recent] = useState(rememberedWorlds);
  const abort = useRef(null);
  const previews = useMemo(() => files.map(file => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => {
    document.title = 'Capture a space | BrainSNN World Engine';
    track('world_capture_opened');
    worldStatus().then(setService);
    return () => abort.current?.abort();
  }, []);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);

  function chooseFiles(list) {
    const received = Array.from(list || []);
    if (!received.length || sending) return;
    if (received.length > MAX_PHOTOS) { setError(`Choose up to ${MAX_PHOTOS} photos, or one video.`); return; }
    if (received.some(file => !isSupported(file))) { setError('Use JPG, PNG, WebP, MP4, MOV or WebM files.'); return; }
    if (received.some(file => file.size > MAX_SINGLE) || received.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_BYTES) {
      setError('Keep files under 150 MB each and 250 MB combined.'); return;
    }
    if (received.filter(isVideo).length > 1) { setError('Choose one video at a time, or a group of photos.'); return; }
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
  function remove() { if (!sending) { setFiles([]); setActiveIndex(0); setError(''); } }

  async function buildWorld() {
    const input = reconstructionInput(files);
    if (!input.ok || sending) { setError(input.reason || ''); return; }
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      setSending({ phase: input.kind === 'photos' ? 'Packing photos' : 'Preparing upload', progress: 0 });
      const body = input.kind === 'photos' ? await zipPhotos(files) : files[0];
      const { ticket, workerUrl } = await requestTicket();
      track('world_reconstruction_started', { kind: input.kind, use_case: useCase });
      const scan = await uploadCapture({
        workerUrl, ticket, body, mediaType: input.mediaType, filename: input.kind === 'photos' ? 'photos.zip' : files[0].name,
        signal: controller.signal, onProgress: progress => setSending({ phase: 'Uploading to the reconstruction worker', progress }),
      });
      const name = spaceName.trim() || (input.kind === 'photos' ? 'Photo capture' : files[0].name.replace(/\.[^.]+$/, ''));
      rememberWorld({ id: scan.id, key: scan.accessKey, name: name.slice(0, 80), createdAt: Date.now() });
      window.location.assign(`/world/${scan.id}#k=${scan.accessKey}`);
    } catch (failure) {
      setSending(null);
      if (failure.code !== 'cancelled') setError(failure.message || 'The capture could not be sent. Please try again.');
    } finally {
      abort.current = null;
    }
  }

  const current = previews[activeIndex] || null;
  const video = files.some(isVideo);
  const ready = reconstructionInput(files);
  const connected = Boolean(service?.configured);
  const pilotSubject = encodeURIComponent('BrainSNN World Engine pilot - ' + USE_CASES.find(item => item.id === useCase)?.label);
  return <div className="bh-site world-site world-capture-page" data-build-marker="world-engine-capture-v2">
    <a className="bh-skip" href="#capture-main">Skip to capture</a>
    <PublicNav active="scan" />
    <main id="capture-main" className="world-capture-main">
      <a className="world-capture-back" href="/"><ArrowLeft size={15} aria-hidden="true"/> World Engine</a>
      <header className="world-capture-header">
        <p className="world-section-kicker">BRAINSNN CAPTURE STUDIO / EARLY ACCESS</p>
        <h1>Capture a space.<br/><span>Make it a world.</span></h1>
        <p>Start with an ordinary video or a set of overlapping photos. Preview it here, then send it to the reconstruction worker to turn it into an explorable 3D world.</p>
      </header>
      <div className="world-capture-layout">
        <section className="world-drop-card" aria-labelledby="world-upload-title">
          <div className="world-drop-top"><strong id="world-upload-title">01 / Your capture</strong><span>Preview first · nothing sent until you choose</span></div>
          <label className={'world-dropzone' + (dragOver ? ' is-over' : '')} onDragEnter={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={event => { event.preventDefault(); setDragOver(false); }} onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
            <UploadCloud size={35} strokeWidth={1.5} aria-hidden="true"/>
            <strong>{files.length ? 'Replace this capture' : 'Drop your video or photos here'}</strong>
            <span>or tap to choose files from your device</span>
            <small>MP4, MOV, WebM, JPG, PNG, WebP · up to 250 MB total</small>
            <input type="file" accept={ACCEPT} multiple disabled={Boolean(sending)} onChange={event => { chooseFiles(event.target.files); event.target.value = ''; }} aria-label="Select phone video or photographs"/>
          </label>
          {error && <p className="world-capture-alert" role="alert">{error}</p>}
          {current && <div className="world-upload-preview">
            {isVideo(current.file)
              ? <video key={current.url} src={current.url} controls playsInline preload="metadata" aria-label="Local video preview" />
              : <img key={current.url} src={current.url} alt={'Local photo preview ' + (activeIndex + 1)} />}
            <div className="world-upload-preview-footer"><span>{files.length > 1 ? `${files.length} photos · ` : ''}{current.file.name} · {formatSize(current.file.size)}</span><button type="button" onClick={remove} disabled={Boolean(sending)}>Clear</button></div>
          </div>}
          {previews.length > 1 && <div className="world-file-list" role="group" aria-label="Preview selected photos">
            {previews.slice(0, 24).map((item, index) => <button type="button" aria-pressed={index === activeIndex} onClick={() => setActiveIndex(index)} key={index}>{index + 1}. {item.file.name}</button>)}
            {previews.length > 24 && <span>+{previews.length - 24} more</span>}
          </div>}
          <div className="world-capture-options">
            <label className="world-capture-field">What will you use the 3D world for?
              <select value={useCase} onChange={event => setUseCase(event.target.value)} disabled={Boolean(sending)}>
                {USE_CASES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="world-capture-field">Name your space (optional)
              <input type="text" maxLength={80} placeholder="e.g. Gym floor, living room" value={spaceName} onChange={event => setSpaceName(event.target.value)} disabled={Boolean(sending)} />
            </label>
          </div>
          <p className="world-capture-note"><LockKeyhole size={15} aria-hidden="true"/> Previews stay in this browser. When you build a world, the capture goes directly to BrainSNN's reconstruction worker, not this website, and is deleted after 24 hours. Your world opens with a private link.</p>
          {files.length > 0 && <div className="world-scan-ready">
            <h3>{connected ? 'Ready to build' : 'Capture prepared'}</h3>
            <p>{ready.ok
              ? (video ? 'We extract up to 120 sharp frames, find where the camera was for each one and reconstruct the space as coloured 3D points.' : 'We find where each photo was taken and reconstruct the space as coloured 3D points.')
              : ready.reason}{' '}
              {connected ? 'This usually takes a few minutes; you can watch progress on the next page.' : 'Reconstruction is not connected right now. You can still request pilot access.'}</p>
            {sending && <div className="world-send-progress" role="status" aria-live="polite">
              <span>{sending.phase}{sending.progress ? ` · ${Math.round(sending.progress * 100)}%` : '…'}</span>
              <progress max="1" value={sending.progress || 0} aria-label="Upload progress" />
            </div>}
            <div className="world-scan-actions">
              {connected && <button type="button" className="world-button world-button-primary" onClick={buildWorld} disabled={!ready.ok || Boolean(sending)}>
                {sending ? 'Sending…' : 'Build my 3D world'} <ArrowRight size={15} aria-hidden="true" /></button>}
              {sending && <button type="button" className="world-button world-button-outline" onClick={() => abort.current?.abort()}>Cancel</button>}
              {!sending && <a href={'mailto:info@xioai.ca?subject=' + pilotSubject} className="world-button world-button-outline">Request pilot access <ArrowRight size={15} aria-hidden="true" /></a>}
            </div>
          </div>}
        </section>
        <aside>
          {recent.length > 0 && <section className="world-recent-card" aria-label="Your recent worlds">
            <h2>Your recent worlds</h2>
            <ul>{recent.slice(0, 5).map(world => <li key={world.id}><a href={`/world/${world.id}#k=${world.key}`}><Box size={15} aria-hidden="true" /> {world.name}</a><small>{new Date(world.createdAt).toLocaleString()}</small></li>)}</ul>
            <small>Saved in this browser only. Worlds are deleted from the worker after 24 hours.</small>
          </section>}
          <section className="world-guide-card" aria-label="Capture checklist">
            <h2>For a better 3D scan</h2>
            <div className="world-guide-step"><span>01</span><div><strong>Walk slowly</strong><p>Keep the room in view. Avoid rapid turns, motion blur and large jumps between camera positions.</p></div></div>
            <div className="world-guide-step"><span>02</span><div><strong>Overlap your views</strong><p>Film the same surfaces from several angles. Move around furniture and reveal corners where possible.</p></div></div>
            <div className="world-guide-step"><span>03</span><div><strong>Include a measurement</strong><p>Record a known dimension or reference marker if you intend to use the reconstruction for measurements.</p></div></div>
          </section>
          <div className="world-privacy-card"><CircleHelp size={20} aria-hidden="true"/><div><strong>What do I get?</strong><p>An explorable 3D view of the space as coloured points, with the path your camera took, plus PLY and JSON downloads. It is unscaled: confirm a known distance before measuring. Photoreal Gaussian-splat rendering and calibrated professional exports are in development.</p></div></div>
        </aside>
      </div>
    </main>
    <PublicFooter />
  </div>;
}
