import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { track } from '../lib/analytics.js';

gsap.registerPlugin(ScrollTrigger);

const CHIPS = ['no regeneration', 'any model, after the fact', 'research preview · validated in lab runs'];

const STEPS = [
  { n: '1', t: 'Send a clip', d: 'One link or file. Any length the model produced — we work after generation.' },
  { n: '2', t: 'We stabilize it', d: 'A stateful coherence pass removes accumulated drift and flicker. No regeneration, no reroll.' },
  { n: '3', t: 'Get it back', d: 'The corrected clip plus a short before/after readout you can present.' },
];

const STATS = [
  { v: '−86%', l: 'drift variance removed (lab rollouts)' },
  { v: '0.99', l: 'detail retained (HF-SSIM)' },
  { v: '~97%', l: 'motion preserved (lab)' },
];

export function CoherenceLanding({ onNavigate, onStart }) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const [form, setForm] = useState({ email: '', clip: '', notes: '' });
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = 'BrainSNN | AI video drifts — bring it back';
    track('coherence_landing_viewed');
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const desktop = window.matchMedia('(min-width: 1024px)').matches;
    if (reduced || !desktop) {
      video.loop = true; video.muted = true; video.play().catch(() => {});
      return;
    }
    video.pause();
    const ctx = gsap.context(() => {
      const scrub = { t: 0 };
      let demoFired = false;
      const dur = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 21.3);
      const tl = gsap.timeline({
        scrollTrigger: { trigger: '.coh-hero', start: 'top top', end: '+=2400', pin: true, scrub: 1, onUpdate: (self) => { if (!demoFired && self.progress > 0.45) { demoFired = true; track('coherence_demo_played', { p: 5 }); } } },
      });
      tl.from('.coh-line-1', { yPercent: 120, opacity: 0, duration: 0.6 }, 0)
        .from('.coh-line-2', { yPercent: 120, opacity: 0, duration: 0.6 }, 0.35)
        .to('.coh-hint', { opacity: 0, duration: 0.3 }, 0.2)
        .to('.coh-video-card', { scale: 1.04, duration: 1.2 }, 0.6)
        .add(() => { scrub.t = 0; }, 1.4);
      tl.to(scrub, {
        t: 1, duration: 1.6, ease: 'none',
        onUpdate: () => { const q = Math.round(scrub.t * dur() * 30) / 30; if (Math.abs(video.currentTime - q) > 0.033) video.currentTime = Math.min(q, dur()); },
      }, 1.4)
        .to('.coh-cap-a', { opacity: 0, duration: 0.25 }, 1.5)
        .fromTo('.coh-cap-b', { opacity: 0 }, { opacity: 1, duration: 0.25 }, 1.5)
        .from('.coh-chip', { y: 14, opacity: 0, stagger: 0.08, duration: 0.4 }, 3.0)
        .from('.coh-cta', { y: 14, opacity: 0, duration: 0.4 }, 3.15);
    }, root);
    return () => ctx.revert();
  }, []);

  function submit(e) {
    e.preventDefault();
    if (!form.email.trim()) return;
    track('rescue_request_submitted', { clip: form.clip ? 'link' : 'none', notes: form.notes ? 'yes' : 'none' });
    setSent(true);
  }

  return (
    <div ref={rootRef} className="bg-[#05070b] text-[#f5f5f7] antialiased" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      {/* HERO — pinned, scroll-scrubbed */}
      <section className="coh-hero relative flex h-[100dvh] flex-col items-center justify-center overflow-hidden px-6">
        <div className="absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-center text-[12px] tracking-[0.08em] text-white/50">BRAINSNN · COHERENCE</div>
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 50% at 50% 30%, rgba(104,234,255,0.10), transparent 70%)' }} />
        <div className="relative z-10 flex w-full max-w-4xl flex-col items-center text-center">
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] md:text-[64px]">
            <span className="block overflow-hidden"><span className="coh-line-1 block">AI video drifts.</span></span>
            <span className="block overflow-hidden"><span className="coh-line-2 block bg-gradient-to-r from-[#68eaff] to-[#947cff] bg-clip-text text-transparent">Bring it back.</span></span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-[1.4] text-white/60">Generation keeps getting longer — coherence is not keeping up. We remove accumulated drift and flicker from AI-generated video, without regenerating a single frame.</p>
        </div>

        <div className="coh-video-card relative z-10 mt-8 w-full max-w-3xl overflow-hidden rounded-[11px] border border-white/10 bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
          <video ref={videoRef} className="block w-full" preload="auto" muted playsInline>
            <source src="/videos/coherence-demo-scrub.mp4" type="video/mp4" />
            <source src="/videos/coherence-demo-scrub.webm" type="video/webm" />
          </video>
          <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-[11px] tracking-wide text-white/70 coh-cap-a">drifted</div>
          <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-[11px] tracking-wide text-[#68eaff] coh-cap-b opacity-0">corrected</div>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] text-white/40 coh-hint">scroll to scrub the fix</div>
        </div>
        <div className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-3">
          {CHIPS.map((c) => <span key={c} className="coh-chip rounded-full border border-white/10 px-3 py-1 text-[12px] text-white/50">{c}</span>)}
        </div>
        <div className="relative z-10 mt-7 flex items-center gap-4 coh-cta">
          <a href="#rescue" onClick={() => track('coherence_cta_clicked', { where: 'hero' })} className="rounded-full bg-[#68eaff] px-6 py-3 text-[15px] font-medium text-[#04121a] transition hover:brightness-110">Fix my video</a>
          <a href="#proof" className="text-[15px] text-[#68eaff] hover:underline">Watch before / after</a>
        </div>
      </section>

      {/* PROOF */}
      <section id="proof" className="mx-auto max-w-5xl px-6 py-24 md:py-32">
        <h2 className="text-center text-[28px] font-semibold tracking-[-0.01em] md:text-[40px]">Measured in lab runs.</h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-[15px] leading-[1.5] text-white/50">Clean reference locked; the same frozen pipeline graded on every run. Honest labels: research preview, not production claims.</p>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STATS.map((s) => (
            <div key={s.l} className="rounded-[11px] bg-white/[0.04] p-8 text-center">
              <div className="text-[44px] font-semibold leading-none tracking-[-0.02em] text-[#68eaff]">{s.v}</div>
              <div className="mt-3 text-[14px] leading-[1.5] text-white/55">{s.l}</div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-[12px] text-white/35">Validated on synthetic fixtures and lab rollouts. Real-footage 1080p validation in progress — numbers published as they land.</p>
      </section>

      {/* HOW */}
      <section className="mx-auto max-w-5xl px-6 pb-24 md:pb-32">
        <h2 className="text-center text-[28px] font-semibold tracking-[-0.01em] md:text-[40px]">How it works</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-[11px] bg-white/[0.04] p-8">
              <div className="text-[13px] font-semibold tracking-[0.08em] text-[#68eaff]">STEP {s.n}</div>
              <div className="mt-3 text-[21px] font-semibold">{s.t}</div>
              <p className="mt-2 text-[14px] leading-[1.5] text-white/55">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* OFFER */}
      <section id="rescue" className="mx-auto max-w-3xl px-6 pb-24 md:pb-32">
        <div className="rounded-[18px] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-8 md:p-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[28px] font-semibold tracking-[-0.01em] md:text-[34px]">The Video Rescue</h2>
            <div className="text-[17px] text-white/60"><span className="text-[34px] font-semibold text-[#f5f5f7]">$99</span> / clip</div>
          </div>
          <ul className="mt-6 space-y-3 text-[15px] leading-[1.5] text-white/70">
            <li>· One AI-generated clip, up to ~60 seconds — we process at any length you have</li>
            <li>· Drift and flicker removed, detail preserved; you get the corrected file plus a before/after readout</li>
            <li>· <span className="text-[#68eaff]">If we cannot improve it, you pay nothing.</span></li>
            <li>· Longer cuts and multi-clip jobs: tell us and we will scope it in the reply</li>
          </ul>
          {sent ? (
            <div className="mt-8 rounded-[11px] border border-[#68eaff]/30 bg-[#68eaff]/10 p-5 text-[15px] text-[#d9f7ff]">Received — we will reply to the email you left within 24 hours. Check spam if you do not hear from us.</div>
          ) : (
            <form onSubmit={submit} className="mt-8 grid gap-3">
              <input required type="email" placeholder="you@studio.com" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="rounded-[8px] border border-white/15 bg-black/30 px-4 py-3 text-[15px] outline-none placeholder:text-white/30 focus:border-[#68eaff]" />
              <input type="url" placeholder="Clip link (Drive / Dropbox / WeTransfer — or reply with it later)" value={form.clip}
                onChange={(e) => setForm({ ...form, clip: e.target.value })}
                className="rounded-[8px] border border-white/15 bg-black/30 px-4 py-3 text-[15px] outline-none placeholder:text-white/30 focus:border-[#68eaff]" />
              <textarea rows="3" placeholder="What is wrong with it? (optional)" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="rounded-[8px] border border-white/15 bg-black/30 px-4 py-3 text-[15px] outline-none placeholder:text-white/30 focus:border-[#68eaff]" />
              <button type="submit" className="mt-1 rounded-full bg-[#68eaff] px-6 py-3 text-[15px] font-medium text-[#04121a] transition hover:brightness-110">Start my rescue</button>
            </form>
          )}
        </div>
      </section>

      {/* VISION */}
      <section className="mx-auto max-w-3xl px-6 pb-20 text-center">
        <h2 className="text-[24px] font-semibold tracking-[-0.01em] md:text-[28px]">Where this goes</h2>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-[1.6] text-white/55">The rescue is the first half of the story. The engine underneath is heading somewhere bigger: coherence from the start — multi-minute shots that never drift, at constant memory. We publish the build as it happens.</p>
        <div className="mt-7 flex items-center justify-center gap-6 text-[14px]">
          <a href="/evidence" className="text-[#68eaff] hover:underline">Read the evidence discipline</a>
          <a href="/arcade" className="text-white/50 hover:text-white/80">Explore the lab</a>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-8 text-center text-[12px] text-white/30">
        BrainSNN Coherence — research preview. No photorealism claims; results depend on source footage.
      </footer>
    </div>
  );
}
