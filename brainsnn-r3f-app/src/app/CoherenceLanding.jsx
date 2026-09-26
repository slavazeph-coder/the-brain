import React, { useState } from 'react';
import { track } from '../lib/analytics.js';

// Customer-first landing for the coherence offer (the "AI Video Rescue").
// Positioning: generation is getting longer, coherence is not keeping up.
// Sell today: remove drift + flicker from AI-generated video, no regeneration.
// The research vision sits *below* the offer, not above it.

const PROOF_STATS = [
  { value: '−86%', label: 'drift variance', note: 'low-band stability, lab run' },
  { value: '0.99', label: 'detail retention', note: 'structure preserved' },
  { value: '0.97', label: 'motion preserved', note: 'no freeze, no smear' },
];

export function CoherenceLanding({ onNavigate, onStart }) {
  const [form, setForm] = useState({ email: '', clip: '', notes: '' });
  const [sent, setSent] = useState(false);

  React.useEffect(() => {
    track('coherence_landing_viewed');
  }, []);

  function submit(e) {
    e.preventDefault();
    if (!form.email.trim()) return;
    track('rescue_request_submitted', {
      clip: form.clip ? 'link' : 'none',
      notes: form.notes ? 'yes' : 'none',
    });
    setSent(true);
  }

  function goRescue(source) {
    track('coherence_cta_clicked', { source });
    const el = document.getElementById('rescue');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="min-h-screen bg-[#05070b] text-white antialiased">
      {/* HERO */}
      <section className="mx-auto max-w-5xl px-6 pt-24 pb-16 text-center">
        <p className="mb-6 text-xs uppercase tracking-[0.3em] text-cyan-300/80">
          BrainSNN · Coherence
        </p>
        <h1 className="text-4xl font-semibold leading-tight md:text-6xl">
          AI video drifts.
          <br />
          <span className="bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-transparent">
            Bring it back.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-white/70 md:text-lg">
          Generation keeps getting longer — coherence is not keeping up. We remove
          accumulated drift and flicker from AI-generated video, without regenerating
          a single frame.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={() => goRescue('hero')}
            className="rounded-xl bg-cyan-400 px-7 py-3 font-medium text-black transition hover:bg-cyan-300"
          >
            Fix my video →
          </button>
          <a
            href="#proof"
            onClick={() => track('coherence_cta_clicked', { source: 'proof' })}
            className="rounded-xl border border-white/20 px-7 py-3 font-medium text-white/90 transition hover:border-white/40"
          >
            Watch before / after
          </a>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-xs text-white/50">
          <span className="rounded-full border border-white/10 px-3 py-1">no regeneration</span>
          <span className="rounded-full border border-white/10 px-3 py-1">any model, after the fact</span>
          <span className="rounded-full border border-white/10 px-3 py-1">research preview · validated in lab runs</span>
        </div>
      </section>

      {/* PROOF */}
      <section id="proof" className="mx-auto max-w-4xl px-6 pb-20">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video
            className="w-full"
            src="/videos/coherence-demo.mp4"
            controls
            playsInline
            preload="metadata"
            onPlay={() => track('coherence_demo_played')}
          />
        </div>
        <p className="mt-3 text-center text-xs text-white/45">
          Research preview — drifted rollout vs. corrected, lab conditions. Same frames, corrected trajectory.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PROOF_STATS.map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
              <div className="text-3xl font-semibold text-cyan-300">{s.value}</div>
              <div className="mt-1 text-sm text-white/80">{s.label}</div>
              <div className="mt-1 text-xs text-white/40">{s.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="text-center text-2xl font-semibold md:text-3xl">How it works</h2>
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { n: '1', t: 'Send one clip', d: 'Any AI-generated clip — Kling, Veo, Runway, whatever wobbles. The harder the drift, the better.' },
            { n: '2', t: 'We stabilize it', d: 'A coherence pass over your existing frames. No regeneration, no re-prompting, no new renders.' },
            { n: '3', t: 'Get it back', d: 'Your improved clip plus a before/after report of what moved and what was preserved.' },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/20 text-sm font-semibold text-violet-300">
                {s.n}
              </div>
              <h3 className="mt-4 font-medium">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/60">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* OFFER */}
      <section id="rescue" className="mx-auto max-w-3xl px-6 pb-20">
        <div className="rounded-3xl border border-cyan-400/20 bg-gradient-to-b from-cyan-400/[0.06] to-transparent p-8 md:p-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-2xl font-semibold">The Video Rescue</h2>
            <div className="text-3xl font-semibold text-cyan-300">$99</div>
          </div>
          <p className="mt-3 text-sm text-white/70">
            One clip, one coherence pass, one honest report. Beta price — first ten rescues only.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/75">
            <li>✓ Clips up to ~60s (longer on request)</li>
            <li>✓ Before/after comparison delivered with the result</li>
            <li>✓ Can’t improve it? You pay nothing — we say so</li>
            <li>✓ Files and feedback stay private</li>
          </ul>

          {sent ? (
            <div className="mt-8 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-5 text-sm text-cyan-100">
              Received — we’ll reply to the email you left within one business day.
            </div>
          ) : (
            <form className="mt-8 space-y-3" onSubmit={submit}>
              <input
                required
                type="email"
                placeholder="your email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-cyan-400/60"
              />
              <input
                type="url"
                placeholder="link to your clip (Drive, Dropbox, YouTube…)"
                value={form.clip}
                onChange={(e) => setForm({ ...form, clip: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-cyan-400/60"
              />
              <textarea
                placeholder="what bothers you about it? (drift, flicker, warp, fades…)"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-cyan-400/60"
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-cyan-400 px-6 py-3 font-medium text-black transition hover:bg-cyan-300"
              >
                Start my rescue
              </button>
              <p className="text-center text-xs text-white/40">
                No payment now — we confirm feasibility first, then you pay only if you take the fix.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* VISION */}
      <section className="mx-auto max-w-4xl px-6 pb-16 text-center">
        <h2 className="text-xl font-semibold text-white/90 md:text-2xl">Where this goes</h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-white/55">
          The rescue pass is the first product of a larger idea: a streaming coherence
          engine for multi-minute shots — generators that hold together from the first
          frame to the last. That work is a research preview, and it happens in the lab.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={() => { track('coherence_cta_clicked', { source: 'vision' }); if (onNavigate) onNavigate('research'); }}
            className="rounded-xl border border-white/20 px-6 py-2.5 text-sm text-white/85 transition hover:border-white/40"
          >
            See the research
          </button>
          <button
            onClick={() => { track('coherence_cta_clicked', { source: 'lab' }); window.location.href = '/arcade'; }}
            className="rounded-xl border border-white/20 px-6 py-2.5 text-sm text-white/85 transition hover:border-white/40"
          >
            Explore the lab
          </button>
        </div>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-white/30">
        BrainSNN — the coherence layer for AI video.
      </footer>
    </div>
  );
}
