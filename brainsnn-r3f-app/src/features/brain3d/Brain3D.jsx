// Public entry for the 3D brain. Lazy-loads the WebGL scene so three.js never
// blocks first paint, and falls back to the caller-provided 2D visual when the
// device can't (or shouldn't) run WebGL.
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';
import { computeSolitonPreset, SOLITON_PRESETS } from '../../lib/solitonLayer.js';
import { track } from '../../lib/analytics.js';
import { useBrainSimulation } from './useBrainSimulation.js';
import {
  collisionSchedule,
  mapPresetToActivities,
  mapResultToActivities,
  particleParams,
  synchronyPalette,
} from './mapResultToBrain.js';
import { Brain3DErrorBoundary } from './Brain3DErrorBoundary.jsx';

const BrainScene = React.lazy(() => import('./BrainScene.jsx'));

let cachedWebglSupport = null;
function hasWebgl() {
  if (cachedWebglSupport != null) return cachedWebglSupport;
  try {
    const canvas = document.createElement('canvas');
    cachedWebglSupport = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    cachedWebglSupport = false;
  }
  return cachedWebglSupport;
}

// '3d' unless the device can't run it well. Small screens and low-memory
// devices get the lightweight 2D visual; localStorage flag is the CI/debug hatch.
export function detectBrainQuality({ width, deviceMemory, webgl, forced } = {}) {
  if (forced === '1') return '2d';
  if (webgl === false) return '2d';
  if ((width ?? 1024) < 768) return '2d';
  if ((deviceMemory ?? 8) < 4) return '2d';
  return '3d';
}

function useBrainQuality() {
  const [quality, setQuality] = useState(() => detectBrainQuality({
    width: typeof window !== 'undefined' ? window.innerWidth : undefined,
    deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined,
    webgl: typeof document !== 'undefined' ? hasWebgl() : false,
    forced: typeof localStorage !== 'undefined' ? localStorage.getItem('brainsnn:force-brain-2d') : null,
  }));

  useEffect(() => {
    function onResize() {
      setQuality(detectBrainQuality({
        width: window.innerWidth,
        deviceMemory: navigator.deviceMemory,
        webgl: hasWebgl(),
        forced: localStorage.getItem('brainsnn:force-brain-2d'),
      }));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return quality;
}

function Brain3DInner({ mode, result, presetName, paused, ariaLabel, onRegionSelect }) {
  const reducedMotion = useReducedMotion();
  const wrapRef = useRef(null);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    }, { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onVisibility() {
      setPageVisible(!document.hidden);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const active = visible && pageVisible && !paused && !reducedMotion;

  const derived = useMemo(() => {
    if (mode === 'demo') {
      const preset = computeSolitonPreset(presetName in SOLITON_PRESETS ? presetName : 'baseline');
      const drivers = SOLITON_PRESETS[preset?.preset || 'baseline'].drivers;
      const activities = mapPresetToActivities(drivers);
      return {
        targets: activities,
        scores: Object.fromEntries(Object.entries(activities).map(([code, value]) => [code, Math.round(value * 100)])),
        palette: synchronyPalette(preset?.solitonField?.synchrony),
        particles: particleParams(preset?.solitonField, {}),
        sparks: collisionSchedule(preset?.solitonField),
      };
    }
    const activities = mapResultToActivities(result);
    return {
      targets: activities,
      scores: Object.fromEntries(Object.entries(activities).map(([code, value]) => [code, Math.round(value * 100)])),
      palette: synchronyPalette(result?.solitonField?.synchrony),
      particles: particleParams(result?.solitonField, result?.metrics),
      sparks: collisionSchedule(result?.solitonField),
    };
  }, [mode, presetName, result]);

  const { state, controls } = useBrainSimulation({ running: active, targetActivities: derived.targets });

  useEffect(() => {
    if (onRegionSelect) onRegionSelect(state.selectedRegion);
  }, [onRegionSelect, state.selectedRegion]);

  return (
    <div ref={wrapRef} className={`brain3d brain3d-${mode}`} role="img" aria-label={ariaLabel || 'Animated 3D brain scan visualization'}>
      <BrainScene
        simulation={state}
        controls={controls}
        activityScores={derived.scores}
        palette={derived.palette}
        particles={derived.particles}
        sparks={derived.sparks}
        mode={mode}
        active={active}
        reducedMotion={reducedMotion}
      />
    </div>
  );
}

export function Brain3D({ mode = 'demo', result = null, presetName = 'baseline', paused = false, fallback = null, ariaLabel, onRegionSelect }) {
  const quality = useBrainQuality();

  useEffect(() => {
    if (quality === '2d') track('brain3d_fallback_used', { reason: 'quality-gate' });
  }, [quality]);

  if (quality === '2d') return fallback;

  return (
    <Brain3DErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Brain3DInner
          mode={mode}
          result={result}
          presetName={presetName}
          paused={paused}
          ariaLabel={ariaLabel}
          onRegionSelect={onRegionSelect}
        />
      </Suspense>
    </Brain3DErrorBoundary>
  );
}
