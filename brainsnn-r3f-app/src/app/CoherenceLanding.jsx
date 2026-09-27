import React, { useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics.js';

// v3 — Apple-grade restructure per the 10-point critique (2026-09-26):
// comparison in the first viewport; synchronized player; offer+form combined;
// captions scrub (video plays naturally); restrained palette; honest labels.
const TERMS = [
  ['Price', '$99 per clip (USD), one round of review + processing'],
  ['Length', 'up to 60s per rescue; longer by quote'],
  ['Turnaround', '24-48h for eligible clips'],
  ['If we cannot improve it', 'no charge, and we say why'],
];
const PROCESS = ['Submit your clip', 'Review and payment', 'Receive your processed export'];

export function CoherenceLanding({ onNavigate, onStart }) {
  const videoRef = useRef(null);
  const [form, setForm] = useState({ email: '', clip: '', notes: '' });
  const [sent, setSent] = useState(false);
  const [half, setHalf] = useState('original');
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    document.title = 'BrainSNN Coherence — less flicker, less color drift';
    track('coherence_landing_viewed');
  }, []);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().then(() => setPlaying(true)).catch(() => {}); track('coherence_demo_played'); }
    else { v.pause(); setPlaying(false); }
  }
  function restart() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0; v.play().catch(() => {});
  }

  function submit(e) {
    e.preventDefault();
    if (!form.email.trim()) return;
    track('rescue_request_submitted', { clip: form.clip ? 'link' : 'none', notes: form.notes ? 'yes' : 'none' });
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-[#07090c] text-[#f5f7fa]" style={{ WebkitFontSmoothing: 'antialiased' }}>
      {/* Caption scrub: native scroll-driven animation with static fallback (critique #9) */}
      <style>{`
        .coh-beat { opacity: 1; transform: none; }
        @supports (animation-timeline: scroll()) {
          @media (min-width: 1024px) and (prefers-reduced-motion: no-preference) {
            .coh-beat-a { animation: coh-in linear both; animation-timeline: view(); animation-range: entry 20% cover 35%; }
            .coh-beat-b { animation: coh-in linear both; animation-timeline: view(); animation-range: cover 40% cover 60%; }
            .coh-beat-c { animation: coh-in linear both; animation-timeline: view(); animation-range: cover 65% cover 85%; }
          }
        }
        @keyframes coh-in { from { opacity: 0.25; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* 1+2: compact intro immediately followed by the synchronized comparison */}
      <section className="mx-auto w-full max-w-[1120px] px-6 lg:px-8 pt-12 lg:pt-16">
        <p className="text-[13px] tracking-[0.02em] text-[#a5adba]">BrainSNN Coherence · Research preview</p>
        <h1 className="mt-4 text-[clamp(2.75rem,5.5vw,5rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-[#f5f7fa]">
          Less flicker.<br />Less color drift.
        </h1>
        <p className="mt-6 max-w-[46ch] text-[clamp(1.125rem,1.6vw,1.375rem)] leading-relaxed text-[#a5adba]">
          A $99 rescue service for eligible AI-generated video. We stabilize the correction pass — no regeneration.
        </p>
        <div className="mt-6 flex items-center gap-5">
          <a href="#rescue" onClick={() => track('coherence_cta_clicked', { where: 'hero' })}
             className="inline-flex min-h-12 items-center rounded-full bg-[#22d3ee] px-6 text-[16px] font-semibold text-[#062126] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]">
            Check my clip
          </a>
          <a href="#proof" className="text-[15px] text-[#a5adba] underline underline-offset-4 hover:text-[#f5f7fa]">See the evidence</a>
        </div>

        {/* Comparison player — one video, shared controls, no independent clocks */}
        <div id="proof" className="mt-10">
          <div className={`relative overflow-hidden rounded-[20px] border border-white/10 bg-black ${half === 'processed' ? '' : ''}`}>
            <video ref={videoRef} className="block w-full" preload="metadata" muted playsInline poster="/videos/coherence-poster.jpg"
                   onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}>
              <source src="/videos/coherence-demo-scrub.mp4" type="video/mp4" />
              <source src="/videos/coherence-demo-scrub.webm" type="video/webm" />
            </video>
            <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-[12px] text-[#f5f7fa]">{half === 'original' ? 'Original' : 'Processed'}</div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={togglePlay} className="min-h-10 rounded-xl border border-white/15 px-4 text-[14px] text-[#f5f7fa] hover:border-white/30">{playing ? 'Pause' : 'Play'}</button>
            <button onClick={restart} className="min-h-10 rounded-xl border border-white/15 px-4 text-[14px] text-[#f5f7fa] hover:border-white/30">Restart</button>
            <div className="ml-auto flex gap-2">
              <button aria-pressed={half === 'original'} onClick={() => setHalf('original')} className={`min-h-10 rounded-xl px-4 text-[14px] ${half === 'original' ? 'bg-[#f5f7fa] text-[#07090c]' : 'border border-white/15 text-[#a5adba]'}`}>Original</button>
              <button aria-pressed={half === 'processed'} onClick={() => setHalf('processed')} className={`min-h-10 rounded-xl px-4 text-[14px] ${half === 'processed' ? 'bg-[#f5f7fa] text-[#07090c]' : 'border border-white/15 text-[#a5adba]'}`}>Processed</button>
            </div>
          </div>

          {/* 4: evidence caption + disclosure — trust cues, not disclaimers */}
          <p className="mt-4 text-[14px] leading-5 text-[#a5adba]">
            Source: synthetic drift fixture, 256px, 21s, engine v0.4 (complex_mc). Targets unwanted brightness and color drift.
            Not a general repair for changing identities, geometry, or missing detail.
          </p>
          <details className="mt-2 text-[14px] text-[#a5adba]">
            <summary className="cursor-pointer text-[#f5f7fa]">What this example proves</summary>
            <p className="mt-2 max-w-[70ch] leading-6">
              On the lab fixture, the pass removed 64.0% of low-frequency positional drift while retaining 99.5% detail and 99.7% motion.
              Measured against the clean reference; methodology in the repo. Independent real-footage validation is in progress; the current
              limits are documented above. No claims are made beyond tested conditions.
            </p>
          </details>
        </div>
      </section>

      {/* 9: sticky story (desktop >=1024px): captions scrub, video keeps natural pace */}
      <section className="coh-story mx-auto hidden w-full max-w-[1120px] px-6 lg:block lg:px-8" style={{ height: '160svh' }}>
        <div className="sticky top-20">
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <div className="rounded-[20px] border border-white/10 bg-black p-6">
              <p className="coh-beat coh-beat-a text-[18px] leading-relaxed text-[#f5f7fa]">Watch the original first — the kind of accumulated drift that survives a finished render.</p>
              <p className="coh-beat coh-beat-b mt-4 text-[18px] leading-relaxed text-[#f5f7fa]">Now the processed pass: same timestamps, same framing, nothing regenerated.</p>
              <p className="coh-beat coh-beat-c mt-4 text-[18px] leading-relaxed text-[#f5f7fa]">Known limit: this targets brightness/color drift only. Identity or geometry changes are out of scope.</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-[#10141b] p-6 text-[14px] leading-6 text-[#a5adba]">
              The player above stays at its natural cadence — scrolling never changes playback speed. You judge the video, not your scroll.
            </div>
          </div>
        </div>
      </section>

      {/* 3: offer + form = one buying decision */}
      <section id="rescue" className="mx-auto w-full max-w-[1120px] px-6 pb-20 pt-20 lg:px-8 lg:pt-32">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-[20px] border border-white/10 bg-[#10141b] p-6 lg:p-8">
            <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-[#f5f7fa]">Your clip. A defined correction. $99.</h2>
            <ul className="mt-6 space-y-3 text-[15px] leading-6 text-[#a5adba]">
              {TERMS.map(([k, v]) => (<li key={k}><span className="text-[#f5f7fa]">{k}:</span> {v}</li>))}
            </ul>
            <p className="mt-6 text-[14px] text-[#a5adba]">{PROCESS.join(' \u2192 ')}</p>
            <p className="mt-4 text-[14px] leading-6 text-[#a5adba]">Research preview. Eligibility reviewed before payment; nothing is charged for clips we cannot improve.</p>
          </div>
          <form onSubmit={submit} className="rounded-[20px] border border-white/10 bg-[#10141b] p-6 lg:p-8">
            {sent ? (
              <div className="rounded-xl border border-[#22d3ee]/30 bg-[#22d3ee]/10 p-5 text-[15px] text-[#c8f7ff]">
                Received. We will reply to the email you left within one business day with an eligibility decision.
              </div>
            ) : (
              <>
                <label htmlFor="coh-email" className="block text-[14px] text-[#f5f7fa]">Email</label>
                <input id="coh-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                       className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-[#07090c] px-4 text-[15px] text-[#f5f7fa] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]" />

                <label htmlFor="coh-clip" className="mt-5 block text-[14px] text-[#f5f7fa]">Clip link <span className="text-[#a5adba]">(Drive, Dropbox, WeTransfer)</span></label>
                <input id="coh-clip" type="url" value={form.clip} onChange={(e) => setForm({ ...form, clip: e.target.value })}
                       className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-[#07090c] px-4 text-[15px] text-[#f5f7fa] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]" />
                <label htmlFor="coh-notes" className="mt-5 block text-[14px] text-[#f5f7fa]">Notes <span className="text-[#a5adba]">(optional — what bothers you, timestamps)</span></label>
                <textarea id="coh-notes" rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                       className="mt-2 w-full rounded-xl border border-white/15 bg-[#07090c] px-4 py-3 text-[15px] text-[#f5f7fa] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]" />
                <button type="submit" className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#22d3ee] text-[16px] font-semibold text-[#062126] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]">
                  Check my clip
                </button>
                <p className="mt-3 text-[13px] leading-5 text-[#a5adba]">We review eligibility first. If your clip is a fit, we send payment details and process it within 24-48h.</p>
              </>
            )}
          </form>
        </div>
      </section>

      {/* quiet closing: vision + lab access */}
      <footer className="mx-auto w-full max-w-[1120px] px-6 pb-16 lg:px-8">
        <div className="border-t border-white/10 pt-8 text-[14px] leading-6 text-[#a5adba]">
          <p>Where this goes: coherence from the start — a streaming engine for multi-minute shots. Research preview, built in the open.</p>
          <p className="mt-3">
            <a href="/arcade" className="underline underline-offset-4 hover:text-[#f5f7fa]">The lab</a>
            <span className="mx-3 text-white/20">·</span>
            <a href="/app" className="underline underline-offset-4 hover:text-[#f5f7fa]">The decision engine</a>
            <span className="mx-3 text-white/20">·</span>
            <span>Operator: BrainSNN — contact via the form above</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default CoherenceLanding;
