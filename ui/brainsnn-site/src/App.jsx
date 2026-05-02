import { Html, Line, OrbitControls, Sparkles, Sphere, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  BRAIN_REGIONS,
  COMMUNITY_CHANNELS,
  GALLERY_ITEMS,
  GOOD_FIRST_ISSUES,
  LAUNCH_DAY_CHECKLIST,
  PATHWAYS,
  PRE_LAUNCH_CHECKLIST,
  README_MD,
  REGION_LONG_NAMES,
  SITE,
  SOCIAL_PREVIEW_COPY,
  VIRAL_CONTENT,
  WHY_CARDS,
} from "./constants/site";
import { useBrainSimulation } from "./hooks/useBrainSimulation";
import { getQuadraticPoint, pathwayCenter } from "./lib/brainMath";
import { copyToClipboard, parseGitHubRepo } from "./lib/copy";

const regionMap = Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, region]));

function useGitHubStars(repoUrl) {
  const [stars, setStars] = useState(null);

  useEffect(() => {
    const parsed = parseGitHubRepo(repoUrl);
    if (!parsed) return undefined;

    let cancelled = false;

    fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {
        if (!cancelled) setStars(null);
      });

    return () => {
      cancelled = true;
    };
  }, [repoUrl]);

  return stars;
}

function CopyButton({ value, className = "" }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyToClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" className={`copy-button ${className}`.trim()} onClick={handleCopy}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function SectionIntro({ eyebrow, title, body, centered = false }) {
  return (
    <div className={`section-intro ${centered ? "centered" : ""}`}>
      <span className="section-tag">{eyebrow}</span>
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

function ActivityMiniChart({ history = [] }) {
  const width = 120;
  const height = 40;
  if (!history.length) return null;

  const path = history
    .map((value, index) => {
      const x = (index / Math.max(history.length - 1, 1)) * width;
      const y = height - value * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg className="mini-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recent mean firing history">
      <path d={path} />
    </svg>
  );
}

function CodeBlock({ code, label }) {
  return (
    <div className="code-block-wrap">
      {label ? <div className="code-label">{label}</div> : null}
      <pre className="code-block"><code>{code}</code></pre>
    </div>
  );
}

function HeroBackground() {
  return (
    <svg className="hero-network" viewBox="0 0 1600 900" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <radialGradient id="glowA" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(119,219,228,0.22)" />
          <stop offset="100%" stopColor="rgba(119,219,228,0)" />
        </radialGradient>
      </defs>
      <g stroke="rgba(119,219,228,0.12)" strokeWidth="1.2" fill="none">
        <path d="M180 180 C 380 140, 520 220, 720 180" />
        <path d="M720 180 C 880 150, 1040 240, 1260 180" />
        <path d="M340 500 C 540 420, 760 620, 980 520" />
        <path d="M980 520 C 1160 470, 1290 560, 1430 480" />
        <path d="M240 300 C 420 360, 520 520, 700 560" />
        <path d="M700 560 C 880 610, 1050 380, 1240 340" />
      </g>
      {[[180, 180], [340, 500], [520, 220], [720, 180], [700, 560], [980, 520], [1260, 180], [1240, 340], [1430, 480]].map(([cx, cy], index) => (
        <g key={index}>
          <circle cx={cx} cy={cy} r="48" fill="url(#glowA)" />
          <circle cx={cx} cy={cy} r="3.5" fill="rgba(241,236,229,0.9)" />
        </g>
      ))}
    </svg>
  );
}

function BrainNode({ region, activity, selected, spiking, onSelect }) {
  const [hovered, setHovered] = useState(false);
  const scale = 0.38 + activity * 0.7 + (selected ? 0.1 : 0);
  const emissiveIntensity = 1.1 + activity * 2.8 + (spiking ? 0.7 : 0);
  const ringScale = 1.35 + activity * 0.35;

  return (
    <group position={region.position}>
      <mesh scale={ringScale}>
        <torusGeometry args={[0.52, 0.015, 10, 60]} />
        <meshBasicMaterial color={selected ? "#f1ece5" : region.color} transparent opacity={selected ? 0.92 : 0.46} />
      </mesh>

      <Sphere
        args={[scale, 32, 32]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(region.code);
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <meshStandardMaterial
          color={region.color}
          emissive={new THREE.Color(region.color)}
          emissiveIntensity={emissiveIntensity}
          metalness={0.25}
          roughness={0.32}
        />
      </Sphere>

      <Text position={[0, 0, scale + 0.4]} fontSize={0.28} color="#f1ece5" anchorX="center" anchorY="middle">
        {region.code}
      </Text>

      {(hovered || selected) && (
        <Html center position={[0, scale + 0.7, 0]} className="node-tooltip-wrap" distanceFactor={8}>
          <div className="node-tooltip">
            <strong>{region.name}</strong>
            <span>{region.description}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

function BrainEdges({ weights, selectedRegion }) {
  return (
    <group>
      {PATHWAYS.map((pathway) => {
        const from = regionMap[pathway.from];
        const to = regionMap[pathway.to];
        const start = new THREE.Vector3(...from.position);
        const end = new THREE.Vector3(...to.position);
        const control = pathwayCenter(start.toArray(), end.toArray(), pathway.curveOffset);
        const weight = weights[pathway.id] ?? pathway.initialWeight;
        const isSelected = selectedRegion && (selectedRegion === pathway.from || selectedRegion === pathway.to);
        const lineColor = pathway.inhibitory ? "#d86e78" : "#5fb7c1";

        return (
          <Line
            key={pathway.id}
            points={[start, control, end]}
            color={lineColor}
            lineWidth={isSelected ? 2.4 + weight * 1.6 : 1.2 + weight * 1.2}
            transparent
            opacity={isSelected ? 0.95 : 0.28 + weight * 0.45}
          />
        );
      })}
    </group>
  );
}

function Particle({ pathway, activities, selectedRegion }) {
  const meshRef = useRef();
  const travel = useRef(Math.random());

  const vectors = useMemo(() => {
    const start = new THREE.Vector3(...regionMap[pathway.from].position);
    const end = new THREE.Vector3(...regionMap[pathway.to].position);
    const control = pathwayCenter(start.toArray(), end.toArray(), pathway.curveOffset);
    return { start, control, end };
  }, [pathway]);

  useFrame(() => {
    const sourceActivity = activities[pathway.from] ?? 0.2;
    travel.current += 0.004 + sourceActivity * 0.018;
    if (travel.current > 1) travel.current = 0;
    const point = getQuadraticPoint(vectors.start, vectors.control, vectors.end, travel.current);
    if (meshRef.current) meshRef.current.position.copy(point);
  });

  const active = !selectedRegion || selectedRegion === pathway.from || selectedRegion === pathway.to;

  return (
    <mesh ref={meshRef} visible={active}>
      <sphereGeometry args={[0.06, 18, 18]} />
      <meshBasicMaterial color={pathway.inhibitory ? "#d86e78" : "#efe9e1"} transparent opacity={0.8} />
    </mesh>
  );
}

function SignalParticles({ activities, selectedRegion }) {
  return (
    <group>
      {PATHWAYS.flatMap((pathway) => [
        <Particle key={`${pathway.id}-a`} pathway={pathway} activities={activities} selectedRegion={selectedRegion} />,
        <Particle key={`${pathway.id}-b`} pathway={pathway} activities={activities} selectedRegion={selectedRegion} />,
      ])}
    </group>
  );
}

function FocusController({ controlsRef, selectedRegion }) {
  const { camera } = useThree();
  const defaultCamera = useMemo(
    () => ({ position: new THREE.Vector3(6.8, 4.4, 8.2), target: new THREE.Vector3(0.5, 0.1, 0) }),
    []
  );

  useFrame(() => {
    const selected = selectedRegion ? regionMap[selectedRegion] : null;
    const desiredTarget = selected ? new THREE.Vector3(...selected.position) : defaultCamera.target;
    const desiredPosition = selected
      ? new THREE.Vector3(selected.position[0] + 2.2, selected.position[1] + 1.8, selected.position[2] + 2.8)
      : defaultCamera.position;

    camera.position.lerp(desiredPosition, 0.06);
    if (controlsRef.current) {
      controlsRef.current.target.lerp(desiredTarget, 0.08);
      controlsRef.current.update();
    }
  });

  return null;
}

function BrainScene({ simulation, onClearSelection }) {
  const controlsRef = useRef();

  return (
    <Canvas camera={{ position: [6.8, 4.4, 8.2], fov: 42 }}>
      <color attach="background" args={["#050505"]} />
      <fog attach="fog" args={["#050505", 10, 20]} />
      <ambientLight intensity={0.9} />
      <pointLight position={[4, 6, 4]} intensity={45} color="#8ee6ef" />
      <pointLight position={[-4, -3, 6]} intensity={18} color="#d8ab3a" />

      <group onClick={onClearSelection}>
        <BrainEdges weights={simulation.weights} selectedRegion={simulation.selectedRegion} />
        <SignalParticles activities={simulation.activities} selectedRegion={simulation.selectedRegion} />
        {BRAIN_REGIONS.map((region) => (
          <BrainNode
            key={region.code}
            region={region}
            activity={simulation.activities[region.code]}
            spiking={simulation.spikes[region.code]}
            selected={simulation.selectedRegion === region.code}
            onSelect={simulation.selectRegion}
          />
        ))}
      </group>

      <Sparkles count={32} scale={[11, 7, 11]} size={2.2} speed={0.35} />
      <Stars radius={50} depth={30} count={1200} factor={4} fade />
      <OrbitControls ref={controlsRef} enablePan={false} maxDistance={14} minDistance={5} target={[0.5, 0.1, 0]} />
      <FocusController controlsRef={controlsRef} selectedRegion={simulation.selectedRegion} />
    </Canvas>
  );
}

function Checklist({ title, items }) {
  const [checked, setChecked] = useState(() => items.map(() => false));
  return (
    <div className="checklist-card">
      <h3>{title}</h3>
      <ul className="checklist">
        {items.map((item, index) => (
          <li key={item}>
            <button
              type="button"
              className={`checkbox ${checked[index] ? "checked" : ""}`}
              onClick={() => setChecked((previous) => previous.map((value, i) => (i === index ? !value : value)))}
              aria-pressed={checked[index]}
            >
              ✓
            </button>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const { state, controls } = useBrainSimulation();
  const stars = useGitHubStars(SITE.repoUrl);
  const [activeTab, setActiveTab] = useState("twitter");
  const selectedRegionName = state.selectedRegion ? REGION_LONG_NAMES[state.selectedRegion] : "None";

  const toolkit = {
    twitter: {
      label: "Twitter / X thread",
      title: "12-part X thread",
      body: "Lead with the visual. Explain STDP simply. Leave the GitHub link for the last post so the thread can travel before the link suppresses reach.",
      value: VIRAL_CONTENT.twitterThread,
    },
    hn: {
      label: "Hacker News",
      title: VIRAL_CONTENT.hackerNewsTitle,
      body: "Keep the tone direct and technical. Show what you built, what choices were intentional, and what kinds of contributors you want.",
      value: `${VIRAL_CONTENT.hackerNewsTitle}\n\n${VIRAL_CONTENT.hackerNewsBody}`,
    },
    reddit: {
      label: "Reddit",
      title: "Subreddit-specific versions",
      body: "Use one version for r/MachineLearning and another for r/threejs or r/reactjs. Same project. Different angle. Better response.",
      value: `r/MachineLearning\n\n${VIRAL_CONTENT.redditML}\n\n---\n\nr/threejs / r/reactjs\n\n${VIRAL_CONTENT.redditR3F}`,
    },
    launch: {
      label: "Launch day plan",
      title: "Coordinate the first velocity spike",
      body: "Trending depends on stars per day more than total stars. A single coordinated push is more powerful than two weeks of drip posting.",
      value: VIRAL_CONTENT.launchPlan,
    },
  };

  const installCode = `git clone ${SITE.repoUrl}\ncd the-brain\ncd ui/brainsnn-site\nnpm install\nnpm run dev`;
  const extendCode = `// Score any text against the engine\nconst response = await fetch("/api/score", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ text: "Act now or you'll miss this forever." }),\n});\nconst { score, dimensions, templates, receipt } = await response.json();\n\n// dimensions: { urgency, outrage, certainty, fear }\n// templates : [{ id: "fomo", label: "FOMO appeal", hits: 2 }, ...]\n// receipt   : "R-7F2A-9B81"  (deterministic SHA-256, audit-ready)`;
  const active = toolkit[activeTab];

  return (
    <div className="app-shell">
      <header className="nav-shell">
        <div className="shell nav">
          <a href="#top" className="brand" aria-label={`${SITE.name} home`}>
            <span className="brand-mark" aria-hidden="true"><span /></span>
            <span>{SITE.name}</span>
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href="#demo">Demo</a>
            <a href="#why">Why it matters</a>
            <a href="#quick-start">How it works</a>
            <a href="#audience">Who uses it</a>
            <a href="#viral-toolkit">Launch kit</a>
            <a className="button button-primary button-small" href={SITE.repoUrl} target="_blank" rel="noreferrer">Star on GitHub</a>
          </nav>
        </div>
      </header>

      <main>
        <div className="hero-network-shell"><HeroBackground /></div>
        <section className="hero section" id="top">
          <div className="hero-backdrop" aria-hidden="true" />
          <div className="shell hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">{SITE.badge}</div>
              <h1>{SITE.tagline}</h1>
              <p className="hero-text">{SITE.heroLead}</p>
              <div className="hero-actions">
                <a href="#demo" className="button button-primary">Try the live demo</a>
                <a href={SITE.repoUrl} target="_blank" rel="noreferrer" className="button button-secondary">Star on GitHub</a>
              </div>
              <dl className="stats-row" aria-label="Engine stats">
                <div className="stat-card"><dt>GitHub Stars</dt><dd>{stars ?? "—"}</dd></div>
                <div className="stat-card"><dt>Affective Dimensions</dt><dd>4</dd></div>
                <div className="stat-card"><dt>Manipulation Templates</dt><dd>15</dd></div>
                <div className="stat-card"><dt>License</dt><dd>{SITE.license}</dd></div>
              </dl>
            </div>
            <div className="hero-side">
              <div className="hero-panel">
                <div className="hero-panel-header"><span>What the engine does</span></div>
                <ul className="signal-list">
                  <li>Scores any text across <strong>urgency, outrage, false certainty, and fear</strong> with per-rule evidence.</li>
                  <li>Names the manipulation <strong>template</strong> that fired — gaslighting, DARVO, FOMO, scarcity, and more.</li>
                  <li>Renders the response inside a <strong>live 3D brain</strong> — feeling becomes visible, not hidden behind a number.</li>
                  <li>Returns a <strong>deterministic receipt</strong> per scan — auditable trail, no black-box vibes.</li>
                </ul>
                <div className="mini-quote">“{SITE.positioning}”</div>
                <div className="badge-row" style={{ marginTop: 16 }}>
                  <span className="mini-badge">{SOCIAL_PREVIEW_COPY.hook}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="demo">
          <div className="shell">
            <SectionIntro eyebrow="Live demo" title="Watch a brain react to whatever you paste" body="Orbit the brain. Click a region. Trigger a burst. The same engine that animates this scene scores any text you feed it across four affective dimensions — and lights up the regions that absorb the payload." centered />
            <div className="demo-shell">
              <div className="demo-hud top">
                <span className="hud-chip">Tick {state.tick}</span>
                <span className="hud-chip">Mean firing {state.meanFiring.toFixed(3)}</span>
                <span className="hud-chip">Plasticity {state.plasticity.toFixed(3)}</span>
                <span className="hud-chip">Selected {selectedRegionName}</span>
              </div>
              <div className="demo-canvas">
                <BrainScene simulation={{ ...state, selectRegion: controls.selectRegion }} onClearSelection={controls.clearSelection} />
              </div>
              <div className="demo-hud bottom">
                <div className="chart-chip"><span>Activity</span><ActivityMiniChart history={state.history} /></div>
                <div className="demo-actions" role="group" aria-label="Simulation controls">
                  <button type="button" className={`button button-hud ${state.running ? "active" : ""}`} onClick={controls.toggleRunning}>{state.running ? "Pause" : "Resume"}</button>
                  <button type="button" className="button button-hud" onClick={controls.triggerBurst}>Burst</button>
                  <button type="button" className="button button-hud" onClick={controls.reset}>Reset</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="why">
          <div className="shell">
            <SectionIntro eyebrow="Why it matters" title="Four places emotional payload moves the room" body="Engagement is downstream of feeling. Brand, behavior, attention, and public perception all bend around the affective load of a single post — long before anyone reads carefully." />
            <div className="card-grid six-up">
              {WHY_CARDS.map((card) => (
                <article className="info-card" key={card.title}>
                  <span className="card-icon" aria-hidden="true">{card.icon}</span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-surface" id="quick-start">
          <div className="shell">
            <SectionIntro eyebrow="How it works" title="Affective intelligence in four lenses, plus a brain that shows the answer" body="Every input flows through the same pipeline: tokenize, score across four affective dimensions, name the templates that fired, render the response inside the 3D brain, and stamp the result with a deterministic receipt." />
            <div className="two-column">
              <div className="timeline">
                {[
                  ["1. Score the payload", "The Cognitive Firewall walks the text against four rule families — urgency, outrage, false certainty, and fear. Per-rule evidence and language detection (en / es / fr) ride along."],
                  ["2. Name the technique", "15 manipulation templates — gaslighting, DARVO, FOMO, scarcity, false dichotomy, moral outrage bait, and more — surface as chips, each with a copy-ready refutation."],
                  ["3. Render the response", "The 3D brain absorbs the scores: AMY for fear, BG for manipulation pressure, PFC for certainty theater. The visual is the explanation, not a decoration."],
                  ["4. Receipt and share", "Every scan returns a SHA-256 receipt for audit trails plus an OG share card at /r/<hash>. Built for review queues, briefings, and threads."],
                ].map(([title, body], index) => (
                  <article className="timeline-item" key={title}>
                    <div className="timeline-index">{index + 1}</div>
                    <div><h3>{title}</h3><p>{body}</p></div>
                  </article>
                ))}
              </div>
              <div className="stack">
                <CodeBlock label="Clone / run" code={installCode} />
                <CodeBlock label="Score from the public API" code={extendCode} />
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="viral-toolkit">
          <div className="shell">
            <SectionIntro eyebrow="Launch kit" title="Open-source launch copy, ready to ship" body="This is a public launch surface for the engine. The tabs below give you the X thread, Show HN post, subreddit-tuned variants, and the coordinated push plan — copy ready, no rewrites needed." />
            <div className="toolkit-shell">
              <div className="tab-row" role="tablist" aria-label="Launch toolkit tabs">
                {Object.entries(toolkit).map(([id, tab]) => (
                  <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={`tab-button ${activeTab === id ? "active" : ""}`} onClick={() => setActiveTab(id)}>
                    {tab.label}
                  </button>
                ))}
              </div>
              <article className="toolkit-panel">
                <div className="toolkit-head">
                  <div><h3>{active.title}</h3><p>{active.body}</p></div>
                  <CopyButton value={active.value} />
                </div>
                <textarea className="toolkit-textarea" value={active.value} readOnly aria-label={`${active.title} copy`} />
              </article>
            </div>
          </div>
        </section>

        <section className="section section-surface" id="readme">
          <div className="shell">
            <SectionIntro eyebrow="README preview" title="A repo front page that explains what the engine actually does" body="The landing page makes the engine legible. The README closes the loop — what it scores, who it's for, and how to plug it into a pipeline." />
            <div className="readme-shell">
              <div className="readme-preview-card">
                <div className="readme-toolbar">
                  <div className="dot-row" aria-hidden="true"><span /><span /><span /></div>
                  <CopyButton value={README_MD} />
                </div>
                <div className="readme-preview-body">
                  <h3>🧠 BrainSNN</h3>
                  <div className="badge-row">
                    <span className="mini-badge">MIT</span>
                    <span className="mini-badge">Affective intelligence</span>
                    <span className="mini-badge">Browser-first</span>
                    <span className="mini-badge">Auditable</span>
                  </div>
                  <p>An affective-intelligence engine that detects the emotional payload inside online content — text, screenshots, threads — before it shapes attention, behavior, brand risk, or public perception.</p>
                  <div className="media-placeholder"><img src="/demo-placeholder.svg" alt="Placeholder for BrainSNN animated GIF or video poster frame" /></div>
                  <table className="feature-table">
                    <thead><tr><th>Layer</th><th>What it does</th></tr></thead>
                    <tbody>
                      <tr><td>Cognitive Firewall</td><td>Scores text across 4 affective dimensions with per-rule evidence</td></tr>
                      <tr><td>Templates</td><td>Names the technique that fired (gaslighting, DARVO, FOMO, …)</td></tr>
                      <tr><td>3D brain feedback</td><td>Live R3F scene reacts as regions absorb the affective payload</td></tr>
                      <tr><td>Public scoring API</td><td>POST /api/score and SSE streaming for review pipelines</td></tr>
                      <tr><td>Receipts</td><td>Deterministic SHA-256 stamp per scan for audit trails</td></tr>
                    </tbody>
                  </table>
                  <pre className="code-block"><code>{installCode}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="gallery">
          <div className="shell">
            <SectionIntro eyebrow="What a scan looks like" title="Three ways the engine surfaces an emotional payload" body="A single scan returns a four-dimensional pressure score, named templates, evidence words, and a brain frame. Bulk runs return trajectories — cooling, escalating, hostile — labeled in one glance." />
            <div className="gallery-grid">
              {GALLERY_ITEMS.map((item) => (
                <article className="gallery-card" key={item.title}>
                  <div className="gallery-thumb"><img src={item.image || "/demo-placeholder.svg"} alt={`${item.title} — example BrainSNN scan`} /></div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="audience">
          <div className="shell">
            <SectionIntro eyebrow="Who uses it" title="Built for the teams that read at speed" body="The same scoring engine fits a brand-safety review, a press-cycle audit, a moderation queue, and a security inbox. The interface — 3D brain, share card, or API call — changes per audience." />
            <div className="card-grid six-up">
              {COMMUNITY_CHANNELS.map((channel) => (
                <article className="info-card" key={channel.title}>
                  <span className="card-icon" aria-hidden="true">{channel.emoji}</span>
                  <h3>{channel.title}</h3>
                  <p>{channel.body}</p>
                  <a href={channel.href} target={channel.href.startsWith("#") ? undefined : "_blank"} rel={channel.href.startsWith("#") ? undefined : "noreferrer"} className="inline-link">{channel.cta}</a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-surface" id="launch-checklist">
          <div className="shell">
            <SectionIntro eyebrow="Launch checklist" title="Compound the attention into stars, signups, and contributors" body="The hero earns the click. This checklist turns the click into a star, a fork, an issue, or an inbound request — across the first 72 hours of public attention." />
            <div className="two-column">
              <Checklist title="Before launch" items={PRE_LAUNCH_CHECKLIST} />
              <Checklist title="Launch day" items={LAUNCH_DAY_CHECKLIST} />
            </div>
            <div className="velocity-note"><strong>Star velocity matters.</strong> GitHub Trending reacts to recent stars per day more than lifetime totals. The point of this page is to compress interest into one concentrated window.</div>
            <div className="readme-preview-card" style={{ marginTop: 24 }}>
              <div className="toolkit-head">
                <div>
                  <h3>Good first issue ideas</h3>
                  <p>Seed contributor activity before launch so the repo feels open to contribution the moment people land on it.</p>
                </div>
                <CopyButton value={GOOD_FIRST_ISSUES.map((item, index) => `${index + 1}. ${item}`).join("\n")} />
              </div>
              <ul className="checklist">
                {GOOD_FIRST_ISSUES.slice(0, 5).map((item) => (
                  <li key={item}><span style={{ marginLeft: 8 }}>{item}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="shell footer-inner">
          <div>
            <strong>{SITE.name}</strong>
            <p>{SITE.positioning}</p>
          </div>
          <div className="footer-links">
            <a href={SITE.repoUrl} target="_blank" rel="noreferrer">GitHub</a>
            <a href={SITE.demoUrl} target="_blank" rel="noreferrer">Live demo</a>
            <a href="#audience">Who uses it</a>
            <a href="#viral-toolkit">Launch kit</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
