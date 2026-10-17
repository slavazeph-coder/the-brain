import React, { useEffect } from 'react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { track } from '../lib/analytics.js';
export function CoherenceLanding() {
  useEffect(() => { document.title = 'Video research preview | BrainSNN'; track('coherence_landing_viewed'); }, []);
  return <div className="bh-site"><PublicNav active="lab" /><main className="lab-index">
    <p className="bh-kicker"><a href="/lab">Lab</a> / Video research</p><h1>Inspect the correction pass.</h1>
    <p>A synthetic drift fixture before and after a fixed post-process. This is a research preview.</p>
    <video controls playsInline preload="metadata" poster="/videos/coherence-poster.jpg" aria-label="Side-by-side comparison: original and processed synthetic fixture" onPlay={() => track('coherence_demo_played')} style={{ width: '100%', borderRadius: 20 }}><source src="/videos/coherence-demo-scrub.mp4" type="video/mp4" /><source src="/videos/coherence-demo-scrub.webm" type="video/webm" /></video>
    <p>Synthetic drift fixture, 256px, 21s; fixed post-process engine v0.4 (complex_mc), with no trained weights. Original and Processed show the same fixture before and after that pass. This is not a customer result or a repair for identity, geometry or missing detail.</p>
    <details><summary>Evidence and current limits</summary><p>Simple exposure averaging is competitive on the easy synthetic scenario. Every engine missed the harder initial phase-drift gate. Native 1080p rendered math reels and a native 720p generated house clip failed motion gates; one reel also failed detail preservation. A low-resolution example does not establish HD or general video quality.</p><a href="/coherence-evidence.html">Read the baselines, hardware and failed gates.</a></details>
    <p>Research question: can learned memory improve long video against frozen frames, explicit reference memory and deployed linear baselines? Multi-minute coherence is not established.</p>
  </main><PublicFooter /></div>;
}
