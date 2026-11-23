import React, { useEffect, useRef } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { NAV_ITEMS, OVERFLOW_ITEMS } from './navigation.js';

const LINKS = NAV_ITEMS.filter((item) => !item.cta);
const CTA = NAV_ITEMS.find((item) => item.cta);
import '../styles/behaviour-home.css';
import '../styles/public-navigation.css';

export function PublicNav({ active }) {
  const overflow = useRef(null);
  useEffect(() => {
    const closeOutside = (event) => { if (overflow.current && !overflow.current.contains(event.target)) overflow.current.open = false; };
    const escape = (event) => { if (event.key === 'Escape' && overflow.current?.open) { overflow.current.open = false; overflow.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', escape); };
  }, []);
  return <header className="bh-nav public-nav">
    <a className="bh-brand" href="/" aria-label="BrainSNN home"><span className="bh-mark" aria-hidden="true">B</span><strong>BrainSNN</strong></a>
    <nav aria-label="Main navigation">
      {LINKS.map((item) => <a key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}>{item.label}</a>)}
      <details className="public-overflow" ref={overflow}><summary aria-label="More navigation">More</summary><div>{OVERFLOW_ITEMS.map((item) => <a key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}>{item.label}</a>)}</div></details>
    </nav>
    <a className="world-nav-cta" href={CTA.href} aria-current={active === CTA.id ? 'page' : undefined}><CTA.icon size={16} aria-hidden="true" />{CTA.ctaLabel} <ArrowUpRight size={15} aria-hidden="true" /></a>
  </header>;
}
export function PublicFooter() {
  return <footer className="bh-footer world-footer"><div><a href="/" className="world-footer-brand">BrainSNN</a><span>Make the real world digital.</span></div><nav aria-label="Footer navigation"><a href="/walk/">Walk</a><a href="/world/">World Builder</a><a href="/world/api.html">API</a><a href="/app">Creative Engine</a><a href="/arena/">Robot Arena</a><a href="/office">Review</a><a href="/lab">Lab</a></nav></footer>;
}
