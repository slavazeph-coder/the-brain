import React, { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { track } from '../lib/analytics.js';
import '@fontsource/newsreader/latin-300.css';
import '@fontsource/newsreader/latin-400.css';
import '../styles/front-door.css';

// Each door states what it does and what it does not measure, in the same terms
// the destination uses. Keep these in step with /walk/, /world/ and the platform.
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
    href: '/platform/',
    kicker: 'For developers',
    title: 'API',
    lead: 'Try every call in a sandbox, then use your key: projects, evidence, client review, keys and usage, plus processing for captures.',
    limit: 'Real data needs a pilot key. Reconstruction runs on the worker, not on the phone.',
    action: 'Open the platform',
    art: 'api',
  },
];

// What the engine does with a later walk, in the order it does it (docs/world-update-loop.md).
const LOOP = [
  ['Observe', 'Every frame of a later walk is placed in the site’s scan, or reported as not placed. Nothing is guessed.', 'observe'],
  ['Understand', 'New, moved and removed objects are told apart from gaps in the scan, including plain boxes with nothing to track.', 'understand'],
  ['Remember', 'Changes are proposed to the site record. A named person approves them; nothing applies itself.', 'remember'],
  ['Adapt', 'Each robot is replanned with its own footprint and height, and told when it can no longer pass.', 'adapt'],
  ['Share', 'Approved routes go to every robot that works the site.', 'share'],
];

// Files a pilot delivers (docs/sales/site-to-sim-pilot.md) and Walk exports.
const FORMATS = ['USD', 'glTF', 'IFC4', 'Nav2 map', 'DXF', 'GeoPackage'];

const MORE = [
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

// A route that comes down the page and bends around a box: BrainSNN's line, drawn once behind the opening sections.
const ROUTE = 'M300 0 C300 160 220 240 230 380 C238 500 360 520 372 640 C384 760 250 800 196 900 C150 990 236 1070 330 1120 C420 1168 430 1290 352 1380 C290 1452 214 1500 236 1640';
function RouteLine() {
  return <svg className="fd-route" viewBox="0 0 480 1680" preserveAspectRatio="xMidYMin meet" aria-hidden="true" focusable="false">
    <path className="fd-route-ghost" d="M330 0 C330 170 262 250 270 390 C278 520 404 540 412 650 C424 760 292 812 238 910 C190 1000 268 1078 360 1126 C452 1174 462 1296 384 1388 C320 1460 246 1508 268 1640" />
    <rect className="fd-route-box" x="250" y="560" width="74" height="74" rx="6" />
    <path className="fd-route-path" d={ROUTE} />
    <circle className="fd-route-robot" r="6" style={{ offsetPath: `path('${ROUTE}')` }} />
  </svg>;
}

/** A crate lands in the aisle; the small robot and the cart each take their own way round. */
function AdaptScene() {
  return <svg className="fd-scene" viewBox="0 0 480 300" role="img" aria-labelledby="fd-scene-title">
    <title id="fd-scene-title">An aisle between two shelf rows. A crate appears in the middle; a small robot and a wider cart each reroute around it with their own clearance.</title>
    <rect className="fd-scene-floor" x="0" y="0" width="480" height="300" rx="14" />
    <rect className="fd-scene-shelf" x="96" y="18" width="288" height="66" rx="4" />
    <rect className="fd-scene-shelf" x="96" y="216" width="288" height="66" rx="4" />
    <path className="fd-scene-before" d="M44 150 H436" />
    <path className="fd-scene-small" d="M44 150 C120 150 150 112 200 112 H290 C330 112 360 150 436 150" />
    <path className="fd-scene-cart" d="M44 150 C110 150 140 196 196 198 H300 C344 198 370 150 436 150" />
    <rect className="fd-scene-crate" x="214" y="126" width="56" height="48" rx="4" />
    <circle className="fd-scene-dot fd-scene-dot-small" r="7" style={{ offsetPath: "path('M44 150 C120 150 150 112 200 112 H290 C330 112 360 150 436 150')" }} />
    <circle className="fd-scene-dot fd-scene-dot-cart" r="11" style={{ offsetPath: "path('M44 150 C110 150 140 196 196 198 H300 C344 198 370 150 436 150')" }} />
    <text className="fd-scene-label" x="44" y="138">Start</text>
    <text className="fd-scene-label" x="404" y="138">Goal</text>
  </svg>;
}

/** The homepage: what BrainSNN does, how the engine keeps a site current, and three ways in. */
export function FrontDoor() {
  useEffect(() => {
    document.title = 'BrainSNN | Walk a space, build its world';
    track('front_door_viewed');
  }, []);

  return (
    <div className="bh-site front-door fd-calm">
      <a className="bh-skip" href="#front-door-main">Skip to content</a>
      <PublicNav active="home" />
      <main id="front-door-main" className="fd-main">
        <RouteLine />
        <section className="fd-hero" aria-labelledby="fd-title">
          <p className="fd-eyebrow">Spatial intelligence for robots</p>
          <h1 id="fd-title">Map a space. Build its world. <span>Test a robot in it.</span></h1>
          <p className="fd-lead">Start with a phone walk, open it as a 3D world, or call the same pipeline from your own code.</p>
          <div className="fd-actions">
            <a className="fd-pill fd-pill-primary" href="/world/api.html#site-pilot" onClick={() => track('front_door_opened', { door: 'pilot' })}>Request a site pilot <ArrowRight size={16} aria-hidden="true" /></a>
            <a className="fd-pill" href="/platform/" onClick={() => track('front_door_opened', { door: 'platform-hero' })}>Try the API</a>
          </div>
        </section>

        <section className="fd-formats" aria-labelledby="fd-formats-title">
          <p id="fd-formats-title" className="fd-eyebrow">Delivered in the formats your team already uses</p>
          <ul>{FORMATS.map((format) => <li key={format}>{format}</li>)}</ul>
        </section>

        <section className="fd-text" aria-labelledby="fd-why">
          <h2 id="fd-why">Every site is different. Every site changes.</h2>
          <p>A robot that worked in one building has to be checked again in the next, and again when someone moves a pallet. Today that takes a site visit or a hand-built model.</p>
          <p>BrainSNN turns a phone walk into a checked, metric world your robots can plan in, and keeps it current as the site changes.</p>
        </section>

        <section className="fd-text fd-loop" aria-labelledby="fd-loop-title">
          <h2 id="fd-loop-title">One robot sees. Another adapts.</h2>
          <p>A later walk, by a phone today and by a robot tomorrow, is compared with the site’s scan. What changed is proposed for review, and every robot gets a route that fits its own size.</p>
          <ol>
            {LOOP.map(([title, text, tone]) => <li key={title}>
              <span className={`fd-chip fd-chip-${tone}`} aria-hidden="true" />
              <div><h3>{title}</h3><p>{text}</p></div>
            </li>)}
          </ol>
        </section>

        <section className="fd-band" aria-labelledby="fd-engine">
          <div className="fd-band-art"><AdaptScene /></div>
          <div className="fd-band-copy">
            <p className="fd-eyebrow">Spatial intelligence engine</p>
            <h2 id="fd-engine">The map stays true after the site changes.</h2>
            <p>In rendered rooms with known answers — moved crates, plain boxes, thin poles, low steps, overhangs — robots kept their clearance in 20 of 21 scenarios. The one miss was an object no camera saw. A real room is next.</p>
            <a className="fd-band-link" href="/platform/">Drop a box in the planner <ArrowRight size={16} aria-hidden="true" /></a>
          </div>
        </section>

        <section className="fd-start" aria-labelledby="fd-start-title">
          <h2 id="fd-start-title">Start where you are.</h2>
          <ul className="fd-doors" aria-label="Choose where to start">
            {DOORS.map((door) => (
              <li key={door.id}>
                <a className={`fd-door fd-door-${door.id}`} href={door.href} onClick={() => track('front_door_opened', { door: door.id })}>
                  <div className="fd-art"><DoorArt kind={door.art} /></div>
                  <p className="fd-door-kicker">{door.kicker}</p>
                  <h3>{door.title}</h3>
                  <p className="fd-door-lead">{door.lead}</p>
                  <p className="fd-door-limit">{door.limit}</p>
                  <span className="fd-door-action">{door.action} <ArrowRight size={16} aria-hidden="true" /></span>
                </a>
              </li>
            ))}
          </ul>
          <p className="fd-flow">A walk’s video opens straight in World Builder, which asks before anything is sent to a worker.</p>
        </section>

        <section className="fd-closing" aria-labelledby="fd-closing-title">
          <svg className="fd-closing-mark" viewBox="0 0 64 32" aria-hidden="true" focusable="false"><path d="M2 24 C16 24 18 8 30 8 C40 8 40 24 50 24 H62" /><rect x="24" y="2" width="12" height="12" rx="2" /></svg>
          <h2 id="fd-closing-title">Bring us one site.</h2>
          <p>A phone walk of one building, checked and delivered as a scene, a map and a route report your robot team can load.</p>
          <div className="fd-actions">
            <a className="fd-pill fd-pill-primary" href="/world/api.html#site-pilot">Request a site pilot <ArrowRight size={16} aria-hidden="true" /></a>
            <a className="fd-pill" href="/platform/">Open the platform</a>
          </div>
        </section>

        <nav className="fd-more" aria-label="More from BrainSNN">
          <span>Also here</span>
          {MORE.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
      </main>
      <PublicFooter />
    </div>
  );
}
