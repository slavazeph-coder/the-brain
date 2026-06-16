import {
  Html,
  Line,
  OrbitControls,
  Sparkles,
  Sphere,
  Stars,
  Text,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  BRAIN_REGIONS,
  IMPACT_SIGNALS,
  PATHWAYS,
  PILOT_CHECKLIST,
  PRODUCT_WORKFLOW,
  REGION_LONG_NAMES,
  ROADMAP_CARDS,
  SITE,
  SOCIAL_PREVIEW_COPY,
  TRUST_CARDS,
  USE_CASES,
  YOUR_STACK,
} from "./constants/site";
import { useBrainSimulation } from "./hooks/useBrainSimulation";
import { getQuadraticPoint, pathwayCenter } from "./lib/brainMath";
import { parseGitHubRepo } from "./lib/copy";

const regionMap = Object.fromEntries(
  BRAIN_REGIONS.map((region) => [region.code, region]),
);

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
    <svg
      className="mini-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Recent mean firing history"
    >
      <path d={path} />
    </svg>
  );
}

function HeroBackground() {
  return (
    <svg
      className="hero-network"
      viewBox="0 0 1600 900"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
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
      {[
        [180, 180],
        [340, 500],
        [520, 220],
        [720, 180],
        [700, 560],
        [980, 520],
        [1260, 180],
        [1240, 340],
        [1430, 480],
      ].map(([cx, cy], index) => (
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
        <meshBasicMaterial
          color={selected ? "#f1ece5" : region.color}
          transparent
          opacity={selected ? 0.92 : 0.46}
        />
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

      <Text
        position={[0, 0, scale + 0.4]}
        fontSize={0.28}
        color="#f1ece5"
        anchorX="center"
        anchorY="middle"
      >
        {region.code}
      </Text>

      {(hovered || selected) && (
        <Html
          center
          position={[0, scale + 0.7, 0]}
          className="node-tooltip-wrap"
          distanceFactor={8}
        >
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
        const control = pathwayCenter(
          start.toArray(),
          end.toArray(),
          pathway.curveOffset,
        );
        const weight = weights[pathway.id] ?? pathway.initialWeight;
        const isSelected =
          selectedRegion &&
          (selectedRegion === pathway.from || selectedRegion === pathway.to);
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
    const control = pathwayCenter(
      start.toArray(),
      end.toArray(),
      pathway.curveOffset,
    );
    return { start, control, end };
  }, [pathway]);

  useFrame(() => {
    const sourceActivity = activities[pathway.from] ?? 0.2;
    travel.current += 0.004 + sourceActivity * 0.018;
    if (travel.current > 1) travel.current = 0;
    const point = getQuadraticPoint(
      vectors.start,
      vectors.control,
      vectors.end,
      travel.current,
    );
    if (meshRef.current) meshRef.current.position.copy(point);
  });

  const active =
    !selectedRegion ||
    selectedRegion === pathway.from ||
    selectedRegion === pathway.to;

  return (
    <mesh ref={meshRef} visible={active}>
      <sphereGeometry args={[0.06, 18, 18]} />
      <meshBasicMaterial
        color={pathway.inhibitory ? "#d86e78" : "#efe9e1"}
        transparent
        opacity={0.8}
      />
    </mesh>
  );
}

function SignalParticles({ activities, selectedRegion }) {
  return (
    <group>
      {PATHWAYS.flatMap((pathway) => [
        <Particle
          key={`${pathway.id}-a`}
          pathway={pathway}
          activities={activities}
          selectedRegion={selectedRegion}
        />,
        <Particle
          key={`${pathway.id}-b`}
          pathway={pathway}
          activities={activities}
          selectedRegion={selectedRegion}
        />,
      ])}
    </group>
  );
}

function FocusController({ controlsRef, selectedRegion }) {
  const { camera } = useThree();
  const defaultCamera = useMemo(
    () => ({
      position: new THREE.Vector3(6.8, 4.4, 8.2),
      target: new THREE.Vector3(0.5, 0.1, 0),
    }),
    [],
  );

  useFrame(() => {
    const selected = selectedRegion ? regionMap[selectedRegion] : null;
    const desiredTarget = selected
      ? new THREE.Vector3(...selected.position)
      : defaultCamera.target;
    const desiredPosition = selected
      ? new THREE.Vector3(
          selected.position[0] + 2.2,
          selected.position[1] + 1.8,
          selected.position[2] + 2.8,
        )
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
        <BrainEdges
          weights={simulation.weights}
          selectedRegion={simulation.selectedRegion}
        />
        <SignalParticles
          activities={simulation.activities}
          selectedRegion={simulation.selectedRegion}
        />
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
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        maxDistance={14}
        minDistance={5}
        target={[0.5, 0.1, 0]}
      />
      <FocusController
        controlsRef={controlsRef}
        selectedRegion={simulation.selectedRegion}
      />
    </Canvas>
  );
}

function SignalCard({ label, value, detail }) {
  return (
    <div className="stat-card">
      <dt>{label}</dt>
      <dd>{value}</dd>
      <p
        style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: ".88rem" }}
      >
        {detail}
      </p>
    </div>
  );
}

function WorkflowSteps() {
  return (
    <div className="timeline">
      {PRODUCT_WORKFLOW.map(([title, body], index) => (
        <article className="timeline-item" key={title}>
          <div className="timeline-index">{index + 1}</div>
          <div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function PilotCard() {
  return (
    <div className="checklist-card">
      <h3>Pilot offer</h3>
      <p className="hero-text" style={{ marginBottom: 18 }}>
        For brands, agencies, creators, and communications teams that want to
        test content before it shapes attention in the wrong direction.
      </p>
      <ul className="checklist">
        {PILOT_CHECKLIST.map((item) => (
          <li key={item}>
            <span className="checkbox checked" aria-hidden="true">
              ✓
            </span>
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
  const selectedRegionName = state.selectedRegion
    ? REGION_LONG_NAMES[state.selectedRegion]
    : "None";

  return (
    <div className="app-shell">
      <header className="nav-shell">
        <div className="shell nav">
          <a href="#top" className="brand" aria-label={`${SITE.name} home`}>
            <span className="brand-mark" aria-hidden="true">
              <span />
            </span>
            <span>{SITE.name}</span>
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href="#stack">Your stack</a>
            <a href="#product">Product</a>
            <a href="#demo">Demo</a>
            <a href="#use-cases">Use cases</a>
            <a href="#pilot">Pilot</a>
            <a
              className="button button-primary button-small"
              href={SITE.demoUrl}
              target="_blank"
              rel="noreferrer"
            >
              Run your brain
            </a>
          </nav>
        </div>
      </header>

      <main>
        <div className="hero-network-shell">
          <HeroBackground />
        </div>
        <section className="hero section" id="top">
          <div className="hero-backdrop" aria-hidden="true" />
          <div className="shell hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">{SITE.badge}</div>
              <h1>{SITE.tagline}</h1>
              <p className="hero-text">{SITE.mission}</p>
              <div className="hero-actions">
                <a
                  href={SITE.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="button button-primary"
                >
                  Run your brain
                </a>
                <a href="#demo" className="button button-secondary">
                  Try the scanner
                </a>
                <a
                  href={SITE.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="button button-secondary"
                >
                  GitHub
                </a>
              </div>
              <dl className="stats-row" aria-label="Product signals">
                <SignalCard
                  label="Compute"
                  value="Yours"
                  detail="Runs client-side. No account, no API key, no server for the core."
                />
                <SignalCard
                  label="Agents"
                  value="MCP"
                  detail="14 tools bridged so Claude/Codex can read and steer the brain."
                />
                <SignalCard
                  label="Layers"
                  value="100"
                  detail="Firewall, decoder, knowledge brain, dream mode, and more."
                />
                <SignalCard
                  label="Repo"
                  value={stars ?? "—"}
                  detail="Open-source foundation with a product-grade surface."
                />
              </dl>
            </div>
            <div className="hero-side">
              <div className="hero-panel">
                <div className="hero-panel-header">
                  <span>What BrainSNN detects</span>
                </div>
                <ul className="signal-list">
                  {IMPACT_SIGNALS.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
                <div className="mini-quote">“{SOCIAL_PREVIEW_COPY.hook}”</div>
                <div className="badge-row" style={{ marginTop: 16 }}>
                  <span className="mini-badge">Brand safety</span>
                  <span className="mini-badge">Persuasion patterns</span>
                  <span className="mini-badge">Public perception</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="stack">
          <div className="shell">
            <SectionIntro
              eyebrow="Your stack"
              title="Everyone will own a cloud. This is what runs on yours."
              body="No account, no API key, no vendor between you and your own cognition. BrainSNN is the personal compute layer — wired straight into the agents you already use."
            />
            <div className="card-grid six-up">
              {YOUR_STACK.map((card) => (
                <article className="info-card" key={card.title}>
                  <span className="card-icon" aria-hidden="true">
                    {card.icon}
                  </span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="product">
          <div className="shell">
            <SectionIntro
              eyebrow="Proof of power"
              title="The manipulation scanner is the demo. Owning your cognition is the point."
              body="BrainSNN turns invisible emotional pressure into a readable product layer: payload, evidence, risk, behavior pressure, and safer rewrite direction — all computed on hardware you control."
            />
            <div className="card-grid six-up">
              {TRUST_CARDS.map((card) => (
                <article className="info-card" key={card.title}>
                  <span className="card-icon" aria-hidden="true">
                    {card.icon}
                  </span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-surface" id="demo">
          <div className="shell">
            <SectionIntro
              eyebrow="Live intelligence layer"
              title="A brain-like interface, running where your data already lives."
              body="Orbit the model, trigger a burst, and watch the affective system stay alive — the same browser-native engine that powers the full 100-layer brain."
              centered
            />
            <div className="demo-shell">
              <div className="demo-hud top">
                <span className="hud-chip">Tick {state.tick}</span>
                <span className="hud-chip">
                  Mean firing {state.meanFiring.toFixed(3)}
                </span>
                <span className="hud-chip">
                  Plasticity {state.plasticity.toFixed(3)}
                </span>
                <span className="hud-chip">Selected {selectedRegionName}</span>
              </div>
              <div className="demo-canvas">
                <BrainScene
                  simulation={{ ...state, selectRegion: controls.selectRegion }}
                  onClearSelection={controls.clearSelection}
                />
              </div>
              <div className="demo-hud bottom">
                <div className="chart-chip">
                  <span>Signal</span>
                  <ActivityMiniChart history={state.history} />
                </div>
                <div
                  className="demo-actions"
                  role="group"
                  aria-label="Simulation controls"
                >
                  <button
                    type="button"
                    className={`button button-hud ${state.running ? "active" : ""}`}
                    onClick={controls.toggleRunning}
                  >
                    {state.running ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    className="button button-hud"
                    onClick={controls.triggerBurst}
                  >
                    Trigger affect burst
                  </button>
                  <button
                    type="button"
                    className="button button-hud"
                    onClick={controls.reset}
                  >
                    Reset
                  </button>
                  <a
                    className="button button-primary"
                    href={SITE.demoUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open scanner
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="workflow">
          <div className="shell">
            <SectionIntro
              eyebrow="Workflow"
              title="From raw content to risk-aware rewrite."
              body="The first wedge stays simple enough to sell: paste content, decode the payload, show the evidence, and give teams a safer way to publish."
            />
            <div className="two-column">
              <WorkflowSteps />
              <div className="readme-preview-card">
                <div className="toolkit-head">
                  <div>
                    <h3>Example output</h3>
                    <p>
                      Designed to become a saved report, share card, or approval
                      artifact.
                    </p>
                  </div>
                </div>
                <table className="feature-table">
                  <tbody>
                    <tr>
                      <td>Primary affect</td>
                      <td>Threat + urgency</td>
                    </tr>
                    <tr>
                      <td>Behavior pressure</td>
                      <td>Share before verifying</td>
                    </tr>
                    <tr>
                      <td>Trust risk</td>
                      <td>Authority claim with missing context</td>
                    </tr>
                    <tr>
                      <td>Rewrite direction</td>
                      <td>
                        Lower certainty, add source, preserve useful warning
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="velocity-note">
                  <strong>Investor-ready category:</strong> emotional payload
                  intelligence for the AI-generated internet.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-surface" id="use-cases">
          <div className="shell">
            <SectionIntro
              eyebrow="Use cases"
              title="Built for teams that cannot afford emotional misfires."
              body="The same engine can serve creators, agencies, brand teams, compliance workflows, and public-perception monitoring without changing the core product promise."
            />
            <div className="card-grid six-up">
              {USE_CASES.map((card) => (
                <article className="info-card" key={card.title}>
                  <span className="card-icon" aria-hidden="true">
                    {card.icon}
                  </span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="pilot">
          <div className="shell">
            <SectionIntro
              eyebrow="Pilot path"
              title="Turn the demo into paid validation."
              body="The homepage now points toward a fundable wedge: a focused pilot for people who publish, approve, or monitor emotionally loaded content."
            />
            <div className="two-column">
              <PilotCard />
              <div className="stack">
                {ROADMAP_CARDS.map((item) => (
                  <article className="gallery-card" key={item.title}>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </article>
                ))}
                <div className="hero-actions" style={{ marginTop: 4 }}>
                  <a
                    href={SITE.demoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="button button-primary"
                  >
                    Try working demo
                  </a>
                  <a
                    href={`mailto:hello@brainsnn.com?subject=BrainSNN pilot`}
                    className="button button-secondary"
                  >
                    Request pilot
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="shell footer-inner">
          <div>
            <strong>{SITE.name}</strong>
            <p>{SITE.mission}</p>
          </div>
          <div className="footer-links">
            <a href={SITE.domainUrl} target="_blank" rel="noreferrer">
              brainsnn.com
            </a>
            <a href={SITE.demoUrl} target="_blank" rel="noreferrer">
              Demo
            </a>
            <a href={SITE.repoUrl} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="mailto:hello@brainsnn.com?subject=BrainSNN pilot">Pilot</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
