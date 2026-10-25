import React, { useEffect } from 'react';
import {
  ArrowRight, ArrowUpRight, Bot, Boxes, Building2, Camera,
  ChevronRight, Code2, Factory, Layers3, Move3D, Ruler, ScanLine,
  ShieldCheck, Sparkles, Wrench,
} from 'lucide-react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { WorldScene } from './WorldScene.jsx';
import { track } from '../lib/analytics.js';
import '../styles/world-engine.css';

const INDUSTRIES = [
  { icon: Building2, name: 'Real estate', slug: 'real-estate', caption: 'A space people can explore before they visit.', output: 'Shareable 3D walkthroughs', number: '01' },
  { icon: Wrench, name: 'Construction & trades', slug: 'trades', caption: 'Document visible site conditions before a quote or renovation.', output: 'Site references and preliminary measurements', number: '02' },
  { icon: Ruler, name: 'Architecture & design', slug: 'architecture', caption: 'Give designers a spatial starting point instead of scattered photos.', output: 'Geometry references and concept layouts', number: '03' },
  { icon: Bot, name: 'Robotics', slug: 'robotics', caption: 'Move from an image of a site toward a robot-testable scene.', output: 'Reviewed maps and route previews', number: '04' },
  { icon: Factory, name: 'Industrial & facilities', slug: 'industrial', caption: 'Bring visible assets and spaces into a navigable digital record.', output: 'Equipment and space context', number: '05' },
  { icon: Code2, name: 'Developers', slug: 'developers', caption: 'Build spatial products on structured reconstructions.', output: 'World objects, assets and APIs', number: '06' },
];
const WORKFLOW = [
  { number: '01', icon: Camera, title: 'Capture', description: 'Walk through a space with a phone. Use an overlapping video or a photo set with good coverage.' },
  { number: '02', icon: ScanLine, title: 'Reconstruct', description: 'Camera tracking, inferred depth and 3D fusion establish a preliminary scene. Worker processing is in early access.' },
  { number: '03', icon: Layers3, title: 'Understand', description: 'Separate the appearance, geometry and object layers. Review uncertain geometry before measuring or planning.' },
  { number: '04', icon: ArrowUpRight, title: 'Use it', description: 'Explore, document, share or hand off the scene to a professional workflow, robot planner or future API.' },
];
const OUTPUTS = [
  { icon: Move3D, num: '01 / VISUAL', title: 'Explore reality', description: 'Photorealistic views and shareable 3D walkthroughs from captured imagery.', foot: 'Gaussian splats · Visual models' },
  { icon: Ruler, num: '02 / SPATIAL', title: 'Work with geometry', description: 'Point clouds, rooms, surfaces and measurements with a visible scale and uncertainty boundary.', foot: 'Dense points · Meshes · Scale' },
  { icon: Boxes, num: '03 / INTELLIGENCE', title: 'Put a world to work', description: 'Semantic objects, site context and robot-ready planning layers built on reviewed geometry.', foot: 'Objects · Scene graphs · Arena' },
];

export function WorldHome() {
  useEffect(() => {
    document.title = 'BrainSNN | Turn video into a 3D world';
    track('world_engine_home_viewed');
  }, []);
  return <div className="bh-site world-site" data-build-marker="world-engine-home-v1">
    <a className="bh-skip" href="#world-main">Skip to content</a>
    <PublicNav active="world" />
    <main id="world-main">
      <section className="world-hero" aria-labelledby="world-headline">
        <div className="world-hero-copy">
          <div className="world-eyebrow"><span className="world-eyebrow-glint" /> INTRODUCING THE BRAINSNN WORLD ENGINE <span className="world-beta-tag">EARLY ACCESS</span></div>
          <h1 id="world-headline">Turn your videos<br />into <span>3D worlds.</span></h1>
          <p className="world-hero-lead">Walk through a space with your phone. BrainSNN is building the missing layer between ordinary video and useful, explorable spatial data.</p>
          <p className="world-hero-sub">From property walkthroughs to construction documentation, digital twins and robotics. One capture, many possibilities.</p>
          <div className="world-hero-actions">
            <a href="/scan" className="world-button world-button-primary" onClick={() => track('world_engine_scan_cta_clicked', { placement: 'hero' })}><ScanLine size={18} aria-hidden="true" /> Start with a scan <ArrowRight size={17} aria-hidden="true" /></a>
            <a href="#how-it-works" className="world-button world-button-outline">See how it works <ChevronRight size={18} aria-hidden="true" /></a>
          </div>
          <p className="world-hero-disclosure"><ShieldCheck size={15} aria-hidden="true" /> Browser capture preview is available. Automated reconstruction and professional exports are being developed; a connected worker is required for processing.</p>
          <div className="world-hero-chips" aria-label="Supported capture inputs"><span><Camera size={14}/> Phone video</span><span><Sparkles size={14}/> Photos</span><span><Layers3 size={14}/> 3D point clouds</span></div>
        </div>
        <WorldScene />
      </section>

      <section className="world-flow-strip" aria-label="From capture to application">
        <span className="world-strip-title">FROM THE CAMERA TO YOUR WORKFLOW</span>
        <div><span>01 / VIDEO</span><ArrowRight size={15} /><span>02 / 3D WORLD</span><ArrowRight size={15} /><span>03 / USEFUL DATA</span><ArrowRight size={15} /><span>04 / YOUR INDUSTRY</span></div>
      </section>

      <section className="world-section world-overview" id="platform" aria-labelledby="world-overview-title">
        <div className="world-section-intro">
          <div><p className="world-section-kicker">ONE ENGINE · MANY OUTPUTS</p><h2 id="world-overview-title">A scan should be more<br />than a pretty picture.</h2></div>
          <p>Most spaces are still trapped in photos and videos. We want to make them navigable, understandable and useful, without specialized scanning hardware for everyday jobs.</p>
        </div>
        <div className="world-output-grid">
          {OUTPUTS.map(({ icon: Icon, num, title, description, foot }) => <article className="world-output" key={title}>
            <div className="world-output-number">{num}<Icon size={24} strokeWidth={1.5} aria-hidden="true" /></div>
            <div className="world-output-graphic" aria-hidden="true"><span/><span/><span/><i/></div>
            <h3>{title}</h3><p>{description}</p><div className="world-output-foot">{foot}</div>
          </article>)}
        </div>
        <div className="world-notice"><ShieldCheck size={19} aria-hidden="true" /><p><strong>Built for honest geometry.</strong> Video-derived depth is not a substitute for verified survey measurements. BrainSNN will distinguish observed surfaces, estimated scale and inferred or missing details.</p></div>
      </section>

      <section className="world-section world-how" id="how-it-works" aria-labelledby="world-how-title">
        <div className="world-section-intro">
          <div><p className="world-section-kicker">HOW THE WORLD ENGINE WORKS</p><h2 id="world-how-title">Four steps from<br /><span>capture to context.</span></h2></div>
          <p>One simple starting experience, with more precise review and specialist tools when the job demands it.</p>
        </div>
        <div className="world-steps">{WORKFLOW.map(({ number, icon: Icon, title, description }) => <article key={number}><div className="world-step-top"><span>{number}</span><Icon size={23} aria-hidden="true" /></div><h3>{title}</h3><p>{description}</p></article>)}</div>
        <div className="world-how-action"><a className="world-text-link" href="/scan">Prepare your first capture <ArrowRight size={17} aria-hidden="true" /></a><span>Nothing uploads until you explicitly send it to a connected reconstruction worker.</span></div>
      </section>

      <section className="world-section world-industries" id="industries" aria-labelledby="world-industries-title">
        <div className="world-section-intro">
          <div><p className="world-section-kicker">BUILT FOR THE REAL WORLD</p><h2 id="world-industries-title">Every space.<br /><span>A different possibility.</span></h2></div>
          <p>Start from the same camera capture. Change the output to suit the person doing the work.</p>
        </div>
        <div className="world-industry-grid">
          {INDUSTRIES.map(({ icon: Icon, name, slug, caption, output, number }) => <a className="world-industry" key={slug} href={'/scan?use=' + slug} onClick={() => track('world_industry_opened', { use_case: slug })}>
            <div className="world-industry-top"><Icon size={23} strokeWidth={1.5} aria-hidden="true" /><span>{number}</span></div>
            <h3>{name}</h3><p>{caption}</p><div className="world-industry-bottom"><span>{output}</span><ArrowUpRight size={18} aria-hidden="true" /></div>
          </a>)}
        </div>
      </section>

      <section className="world-section world-builder" id="developers" aria-labelledby="world-build-title">
        <div className="world-builder-copy">
          <p className="world-section-kicker">WORLD ENGINE / DEVELOPERS</p>
          <h2 id="world-build-title">One world.<br /><span>Every application.</span></h2>
          <p>We are designing a reconstruction API for developers, robotics teams and software platforms. A structured scene should be reusable instead of locked into one viewer.</p>
          <div className="world-builder-pills"><span>Point clouds</span><span>Meshes</span><span>Objects</span><span>Camera poses</span><span>Scene exports</span></div>
          <a className="world-button world-button-outline" href="mailto:info@xioai.ca?subject=BrainSNN%20World%20Engine%20API%20pilot">Discuss API access <ArrowUpRight size={17} aria-hidden="true" /></a>
        </div>
        <div className="world-builder-code" role="region" aria-label="Proposed reconstruction API example">
          <div className="world-code-top"><span><i/> PROPOSED API CONTRACT</span><span>NOT YET PUBLIC</span></div>
          <pre><code>{['POST /v1/worlds','Authorization: Bearer <token>','Content-Type: multipart/form-data','','capture: walkthrough.mp4','output: ["points", "mesh", "scene"]','scale: "reference-required"','','→ 202 Accepted','{','  "world_id": "world_...",','  "status": "queued"','}'].join('\n')}</code></pre>
          <div className="world-code-bottom">Proposed interface. Endpoints and pricing will be confirmed during pilot testing.</div>
        </div>
      </section>

      <section className="world-section world-questions" id="faq" aria-labelledby="world-faq-title">
        <div><p className="world-section-kicker">GOOD QUESTIONS</p><h2 id="world-faq-title">Reality needs<br />clear boundaries.</h2></div>
        <div className="world-faq-list">
          <details><summary>Do I need a LiDAR-equipped phone?<ChevronRight size={18}/></summary><p>No dedicated LiDAR device is required to preview ordinary video and photographs. Camera-only 3D reconstruction is a research and early-access workflow; optional LiDAR and reference measurements can improve reliability.</p></details>
          <details><summary>Can BrainSNN replace a professional survey?<ChevronRight size={18}/></summary><p>Not for safety-critical, survey-grade or precision engineering work without independent validation. Dense AI points are not automatically accurate measured returns. Every professional workflow needs an appropriate scale and confidence check.</p></details>
          <details><summary>Can I see wiring or pipes behind a wall?<ChevronRight size={18}/></summary><p>No. RGB images observe visible surfaces. Concealed systems require plans, instrumentation, invasive inspection or other reliable evidence.</p></details>
          <details><summary>Can I use the robot Arena today?<ChevronRight size={18}/></summary><p>Yes. The existing Arena supports local scripted practice, reviewed floor maps and route previews. Reconstruction processing requires a compatible connected worker; simulated results are not physical deployment certification.</p></details>
        </div>
      </section>

      <section className="world-final" aria-labelledby="world-final-title">
        <div><p className="world-section-kicker">START WITH THE SPACE IN FRONT OF YOU</p><h2 id="world-final-title">The real world is<br /><span>your starting point.</span></h2><p>Capture once. Build what comes next.</p></div>
        <div className="world-final-actions"><a href="/scan" className="world-button world-button-primary"><ScanLine size={18} aria-hidden="true"/> Start scanning <ArrowRight size={17} aria-hidden="true"/></a><a href="/arena/" className="world-button world-button-outline">Explore Robot Arena <Bot size={17} aria-hidden="true" /></a></div>
      </section>
    </main>
    <PublicFooter />
  </div>;
}
