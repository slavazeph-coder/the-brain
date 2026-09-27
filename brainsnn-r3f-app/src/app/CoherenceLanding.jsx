import React, { useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics.js';

// v4 — frontend-design doctrine pass (2026-09-26):
// one working comparison stage (poster play, pane labels clear of the burnt-in
// captions, mobile half-switch on the square fixture halves), story beats
// crossfade on a named view-timeline with mobile / reduced-motion flow fallback,
// violet trust tag, footer nav cleanup. Honest labels and numbers unchanged from
// v3; no merge — owner reviews previews first.
const TERMS = [
  ['Price', '$99 per clip (USD), one round of review + processing'],
  ['Length', 'up to 60s per rescue; longer by quote'],
  ['Turnaround', '24-48h for eligible clips'],
  ['If we cannot improve it', 'no charge, and we say why'],
];
const PROCESS = ['Submit your clip', 'Review and payment', 'Receive your processed export'];
const BEATS = [
  'Watch the original first — the kind of accumulated drift that survives a finished render.',
  'Now the processed pass: same timestamps, same framing, nothing regenerated.',
  'Known limit: this targets brightness/color drift only. Identity or geometry changes are out of scope.',
];

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
  function showHalf(next) {
    if (next === half) return;
    setHalf(next);
    track('coherence_half_switched', { half: next });
  }

  function submit(e) {
    e.preventDefault();
    if (!form.email.trim()) return;
    track('rescue_request_submitted', { clip: form.clip ? 'link' : 'none', notes: form.notes ? 'yes' : 'none' });
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-[#07090c] text-[#f5f7fa]" style={{ WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        .coh-display { font-family: var(--bsn-font-display); }
        .coh-beat { opacity: 1; transform: none; }
        /* reduced motion: no pin, no runway, no scrubbed reveals — beats show in flow */
        @media (prefers-reduced-motion: reduce) {
          .coh-story { height: auto !important; }
          .coh-sticky { position: static; }
        }
        /* scroll-driven choreography only where it is actually supported;
           one beat visible at a time, timed to the pinned passage (cover 35% -> 81%) */
        @supports (animation-timeline: view()) {
          @media (min-width: 1024px) and (prefers-reduced-motion: no-preference) {
            .coh-story { view-timeline-name: --coh-story; }
            .coh-beats { display: grid; }
            .coh-beats > .coh-beat { grid-area: 1 / 1; margin-top: 0; }
            .coh-beat-a { animation: coh-out linear both; animation-timeline: --coh-story; animation-range: cover 46% cover 55%; }
            .coh-beat-b { animation: coh-cross linear both; animation-timeline: --coh-story; animation-range: cover 53% cover 77%; }
            .coh-beat-c { animation: coh-in linear both; animation-timeline: --coh-story; animation-range: cover 75% cover 83%; }
            .coh-rail { display: block; }
            .coh-rail-fill { animation: coh-rail linear both; animation-timeline: --coh-story; animation-range: cover 35% cover 83%; }
          }
        }
        @keyframes coh-in { from { opacity: 0.02; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes coh-out { from { opacity: 1; transform: none; } to { opacity: 0.02; transform: translateY(-8px); } }
        @keyframes coh-cross { 0% { opacity: 0.02; transform: translateY(10px); } 27% { opacity: 1; transform: none; } 67% { opacity: 1; transform: none; } 100% { opacity: 0.02; transform: translateY(-8px); } }
        @keyframes coh-rail { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      `}</style>

      {/* 1+2: compact intro immediately followed by the synchronized comparison */}
      <section className="mx-auto w-full max-w-[1120px] px-6 pt-12 lg:px-8 lg:pt-16">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] tracking-[0.02em] text-[#a5adba]">BrainSNN Coherence</span>
          <span className="rounded-full border border-[#a78bfa]/40 px-2.5 py-0.5 text-[12px] text-[#c4b5fd]">Research preview</span>
        </div>
        <h1 className="coh-display mt-4 text-[clamp(2.75rem,5.5vw,5rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-[#f5f7fa]">
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

        {/* Comparison stage — one video, shared controls; halves stay in sync by construction */}
        <div id="proof" className="mt-10 scroll-mt-8">
          <div className="relative overflow-hidden rounded-[20px] border border-white/10 bg-black">
            <video ref={videoRef}
                   className={`block w-[200%] max-w-none cursor-pointer lg:w-full lg:translate-x-0 ${half === 'processed' ? '-translate-x-1/2' : 'translate-x-0'}`}
                   preload="metadata" muted playsInline
                   aria-label="Side-by-side comparison: the same clip before and after the correction pass"
                   poster="/videos/coherence-poster.jpg"
                   onClick={togglePlay}
                   onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}>
              <source src="/videos/coherence-demo-scrub.mp4" type="video/mp4" />
              <source src="/videos/coherence-demo-scrub.webm" type="video/webm" />
            </video>
            {/* pane labels sit at the bottom edge, clear of the burnt-in captions */}
            <div className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1 text-[12px] text-[#f5f7fa] lg:hidden">
              {half === 'original' ? 'Original' : 'Processed'}
            </div>
            <div className="pointer-events-none absolute bottom-4 left-4 hidden rounded-full bg-black/60 px-3 py-1 text-[12px] text-[#f5f7fa] lg:block">Original</div>
            <div className="pointer-events-none absolute bottom-4 left-1/2 ml-4 hidden rounded-full bg-black/60 px-3 py-1 text-[12px] text-[#f5f7fa] lg:block">Processed</div>
            <button onClick={togglePlay}
                    aria-label="Play the comparison video" aria-hidden={playing} tabIndex={playing ? -1 : 0}
                    className={`absolute inset-0 z-10 m-auto flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/60 backdrop-blur-sm transition-opacity duration-300 hover:bg-black/75 lg:h-20 lg:w-20 ${playing ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="ml-1 h-6 w-6 fill-[#f5f7fa] lg:h-8 lg:w-8"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={togglePlay} className="min-h-11 cursor-pointer rounded-xl border border-white/15 px-4 text-[14px] text-[#f5f7fa] transition-colors hover:border-white/30 hover:bg-white/5">{playing ? 'Pause' : 'Play'}</button>
            <button onClick={restart} className="min-h-11 cursor-pointer rounded-xl border border-white/15 px-4 text-[14px] text-[#f5f7fa] transition-colors hover:border-white/30 hover:bg-white/5">Restart</button>
            <div className="ml-auto flex gap-2 lg:hidden" role="group" aria-label="Which half of the comparison to show">
              <button aria-pressed={half === 'original'} onClick={() => showHalf('original')} className={`min-h-11 cursor-pointer rounded-xl px-4 text-[14px] transition-colors ${half === 'original' ? 'bg-[#f5f7fa] text-[#07090c]' : 'border border-white/15 text-[#a5adba] hover:border-white/30'}`}>Original</button>
              <button aria-pressed={half === 'processed'} onClick={() => showHalf('processed')} className={`min-h-11 cursor-pointer rounded-xl px-4 text-[14px] transition-colors ${half === 'processed' ? 'bg-[#f5f7fa] text-[#07090c]' : 'border border-white/15 text-[#a5adba] hover:border-white/30'}`}>Processed</button>
            </div>
          </div>

          {/* 4: evidence caption + disclosure — trust cues, not disclaimers */}
          <p className="mt-4 text-[14px] leading-5 text-[#a5adba]">
            Source: synthetic drift fixture, 256px, 21s, engine v0.4 (complex_mc). “Original” is the raw rollout;
            “Processed” is after the correction pass. Targets unwanted brightness and color drift. Not a general
            repair for changing identities, geometry, or missing detail.
          </p>
          <details className="mt-2 text-[14px] text-[#a5adba]">
            <summary className="cursor-pointer text-[#f5f7fa]">What this example proves</summary>
            <p className="mt-2 max-w-[70ch] leading-6">
              On the lab fixture, the pass removed 64.0% of low-frequency positional drift while retaining 99.5% detail and 99.7% motion.
              Measured against the clean reference; methodology in the repo. Independent real-footage validation is in progress; the current
              limits are documented above. No claims are made beyond tested conditions.
            </p>
          </details>

          {/* mobile / reduced-motion: the same three beats in normal flow (the pinned section is desktop-only) */}
          <div className="mt-8 rounded-[20px] border border-white/10 bg-black p-6 lg:hidden">
            {BEATS.map((text, i) => (
              <p key={text} className={`text-[16px] leading-relaxed text-[#f5f7fa] ${i ? 'mt-4' : ''}`}>{text}</p>
            ))}
          </div>
        </div>
      </section>

      {/* 9: sticky story (desktop >=1024px): one beat at a time, video keeps its natural pace */}
      <section className="coh-story mx-auto hidden w-full max-w-[1120px] px-6 lg:block lg:px-8" style={{ height: '160svh' }}>
        <div className="coh-sticky sticky top-20">
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <div className="relative overflow-hidden rounded-[20px] border border-white/10 bg-black p-6">
              <div className="coh-beats">
                {BEATS.map((text, i) => (
                  <p key={text} className={`coh-beat coh-beat-${['a', 'b', 'c'][i]} text-[18px] leading-relaxed text-[#f5f7fa] ${i ? 'mt-4' : ''}`}>{text}</p>
                ))}
              </div>
              <div className="coh-rail absolute inset-x-0 bottom-0 hidden h-[3px] bg-white/10" aria-hidden="true">
                <div className="coh-rail-fill h-full w-full origin-left bg-[#a78bfa]" />
              </div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-[#10141b] p-6 text-[14px] leading-6 text-[#a5adba]">
              The player above stays at its natural cadence — scrolling never changes playback speed. You judge the video, not your scroll.
            </div>
          </div>
        </div>
      </section>

      {/* 3: offer + form = one buying decision */}
      <section id="rescue" className="mx-auto w-full max-w-[1120px] scroll-mt-8 px-6 pb-20 pt-20 lg:px-8 lg:pt-32">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-[20px] border border-white/10 bg-[#10141b] p-6 lg:p-8">
            <h2 className="coh-display text-balance text-[28px] font-semibold tracking-[-0.02em] text-[#f5f7fa]">Your clip. A defined correction. $99.</h2>
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
                <input id="coh-email" name="email" type="email" required autoComplete="email" inputMode="email" spellCheck={false}
                       value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                       className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-[#07090c] px-4 text-[15px] text-[#f5f7fa] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]" />

                <label htmlFor="coh-clip" className="mt-5 block text-[14px] text-[#f5f7fa]">Clip link <span className="text-[#a5adba]">(Drive, Dropbox, WeTransfer)</span></label>
                <input id="coh-clip" name="clipUrl" type="url" autoComplete="off" inputMode="url" spellCheck={false}
                       value={form.clip} onChange={(e) => setForm({ ...form, clip: e.target.value })}
                       className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-[#07090c] px-4 text-[15px] text-[#f5f7fa] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]" />
                <label htmlFor="coh-notes" className="mt-5 block text-[14px] text-[#f5f7fa]">Notes <span className="text-[#a5adba]">(optional — what bothers you, timestamps)</span></label>
                <textarea id="coh-notes" name="notes" rows="3" autoComplete="off"
                          value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                          className="mt-2 w-full rounded-xl border border-white/15 bg-[#07090c] px-4 py-3 text-[15px] text-[#f5f7fa] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]" />
                <button type="submit" className="mt-6 inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-full bg-[#22d3ee] text-[16px] font-semibold text-[#062126] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22d3ee]">
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
          <nav aria-label="Explore" className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <a href="/arcade" className="underline underline-offset-4 hover:text-[#f5f7fa]">The lab</a>
            <a href="/app" className="underline underline-offset-4 hover:text-[#f5f7fa]">The decision engine</a>
          </nav>
          <p className="mt-3">Run by BrainSNN. Reach us via the form above.</p>
        </div>
      </footer>
    </div>
  );
}

export default CoherenceLanding;
