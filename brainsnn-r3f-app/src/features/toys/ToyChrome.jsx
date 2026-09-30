// Shared chrome for the homepage and every toy page: the same header, footer,
// "More toys" row, BrainSNN strip and sponsor slot, in the restored cyan/violet
// Sapient Playground identity (behaviour-home.css tokens).
import React, { useEffect } from 'react';
import { ArrowRight, Building2, Gauge } from 'lucide-react';
import { track } from '../../lib/analytics.js';
import { otherToys, sponsorFor } from './toyConfig.js';
import '../../styles/behaviour-home.css';
import './toys.css';

export const SPONSOR_URL = '/sponsor/gt3/';
export const ENTERPRISE_URL = '/arcade#brief';

export function BhNav() {
  return (
    <header className="bh-nav">
      <a className="bh-brand" href="/" aria-label="BrainSNN home">
        <span className="bh-mark" aria-hidden="true">B</span>
        <span><strong>BrainSNN</strong><small>Sapient Playground</small></span>
      </a>
      <nav aria-label="Main navigation">
        <a href="/#toys">Toys</a>
        <a href="/#tools">The engine</a>
        <a href="/arcade">Playground</a>
        <a href="/evidence">Evidence</a>
      </nav>
      <a className="bh-nav-cta" href="/app">Open BrainSNN <ArrowRight size={15} aria-hidden="true" /></a>
    </header>
  );
}

export function BhFooter() {
  return (
    <footer className="bh-footer">
      <span>BrainSNN · Sapient Playground</span>
      <nav aria-label="More BrainSNN">
        <a href="/lab">Neuro Powder Lab</a>
        <a href="/engine#api">For developers</a>
        <a href="/office">Agent office</a>
      </nav>
    </footer>
  );
}

/**
 * "Brought to you by" — wired on every toy, empty until a sponsor is added in
 * toyConfig.js. An empty slot renders only a hidden marker, never a
 * placeholder a visitor would see.
 */
export function SponsorSlot({ toyId, className = '' }) {
  const sponsor = sponsorFor(toyId);
  if (!sponsor) return <span data-sponsor-slot={toyId} hidden />;
  const name = sponsor.url
    ? <a href={sponsor.url} target="_blank" rel="noopener sponsored">{sponsor.name}</a>
    : <strong>{sponsor.name}</strong>;
  return <p className={`toy-sponsor ${className}`} data-sponsor-slot={toyId}>brought to you by {name}</p>;
}

export function MoreToys({ currentId, heading = 'More toys' }) {
  const toys = otherToys(currentId);
  return (
    <section className="toy-more" id="toys" aria-labelledby="toy-more-title">
      <div className="toy-more-head">
        <p className="bh-kicker">THE PLAYGROUND</p>
        <h2 id="toy-more-title">{heading}</h2>
      </div>
      <div className="toy-more-row">
        {toys.map((toy) => (
          <a
            key={toy.id}
            className={`toy-card toy-card-${toy.id}`}
            href={toy.path}
            onClick={() => track('toy_more_clicked', { toy: toy.id, from: currentId })}
          >
            <span className="toy-card-number" aria-hidden="true">{toy.number}</span>
            <span className="toy-card-hook">{toy.hook}</span>
            <strong>{toy.title}</strong>
            <span className="toy-card-blurb">{toy.blurb}</span>
            <span className="toy-card-cta">{toy.cta} <ArrowRight size={15} aria-hidden="true" /></span>
          </a>
        ))}
      </div>
    </section>
  );
}

/**
 * What BrainSNN is, in one paragraph, and the two ways to work with it.
 * The copy stays inside what the site can show: the toys run a simulation and
 * the analyzer's scores are signals, not measurements of anyone's brain.
 */
export function BrainsnnStrip() {
  return (
    <section className="toy-strip" aria-labelledby="toy-strip-title">
      <div>
        <p className="bh-kicker">WHAT THIS IS</p>
        <h2 id="toy-strip-title">A software layer for neural-style models.</h2>
        <p>
          BrainSNN runs a seven-region spiking simulation, a deterministic content engine and research tools for
          neural signals. The toys run the same model the analyzer uses, so what you poke is what scores your drafts.
          They are simulations, not recordings of anyone&apos;s brain — and every published score shows its limits.
        </p>
      </div>
      <div className="toy-strip-actions">
        <a className="bh-button bh-primary" href={SPONSOR_URL} onClick={() => track('toy_cta_clicked', { cta: 'sponsor' })}>
          <Gauge size={16} aria-hidden="true" /> Sponsor BrainSNN <ArrowRight size={16} aria-hidden="true" />
        </a>
        <a className="bh-button bh-secondary" href={ENTERPRISE_URL} onClick={() => track('toy_cta_clicked', { cta: 'enterprise' })}>
          <Building2 size={16} aria-hidden="true" /> Enterprise builds <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

/** Frame for a dedicated toy route: header, the toy, more toys, strip, footer. */
export function ToyPage({ toy, title, children }) {
  useEffect(() => {
    document.title = title || `${toy.title} | BrainSNN`;
    track('toy_opened', { toy: toy.id });
  }, [toy.id, toy.title, title]);
  return (
    <div className="bh-site bh-home-simple toy-site" data-toy={toy.id}>
      <a className="bh-skip" href="#toy-main">Skip to content</a>
      <BhNav />
      <main id="toy-main">
        {children}
        <MoreToys currentId={toy.id} />
        <BrainsnnStrip />
      </main>
      <BhFooter />
    </div>
  );
}
