// Poke the Brain — the homepage hero.
//
// The first poke must be possible within three seconds of load, on any
// connection. three.js is ~250 KB gzipped and loads lazily, so the 2D brain
// below renders immediately, is already pokeable, and hands over to the jelly
// when it arrives. The counter carries across the handover.
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clapperboard, Copy, ImageDown, RotateCcw, Share2, Slice, Vibrate, Volume2, VolumeX, X } from 'lucide-react';
import { track } from '../../../lib/analytics.js';
import { useReducedMotion } from '../../../hooks/useReducedMotion.js';
import { useBrainSimulation } from '../../brain3d/useBrainSimulation.js';
import { getToy, sponsorFor, toyCaption, toyFileName } from '../toyConfig.js';
// The clip recorder and card renderer load when someone opens the share sheet,
// not on first paint of the homepage.
const loadShareMedia = () => import('../shareMedia.js');

function canRecordClip() {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}
import { SponsorSlot } from '../ToyChrome.jsx';
import { Brain3DErrorBoundary } from '../../brain3d/Brain3DErrorBoundary.jsx';
import { probePokeTier } from './pokeTier.js';
import { createSquishSound } from './squishSound.js';
import { POKE_PALETTES, paletteById, readStoredPalette, storePalette } from './jellyGestures.js';

const PokeBrainScene = React.lazy(() => import('./PokeBrainScene.jsx'));

const TOY = getToy('poke');
const HOOK_TITLE = 'Poke the brain and watch the signal travel.';
const STIMULUS_MS = 700;

// A stylised side view: cerebrum, cerebellum, stem, and a few sulci. It is the
// loading state and the no-WebGL fallback, and it is pokeable in both roles.
const SULCI = [
  'M112 118 C132 100 152 106 162 126',
  'M170 72 C182 98 176 122 192 144',
  'M212 58 C218 84 232 98 226 128',
  'M252 62 C246 92 266 112 262 138',
  'M300 84 C290 108 310 128 300 152',
  'M118 178 C160 162 212 168 252 188',
  'M92 148 C112 142 126 152 142 146',
  'M320 154 C332 168 326 182 336 192',
  'M142 202 C168 196 186 206 206 200',
  'M280 176 C292 188 312 186 322 198',
];

function FallbackBrain({ onPoke, loading, palette }) {
  const [ripples, setRipples] = useState([]);
  const nextId = useRef(1);

  function handlePointerDown(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 400;
    const y = ((event.clientY - rect.top) / rect.height) * 300;
    const id = nextId.current++;
    setRipples((previous) => [...previous.slice(-5), { id, x, y }]);
    window.setTimeout(() => setRipples((previous) => previous.filter((ripple) => ripple.id !== id)), 1100);
    onPoke();
  }

  return (
    <div className="poke-fallback" data-testid="poke-fallback">
      <svg viewBox="0 0 400 300" onPointerDown={handlePointerDown} role="img" aria-label="A stylised brain. Tap it to fire a signal.">
        <defs>
          <linearGradient id="poke-fill" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={palette.violet} stopOpacity="0.32" />
            <stop offset="1" stopColor={palette.cyan} stopOpacity="0.3" />
          </linearGradient>
          <radialGradient id="poke-core" cx="0.55" cy="0.45" r="0.6">
            <stop offset="0" stopColor={palette.cyan} stopOpacity="0.2" />
            <stop offset="1" stopColor={palette.cyan} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="210" cy="150" rx="190" ry="140" fill="url(#poke-core)" />
        <path className="poke-fallback-body" d="M70 170 C55 120 90 70 150 60 C185 40 245 42 280 62 C330 72 360 115 352 160 C348 190 330 205 300 210 C290 230 265 236 245 228 C225 240 190 238 170 226 C140 234 105 222 95 205 C75 200 66 188 70 170 Z" fill="url(#poke-fill)" />
        <path className="poke-fallback-body" d="M252 228 C262 250 292 256 312 244 C330 232 326 212 305 210 C290 222 268 228 252 228 Z" fill="url(#poke-fill)" />
        <path d="M232 232 C236 254 234 272 229 288 L217 288 C221 270 221 252 218 234 Z" fill="rgba(148,124,255,.2)" />
        {SULCI.map((d) => <path key={d} d={d} className="poke-fallback-sulcus" />)}
        {ripples.map((ripple) => (
          <g key={ripple.id} className="poke-fallback-ripple">
            <circle cx={ripple.x} cy={ripple.y} r="10" />
            <circle cx={ripple.x} cy={ripple.y} r="4" className="poke-fallback-dot" />
          </g>
        ))}
      </svg>
      {loading ? <span className="poke-loading" role="status">Loading the jelly…</span> : null}
    </div>
  );
}

async function copyToClipboard(text) {
  // Called synchronously from the click so the browser still counts it as a
  // user gesture; a lazy import in front of it would lose that on Safari.
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ShareSheet({ open, onClose, count, apiRef, can3d }) {
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [clip, setClip] = useState(null);
  const recordingRef = useRef(null);
  const sponsor = sponsorFor(TOY.id);
  const clipSupported = can3d && canRecordClip();
  const caption = toyCaption(TOY.id, { result: count ? `${count} signals fired.` : '' });
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => () => recordingRef.current?.cancel(), []);
  useEffect(() => { if (!open) setMessage(''); }, [open]);

  async function recordClip() {
    const api = apiRef.current;
    if (!api?.canvas) return;
    setBusy('clip');
    setClip(null);
    setProgress(0);
    setMessage('Recording — keep poking. Six seconds.');
    track('toy_share_opened', { toy: TOY.id, kind: 'clip' });
    const { extensionFor, fontsReady, recordPokeClip } = await loadShareMedia();
    await fontsReady();
    // A clip of a still brain is not worth posting. If nobody pokes in the
    // first moment, shake it so there is always something to watch.
    const shakeTimer = window.setTimeout(() => api.shake(), 700);
    const recording = recordPokeClip({
      source: api.canvas,
      hook: HOOK_TITLE,
      getCount: () => countRef.current,
      sponsor,
      onProgress: setProgress,
    });
    recordingRef.current = recording;
    try {
      const { blob, mime } = await recording.done;
      // Sharing needs a fresh tap: browsers only open the share sheet in direct
      // response to a gesture, and the one that started recording has expired.
      setClip({ blob, mime, extension: extensionFor(mime) });
      setMessage('Clip ready — seven seconds, watermarked.');
    } catch (error) {
      if (error?.name !== 'AbortError') setMessage('Recording failed in this browser. Save a poster instead.');
    } finally {
      window.clearTimeout(shakeTimer);
      recordingRef.current = null;
      setBusy('');
    }
  }

  async function deliverClip() {
    if (!clip) return;
    const { shareOrDownload } = await loadShareMedia();
    const via = await shareOrDownload({
      blob: clip.blob,
      filename: toyFileName(TOY.id, 'clip', clip.extension),
      title: TOY.title,
      caption,
    });
    track('toy_clip_saved', { toy: TOY.id, mime: clip.extension, via });
    setMessage(via === 'shared' ? 'Shared.' : via === 'downloaded' ? 'Clip saved — caption and link copied.' : 'Share cancelled. The clip is still here.');
  }

  async function savePoster() {
    const api = apiRef.current;
    if (!api?.canvas) return;
    setBusy('poster');
    try {
      const { fontsReady, renderPokePoster, shareOrDownload } = await loadShareMedia();
      await fontsReady();
      const blob = await renderPokePoster({ source: api.canvas, hook: HOOK_TITLE, count, sponsor });
      const via = await shareOrDownload({ blob, filename: toyFileName(TOY.id, 'poster', 'png'), title: TOY.title, caption });
      track('toy_card_saved', { toy: TOY.id, via });
      setMessage(via === 'shared' ? 'Shared.' : via === 'downloaded' ? 'Poster saved — caption and link copied.' : 'Share cancelled.');
    } catch {
      setMessage('Could not make the poster in this browser.');
    } finally {
      setBusy('');
    }
  }

  async function copyCaption() {
    const ok = await copyToClipboard(caption);
    track('toy_link_copied', { toy: TOY.id });
    setMessage(ok ? 'Caption and link copied.' : 'Clipboard blocked — the link is brainsnn.com/?src=toy1-share');
  }

  if (!open) return null;
  return (
    <div className="poke-share" role="dialog" aria-label="Share this brain" data-testid="poke-share">
      <div className="poke-share-head">
        <strong>Share this brain</strong>
        <button type="button" className="poke-icon-button" onClick={() => { recordingRef.current?.cancel(); onClose(); }} aria-label="Close sharing">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {clipSupported ? (
        <button type="button" className="poke-share-option" onClick={recordClip} disabled={Boolean(busy)} data-testid="poke-record">
          <Clapperboard size={18} aria-hidden="true" />
          <span><strong>{busy === 'clip' ? 'Recording…' : clip ? 'Record another clip' : 'Record a 6-second clip'}</strong><small>Vertical, watermarked, ready for Reels, Shorts and TikTok</small></span>
        </button>
      ) : null}
      {busy === 'clip' ? <div className="poke-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div> : null}
      {clip && !busy ? (
        <button type="button" className="poke-share-option poke-share-ready" onClick={deliverClip} data-testid="poke-clip-share">
          <Share2 size={18} aria-hidden="true" />
          <span><strong>Share or save the clip</strong><small>{clip.extension.toUpperCase()} · the caption and link are copied with it</small></span>
        </button>
      ) : null}
      {can3d ? (
        <button type="button" className="poke-share-option" onClick={savePoster} disabled={Boolean(busy)} data-testid="poke-poster">
          <ImageDown size={18} aria-hidden="true" />
          <span><strong>Save a poster</strong><small>This moment as a 4:5 image</small></span>
        </button>
      ) : null}
      <button type="button" className="poke-share-option" onClick={copyCaption} disabled={Boolean(busy)} data-testid="poke-copy">
        <Copy size={18} aria-hidden="true" />
        <span><strong>Copy caption and link</strong><small>{caption.split('\n')[0]}</small></span>
      </button>
      <p className="poke-share-message" role="status">{message}</p>
    </div>
  );
}

export function PokeBrain() {
  const reducedMotion = useReducedMotion();
  const [tier, setTier] = useState(() => probePokeTier());
  const [ready3d, setReady3d] = useState(false);
  const [count2d, setCount2d] = useState(0);
  const [count3d, setCount3d] = useState(0);
  const [poked, setPoked] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const [paletteId, setPaletteId] = useState(() => readStoredPalette());
  const [sliced, setSliced] = useState(false);
  const palette = paletteById(paletteId);
  const stageRef = useRef(null);
  const apiRef = useRef(null);
  // The squish synth: created once, unlocked on the first real gesture.
  const soundRef = useRef(null);
  if (soundRef.current === null) soundRef.current = createSquishSound();
  const [muted, setMuted] = useState(() => soundRef.current.muted);
  const loadStartedRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0);

  useEffect(() => {
    function onResize() { setTier(probePokeTier()); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), { threshold: 0.02 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onVisibility() { setPageVisible(!document.hidden); }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const active = visible && pageVisible;
  // The same seven-region model the analyzer runs. Pokes inject current into
  // it; the node glow reads its activity back.
  const sim = useBrainSimulation({ running: active, seed: 'poke-the-brain' });
  const simRef = useRef(sim.state);
  simRef.current = sim.state;
  const controlsRef = useRef(sim.controls);
  controlsRef.current = sim.controls;
  const stimulusTimers = useRef({});
  useEffect(() => () => Object.values(stimulusTimers.current).forEach((timer) => window.clearTimeout(timer)), []);

  const stimulate = useCallback((region, amount) => {
    const controls = controlsRef.current;
    controls.stimulate(region, amount);
    window.clearTimeout(stimulusTimers.current[region]);
    stimulusTimers.current[region] = window.setTimeout(() => controlsRef.current.clearStimulus(region), STIMULUS_MS);
  }, []);

  // Time from load to first poke is the toy's one performance promise
  // (under three seconds), so it is measured on real visits, once each.
  const pokedRef = useRef(false);
  const firstPoke = useCallback((mode) => {
    if (pokedRef.current) return;
    pokedRef.current = true;
    setPoked(true);
    track('toy_first_poke', { toy: TOY.id, mode, ms: Math.round(performance.now() - loadStartedRef.current) });
  }, []);

  const callbacksRef = useRef({});
  callbacksRef.current = {
    onPoke(region) {
      stimulate(region, 0.34);
      controlsRef.current.triggerBurst();
      firstPoke('3d');
    },
    onArrive(region, depth, inhibitory) {
      if (!inhibitory && depth === 0) stimulate(region, 0.16);
    },
    onFired(total) {
      setCount3d(total);
    },
  };

  const poke2d = useCallback(() => {
    setCount2d((value) => value + 1);
    stimulate('THL', 0.3);
    soundRef.current.unlock();
    soundRef.current.poke(0.5);
    firstPoke('2d');
  }, [firstPoke, stimulate]);

  const showing3d = tier !== '2d' && ready3d;
  const count = count2d + count3d;

  function shake() {
    track('toy_shake', { toy: TOY.id });
    soundRef.current.unlock();
    if (showing3d) apiRef.current?.shake();
    else for (let index = 0; index < 5; index += 1) window.setTimeout(poke2d, index * 110);
  }

  function toggleMute() {
    const next = soundRef.current.toggle();
    setMuted(next);
    track('toy_sound_toggled', { toy: TOY.id, muted: next });
    // Unmuting should be instantly gratifying: a little bloop proves it worked.
    if (!next) {
      soundRef.current.unlock();
      soundRef.current.poke(0.4);
    }
  }

  function reset() {
    apiRef.current?.reset();
    setCount2d(0);
    setCount3d(0);
    setSliced(false);
    controlsRef.current.reset();
  }

  function toggleSlice() {
    // The click is the audio gesture: unlock first so the slice bloop sounds.
    soundRef.current.unlock();
    setSliced((value) => {
      const next = !value;
      track('toy_slice_toggled', { toy: TOY.id, sliced: next });
      return next;
    });
    firstPoke('3d');
  }

  function setPalette(id) {
    const next = paletteById(id).id;
    storePalette(next);
    setPaletteId(next);
    track('toy_palette_changed', { toy: TOY.id, palette: next });
  }

  function openShare() {
    setShareOpen((open) => !open);
    if (!shareOpen) track('toy_share_opened', { toy: TOY.id, kind: 'sheet' });
  }

  const sceneProps = useMemo(() => ({
    simRef,
    apiRef,
    callbacksRef,
    detail: tier === 'high' ? 'high' : 'low',
    reducedMotion,
    seed: 'poke-the-brain',
    soundRef,
    palette,
    sliced,
  }), [tier, reducedMotion, palette, sliced]);

  return (
    <section className="poke-hero" aria-labelledby="poke-title" data-testid="poke-hero" data-render={showing3d ? '3d' : '2d'}>
      <div className="poke-head">
        <p className="bh-kicker">A PLAYGROUND FOR MACHINE INTELLIGENCE</p>
        <h1 id="poke-title">Poke the brain and <span>watch the signal travel.</span></h1>
        <p className="poke-lead">
          Every poke drives the seven-region spiking model the analyzer runs on.{' '}
          <span className="poke-lead-extra">Drag to stretch it. Shake it.</span>{' '}
          It is a simulation — not a recording of anyone&apos;s brain.
        </p>
      </div>

      <div className="poke-stage" ref={stageRef}>
        <span className="poke-watermark" aria-hidden="true"><i>B</i>brainsnn.com</span>
        {tier !== '2d' ? (
          <div className={`poke-webgl ${showing3d ? 'is-ready' : ''}`}>
            <Brain3DErrorBoundary fallback={null} onError={() => { setReady3d(false); setTier('2d'); }}>
              <Suspense fallback={null}>
                <PokeBrainScene {...sceneProps} active={active} onReady={() => setReady3d(true)} />
              </Suspense>
            </Brain3DErrorBoundary>
          </div>
        ) : null}
        {!showing3d ? <FallbackBrain onPoke={poke2d} loading={tier !== '2d'} palette={palette} /> : null}
        <p className={`poke-hint ${poked ? 'is-hidden' : ''}`} aria-hidden={poked ? 'true' : undefined}>
          {tier === '2d' ? 'Tap the brain' : 'Tap, drag, pinch or shake the brain'}
          {tier === 'high' ? null : <span> · best on a computer</span>}
        </p>
        <SponsorSlot toyId={TOY.id} className="poke-sponsor" />
      </div>

      <div className="poke-controls">
        <div className="poke-counter">
          <span>Signals fired</span>
          <strong data-testid="poke-count">{String(count).padStart(4, '0')}</strong>
        </div>
        <div className="poke-actions">
          <button type="button" className="bh-button bh-secondary" onClick={shake} data-testid="poke-shake">
            <Vibrate size={16} aria-hidden="true" /> Shake
          </button>
          <button type="button" className="bh-button bh-secondary" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute squish sounds' : 'Mute squish sounds'} data-testid="poke-mute">
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />} {muted ? 'Muted' : 'Sound'}
          </button>
          <button type="button" className="bh-button bh-secondary" onClick={reset} data-testid="poke-reset">
            <RotateCcw size={16} aria-hidden="true" /> Reset
          </button>
          {showing3d ? (
            <button type="button" className="bh-button bh-secondary" onClick={toggleSlice} aria-pressed={sliced} data-testid="poke-slice">
              <Slice size={16} aria-hidden="true" /> {sliced ? 'Unslice' : 'Slice'}
            </button>
          ) : null}
          <button type="button" className="bh-button bh-primary" onClick={openShare} aria-expanded={shareOpen} data-testid="poke-share-button">
            {shareOpen ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />} Share this brain
          </button>
        </div>
        <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} count={count} apiRef={apiRef} can3d={showing3d} />
        <div className="poke-palettes" role="group" aria-label="Jelly colour">
          {POKE_PALETTES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`poke-swatch${option.id === paletteId ? ' is-active' : ''}`}
              style={{ background: `linear-gradient(135deg, ${option.cyan}, ${option.violet})` }}
              aria-label={`${option.name} jelly`}
              aria-pressed={option.id === paletteId}
              onClick={() => setPalette(option.id)}
              data-testid={`poke-palette-${option.id}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
