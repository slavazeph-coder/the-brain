import React, { useEffect, useRef } from 'react';
import { NAV_ITEMS } from './navigation.js';
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
      <details className="public-overflow" ref={overflow}><summary aria-label="More navigation">More</summary><div><a href="/lab">Lab</a></div></details>
    </nav>
  </header>;
}
export function PublicFooter() {
  return <footer className="bh-footer"><a href="/">BrainSNN</a><a href="/lab">Lab</a></footer>;
}
