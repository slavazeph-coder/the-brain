import React, { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { track } from '../lib/analytics.js';
import '../styles/front-door.css';

// Each door states what it does and what it does not measure, in the same terms
// the destination uses. Keep these in step with /walk/, /world/ and the API page.
const DOORS = [
  {
    id: 'walk',
    href: '/walk/',
    kicker: 'On your phone',
    title: 'Walk',
    lead: 'Walk a space and tap features as you pass them. Get a map, photos and video, and export GeoPackage, GPX or CSV.',
    limit: 'Map position comes from the phone’s own GPS accuracy. Shapes and distances are not measured.',
    action: 'Start a walk',
    art: 'walk',
  },
  {
    id: 'world',
    href: '/world/',
    kicker: 'In the browser',
    title: 'World Builder',
    lead: 'Turn a walk video, photos or a scan into an editable 3D world. Move objects, try a robot route and export the scene.',
    limit: 'Scale stays unverified until you check a known length. Robot routes are planning previews, not physical execution.',
    action: 'Open World Builder',
    art: 'world',
  },
  {
    id: 'api',
    href: '/world/api.html',
    kicker: 'For developers',
    title: 'API',
    lead: 'Send captures to the reconstruction worker from your own code, then fetch jobs and artifacts. Each key has its own limits and usage.',
    limit: 'Access is by pilot key. Reconstruction runs on the worker, not on the phone.',
    action: 'Read the API',
    art: 'api',
  },
];

const MORE = [
  { href: '/app', label: 'Creative Engine' },
  { href: '/agent-lab', label: 'Agent Lab' },
  { href: '/arena/', label: 'Robot Arena' },
  { href: '/scan', label: 'Capture studio' },
  { href: '/office', label: 'Review' },
  { href: '/evidence', label: 'Evidence' },
  { href: '/lab', label: 'Lab' },
];

function DoorArt({ kind }) {
  if (kind === 'walk') {
    return <svg viewBox="0 0 160 90" aria-hidden="true" focusable="false">
      <path className="fd-art-track" d="M14 72 C38 70 40 46 62 44 S92 58 104 38 S132 18 148 20" />
      <circle className="fd-art-pin" cx="62" cy="44" r="5" />
      <circle className="fd-art-pin fd-art-pin-alt" cx="104" cy="38" r="5" />
      <circle className="fd-art-pin" cx="148" cy="20" r="5" />
      <circle className="fd-art-you" cx="14" cy="72" r="4" />
    </svg>;
  }
  if (kind === 'world') {
    return <svg viewBox="0 0 160 90" aria-hidden="true" focusable="false">
      <path className="fd-art-floor" d="M80 16 L144 48 L80 80 L16 48 Z" />
      <path className="fd-art-box" d="M52 46 L68 38 L84 46 L84 58 L68 66 L52 58 Z M52 46 L68 54 L84 46 M68 54 L68 66" />
      <path className="fd-art-route" d="M100 64 C112 56 116 46 108 38" />
      <circle className="fd-art-you" cx="100" cy="64" r="4" />
    </svg>;
  }
  return <svg viewBox="0 0 160 90" aria-hidden="true" focusable="false">
    <path className="fd-art-code" d="M46 26 L28 45 L46 64 M114 26 L132 45 L114 64" />
    <path className="fd-art-line" d="M60 34 H98 M60 45 H108 M60 56 H88" />
  </svg>;
}

/** The homepage: three ways in, everything else one click away. */
export function FrontDoor() {
  useEffect(() => {
    document.title = 'BrainSNN | Walk a space, build its world';
    track('front_door_viewed');
  }, []);

  return (
    <div className="bh-site front-door">
      <a className="bh-skip" href="#front-door-main">Skip to content</a>
      <PublicNav active="home" />
      <main id="front-door-main" className="fd-main">
        <section className="fd-hero" aria-labelledby="fd-title">
          <p className="bh-kicker">Phone walk → 3D world → robot test</p>
          <h1 id="fd-title">Map a space. Build its world. <span>Test a robot in it.</span></h1>
          <p className="fd-lead">Start with a phone walk, open it as a 3D world, or call the same pipeline from your own code.</p>
        </section>
        <ul className="fd-doors" aria-label="Choose where to start">
          {DOORS.map((door) => (
            <li key={door.id}>
              <a className={`fd-door fd-door-${door.id}`} href={door.href} onClick={() => track('front_door_opened', { door: door.id })}>
                <div className="fd-art"><DoorArt kind={door.art} /></div>
                <p className="fd-door-kicker">{door.kicker}</p>
                <h2>{door.title}</h2>
                <p className="fd-door-lead">{door.lead}</p>
                <p className="fd-door-limit">{door.limit}</p>
                <span className="fd-door-action">{door.action} <ArrowRight size={16} aria-hidden="true" /></span>
              </a>
            </li>
          ))}
        </ul>
        <p className="fd-flow">A walk’s video opens straight in World Builder, which asks before anything is sent to a worker.</p>
        <nav className="fd-more" aria-label="More from BrainSNN">
          <span>Also here</span>
          {MORE.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
      </main>
      <PublicFooter />
    </div>
  );
}
