import React, { useEffect, useRef } from 'react';
import { ArrowUpRight, ScanLine } from 'lucide-react';
import { NAV_ITEMS, OVERFLOW_ITEMS } from './navigation.js';
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
      {NAV_ITEMS.map((item) => <a key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}>{item.label}</a>)}
      <details className="public-overflow" ref={overflow}><summary aria-label="More navigation">More</summary><div>{OVERFLOW_ITEMS.map((item) => <a key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}>{item.label}</a>)}</div></details>
    </nav>
    <a className="world-nav-cta" href="/scan" aria-current={active === 'scan' ? 'page' : undefined}><ScanLine size={16} aria-hidden="true" />Start scanning <ArrowUpRight size={15} aria-hidden="true" /></a>
  </header>;
}
export function PublicFooter() {
  return <footer className="bh-footer world-footer"><div><a href="/" className="world-footer-brand">BrainSNN</a><span>Make the real world digital.</span></div><nav aria-label="Footer navigation"><a href="/world/index.html#workspace">Create a world</a><a href="/scan">Capture studio</a><a href="/world/api.html">Developers</a><a href="/arena/">Robot Arena</a><a href="/lab">Lab</a></nav></footer>;
}
