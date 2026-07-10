import React from 'react';
import { Copy, Pause, Play, RefreshCw, Share2, Sparkles } from 'lucide-react';

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function seededRandom(seedValue) {
  let seed = seedValue >>> 0;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export async function copyChallenge(url, setNotice) {
  try {
    await navigator.clipboard.writeText(url);
    setNotice('Challenge link copied. The exact lab settings travel with it.');
  } catch {
    setNotice('Clipboard access was blocked. Use the native Share button.');
  }
}

export async function shareChallenge({ title, text, url, setNotice }) {
  try {
    if (navigator.share) await navigator.share({ title, text, url });
    else await copyChallenge(url, setNotice);
  } catch (error) {
    if (error?.name !== 'AbortError') setNotice('Sharing was blocked. Copy the challenge link instead.');
  }
}

export function DeepLabHeading({ kicker, title, description, scoreLabel, score, scoreNote }) {
  return (
    <div className="gg-sim-heading">
      <div>
        <p className="gg-kicker"><Sparkles size={16} /> {kicker}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="gg-sim-score">
        <span>{scoreLabel}</span>
        <strong>{score}</strong>
        <small>{scoreNote}</small>
      </div>
    </div>
  );
}

export function DeepLabActions({ paused, onPause, onReset, onShare, onCopy, notice }) {
  return (
    <div className="gg-deep-actions">
      <button type="button" onClick={onPause}>{paused ? <Play size={16} /> : <Pause size={16} />}{paused ? 'Resume' : 'Pause'}</button>
      <button type="button" onClick={onReset}><RefreshCw size={16} /> Reset</button>
      <button type="button" onClick={onShare}><Share2 size={16} /> Share challenge</button>
      <button type="button" onClick={onCopy}><Copy size={16} /> Copy link</button>
      <span>{notice}</span>
    </div>
  );
}
