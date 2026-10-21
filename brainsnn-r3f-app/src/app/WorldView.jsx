import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, Download, Footprints, Link2, RotateCcw, Trash2 } from 'lucide-react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { track } from '../lib/analytics.js';
import { forgetWorld, rememberedWorlds, scanRequest, worldIdFromPath, worldKeyFromHash, worldStatus } from '../lib/worldClient.js';
import '../styles/world-engine.css';

const POLL_MS = 3000;
// three.js arrives only when a finished reconstruction is about to be shown.
const loadScene = () => import('./worldScene3d.js');
const DOWNLOADS = [
  ['sparse.ply', 'Point cloud (PLY)'],
  ['cameras.json', 'Camera path (JSON)'],
  ['point-cloud.json', 'Points (JSON)'],
  ['scan.json', 'Manifest (JSON)'],
];

function elapsed(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function WorldView() {
  const id = worldIdFromPath(window.location.pathname);
  const key = worldKeyFromHash(window.location.hash);
  const name = rememberedWorlds().find((world) => world.id === id)?.name || 'Your 3D world';
  const [state, setState] = useState({ phase: id && key ? 'loading' : 'invalid' });
  const [view, setView] = useState(null);
  const [walking, setWalking] = useState(null);
  const [notice, setNotice] = useState('');
  const stage = useRef(null);
  const scene = useRef(null);
  const worker = useRef('');

  useEffect(() => {
    document.title = `${name} | BrainSNN World Engine`;
    if (!id || !key) return undefined;
    let stopped = false, timer = 0;
    async function poll() {
      try {
        if (!worker.current) {
          const status = await worldStatus();
          if (!status.configured) throw Object.assign(new Error('Reconstruction is not connected right now. Try this link again later.'), { code: 'offline' });
          worker.current = status.workerUrl;
        }
        const job = await (await scanRequest(worker.current, id, key)).json();
        if (stopped) return;
        if (job.status === 'complete') return await load(job);
        if (job.status === 'failed' || job.status === 'cancelled') {
          setState({ phase: 'failed', message: job.error?.message || 'The reconstruction did not finish.' });
          return;
        }
        setState({ phase: 'processing', job });
        timer = window.setTimeout(poll, POLL_MS);
      } catch (error) {
        if (!stopped) setState({ phase: 'error', message: error.message, gone: error.code === 'gone' });
      }
    }
    async function load(job) {
      const names = new Set(job.artifacts.map((artifact) => artifact.name));
      const fetchJson = async (artifact) => (await scanRequest(worker.current, id, key, `/artifacts/${artifact}`)).json();
      const [manifest, cloud, cameras] = await Promise.all([fetchJson('scan.json'), fetchJson('point-cloud.json'),
        names.has('cameras.json') ? fetchJson('cameras.json') : Promise.resolve({ cameras: [] })]);
      if (stopped) return;
      setState({ phase: 'ready', job, manifest, cloud, cameras: cameras.cameras || [] });
      track('world_viewed', { cameras: manifest.capture?.registeredCameras || 0 });
    }
    poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [id, key, name]);

  useEffect(() => {
    if (state.phase !== 'ready' || !stage.current) return undefined;
    let active = true;
    loadScene().then(({ createWorldScene }) => {
      if (!active) return;
      scene.current = createWorldScene(stage.current, { points: state.cloud.points, cameras: state.cameras });
      setView(scene.current ? { points: scene.current.pointCount, canWalk: scene.current.canWalk } : { failed: true });
    });
    return () => { active = false; scene.current?.dispose(); scene.current = null; };
  }, [state]);

  function walk() {
    if (!scene.current?.canWalk) return;
    setWalking(0);
    scene.current.walk({ onProgress: setWalking, onDone: () => setWalking(null) });
  }
  function overview() { scene.current?.overview(); setWalking(null); }

  async function download(artifact) {
    try {
      const blob = await (await scanRequest(worker.current, id, key, `/artifacts/${artifact}`)).blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'world'}-${artifact}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) { setNotice(error.message); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setNotice('Private link copied. Anyone with it can view this world until it expires.'); }
    catch { setNotice('Copy the address bar to share. Anyone with the link can view this world until it expires.'); }
  }
  async function remove() {
    if (!window.confirm('Delete this world and its capture from the reconstruction worker? This cannot be undone.')) return;
    try {
      await scanRequest(worker.current, id, key, '', { method: 'DELETE' });
      forgetWorld(id);
      scene.current?.dispose(); scene.current = null;
      setState({ phase: 'deleted' });
    } catch (error) { setNotice(error.message); }
  }

  const job = state.job;
  const capture = state.manifest?.capture;
  return <div className="bh-site world-site world-view-page" data-build-marker="world-engine-view-v1">
    <a className="bh-skip" href="#world-main">Skip to world</a>
    <PublicNav active="scan" />
    <main id="world-main" className="world-view-main">
      <a className="world-capture-back" href="/scan"><ArrowLeft size={15} aria-hidden="true"/> Capture studio</a>
      <header className="world-view-header">
        <div>
          <p className="world-section-kicker">BRAINSNN WORLD ENGINE / RECONSTRUCTION</p>
          <h1>{name}</h1>
        </div>
        {state.phase === 'ready' && <div className="world-view-actions">
          <button type="button" className="world-button world-button-primary" onClick={walk} disabled={!view?.canWalk || walking !== null}><Footprints size={16} aria-hidden="true"/> {walking !== null ? `Walking ${Math.round(walking * 100)}%` : 'Walk the path'}</button>
          <button type="button" className="world-button world-button-outline" onClick={overview}><RotateCcw size={16} aria-hidden="true"/> Overview</button>
        </div>}
      </header>

      {state.phase === 'invalid' && <section className="world-view-panel" role="alert"><h2>This link is incomplete</h2><p>A world link carries a private key after the <code>#</code>. Open the full link you were given, or build a new world.</p><a className="world-button world-button-primary" href="/scan">Capture a space</a></section>}
      {state.phase === 'loading' && <section className="world-view-panel" role="status"><p>Opening your world…</p></section>}
      {state.phase === 'processing' && <section className="world-view-panel" role="status" aria-live="polite">
        <h2>{job.status === 'queued' ? 'Waiting for the reconstruction worker' : job.stage}</h2>
        <progress max="1" value={job.progress || 0} aria-label="Reconstruction progress" />
        <p>{Math.round((job.progress || 0) * 100)}% · {elapsed(Date.now() / 1000 - job.createdAt)} elapsed. Usually a few minutes. You can leave this page; the link keeps working for 24 hours.</p>
        <ol className="world-view-stages">{['Selecting clear, overlapping images', 'Finding image features', 'Matching overlapping views', 'Reconstructing camera positions and geometry', 'Preparing visual geometry for review'].map((label) => <li key={label} aria-current={label === job.stage ? 'step' : undefined}>{label}</li>)}</ol>
      </section>}
      {(state.phase === 'failed' || state.phase === 'error') && <section className="world-view-panel" role="alert">
        <h2>{state.gone ? 'World not found' : 'This capture could not become a world'}</h2>
        <p>{state.message}</p>
        {!state.gone && state.phase === 'failed' && <p>Most failures come from too little overlap: walk slowly, keep surfaces in view from several angles and avoid blank walls.</p>}
        <a className="world-button world-button-primary" href="/scan">Try another capture</a>
      </section>}
      {state.phase === 'deleted' && <section className="world-view-panel" role="status"><h2>World deleted</h2><p>The capture and its reconstruction were removed from the worker.</p><a className="world-button world-button-primary" href="/scan">Capture another space</a></section>}

      {state.phase === 'ready' && <>
        <section className="world-view-stage" aria-label="Explorable 3D world">
          <div ref={stage} className="world-view-canvas" />
          {view?.failed && <p className="world-view-fallback">3D view is unavailable in this browser. The downloads below still contain the full reconstruction.</p>}
          <div className="world-view-badge"><span>Sparse reconstruction · unscaled</span>{view?.points ? <strong>{view.points.toLocaleString()} points</strong> : null}</div>
          <p className="world-view-hint">Drag to orbit · scroll or pinch to zoom · cyan line is the path your camera took</p>
        </section>
        <section className="world-view-facts" aria-label="Reconstruction details">
          <div><span>Frames aligned</span><strong>{capture.registeredCameras} / {capture.images}</strong><small>{Math.round(capture.registrationFraction * 100)}% of selected frames</small></div>
          <div><span>3D points</span><strong>{capture.reconstructedPoints.toLocaleString()}</strong><small>coloured from your capture</small></div>
          <div><span>Scale</span><strong>Unscaled</strong><small>confirm a known distance before measuring</small></div>
          <div><span>Engine</span><strong>{state.manifest.provenance?.colmapBackend === 'pycolmap' ? 'COLMAP (pycolmap)' : 'COLMAP'}</strong><small>{state.manifest.provenance?.colmapBuild || 'operator-attested build'}</small></div>
        </section>
        {(state.manifest.warnings || []).map((warning) => <p className="world-capture-alert" key={warning}>{warning}</p>)}
        <section className="world-view-tools" aria-label="Downloads and sharing">
          <div className="world-view-downloads">{DOWNLOADS.filter(([artifact]) => job.artifacts.some((item) => item.name === artifact)).map(([artifact, label]) =>
            <button type="button" key={artifact} onClick={() => download(artifact)}><Download size={15} aria-hidden="true"/> {label}</button>)}</div>
          <div className="world-view-downloads">
            <button type="button" onClick={copyLink}><Link2 size={15} aria-hidden="true"/> Copy private link</button>
            <button type="button" className="danger" onClick={remove}><Trash2 size={15} aria-hidden="true"/> Delete world</button>
          </div>
          {notice && <p className="world-view-notice" role="status">{notice}</p>}
        </section>
        <div className="world-privacy-card"><Box size={20} aria-hidden="true"/><div><strong>What you are looking at</strong><p>Each point is a surface detail seen in several of your frames, placed where the cameras agree it is. Plain walls, glass and moving people leave gaps. Scale and orientation are estimated, not measured. Photoreal Gaussian-splat rendering is in development.</p></div></div>
      </>}
    </main>
    <PublicFooter />
  </div>;
}
