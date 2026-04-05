export const SITE = {
  name: "BrainSNN",
  repoUrl: "https://github.com/slavazeph-coder/the-brain",
  demoUrl: "https://slavazeph-coder.github.io/the-brain/",
  issuesUrl: "https://github.com/slavazeph-coder/the-brain/issues",
  license: "MIT",
  repoOwner: "slavazeph-coder",
  repoName: "the-brain",
  tagline: "Brain-Inspired AI That Never Stops Learning",
  badge: "Open Source · MIT License · React Three Fiber",
};

export const REGION_LONG_NAMES = {
  CTX: "Cortex",
  HPC: "Hippocampus",
  THL: "Thalamus",
  AMY: "Amygdala",
  BG: "Basal Ganglia",
  PFC: "Prefrontal Cortex",
  CBL: "Cerebellum",
};

export const THEME = {
  background: "#0a0a09",
  surface: "#141211",
  surfaceAlt: "#1a1715",
  text: "#f1ece5",
  muted: "#a49d95",
  teal: "#5fb7c1",
  cyan: "#77dbe4",
  gold: "#d8ab3a",
  red: "#d86e78",
};

export const BRAIN_REGIONS = [
  {
    code: "THL",
    name: REGION_LONG_NAMES.THL,
    position: [0, 0.1, 0],
    color: "#71b949",
    baseActivity: 0.56,
    description: "Sensory relay driving cortical input.",
  },
  {
    code: "CTX",
    name: REGION_LONG_NAMES.CTX,
    position: [2.45, 0.65, -0.15],
    color: "#5fb7c1",
    baseActivity: 0.26,
    description: "Primary cortical workspace for integration.",
  },
  {
    code: "HPC",
    name: REGION_LONG_NAMES.HPC,
    position: [1.25, -1.6, 1.35],
    color: "#d8ab3a",
    baseActivity: 0.18,
    description: "Memory replay loop with cortex.",
  },
  {
    code: "PFC",
    name: REGION_LONG_NAMES.PFC,
    position: [3.45, 1.9, 0.75],
    color: "#a78ce5",
    baseActivity: 0.2,
    description: "Executive planning and top-down control.",
  },
  {
    code: "AMY",
    name: REGION_LONG_NAMES.AMY,
    position: [1.85, -0.95, -2.15],
    color: "#d86e78",
    baseActivity: 0.13,
    description: "Emotion-linked salience and alerting.",
  },
  {
    code: "BG",
    name: REGION_LONG_NAMES.BG,
    position: [-1.9, -0.55, -1.25],
    color: "#5b92cf",
    baseActivity: 0.14,
    description: "Inhibitory gating of thalamic output.",
  },
  {
    code: "CBL",
    name: REGION_LONG_NAMES.CBL,
    position: [-3.1, 1.2, 1.6],
    color: "#c69f31",
    baseActivity: 0.17,
    description: "Coordination, timing, and adaptive smoothing.",
  },
];

export const PATHWAYS = [
  {
    id: "THL-CTX",
    from: "THL",
    to: "CTX",
    initialWeight: 0.63,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.25, 1.45, 0.2],
    label: "sensory relay",
  },
  {
    id: "CTX-HPC",
    from: "CTX",
    to: "HPC",
    initialWeight: 0.46,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.45, 0.15, 0.55],
    label: "memory write",
  },
  {
    id: "HPC-CTX",
    from: "HPC",
    to: "CTX",
    initialWeight: 0.42,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.1, -0.25, -0.2],
    label: "memory replay",
  },
  {
    id: "CTX-PFC",
    from: "CTX",
    to: "PFC",
    initialWeight: 0.49,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.35, 0.65, 0.35],
    label: "planning feedforward",
  },
  {
    id: "PFC-CTX",
    from: "PFC",
    to: "CTX",
    initialWeight: 0.34,
    plastic: true,
    inhibitory: false,
    curveOffset: [-0.2, 0.25, -0.35],
    label: "top-down control",
  },
  {
    id: "CTX-AMY",
    from: "CTX",
    to: "AMY",
    initialWeight: 0.31,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.4, -0.2, -0.7],
    label: "salience routing",
  },
  {
    id: "AMY-BG",
    from: "AMY",
    to: "BG",
    initialWeight: 0.34,
    plastic: true,
    inhibitory: false,
    curveOffset: [-0.35, -0.05, 0.1],
    label: "affect-driven gating",
  },
  {
    id: "BG-THL",
    from: "BG",
    to: "THL",
    initialWeight: 0.26,
    plastic: true,
    inhibitory: true,
    curveOffset: [-0.25, 0.15, -0.2],
    label: "inhibitory gate",
  },
  {
    id: "CBL-CTX",
    from: "CBL",
    to: "CTX",
    initialWeight: 0.29,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.15, -0.35, -0.3],
    label: "timing correction",
  },
  {
    id: "PFC-HPC",
    from: "PFC",
    to: "HPC",
    initialWeight: 0.32,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.55, 0.05, 0.55],
    label: "working memory cue",
  },
];

export const WHY_CARDS = [
  {
    title: "STDP continuous learning",
    icon: "⚡",
    body:
      "Synapses change from spike timing itself. Pre before post strengthens. Post before pre weakens. You can see the rule move the network live.",
  },
  {
    title: "No backprop required",
    icon: "∇",
    body:
      "No loss function. No training epochs. No offline retraining loop. The brain graph adapts in-place as signals move through it.",
  },
  {
    title: "React Three Fiber architecture",
    icon: "🧩",
    body:
      "Brain regions, edges, particles, overlays, and controls are all modular React components. Easy to fork. Easy to extend.",
  },
  {
    title: "Biologically inspired structure",
    icon: "🧠",
    body:
      "Thalamus relays input. Basal Ganglia gates the relay. Hippocampus and cortex replay memory together. The topology is grounded, not decorative.",
  },
  {
    title: "Browser-first demo",
    icon: "🌐",
    body:
      "The default demo does not need a server to prove the core idea. It loads fast, shares easily, and gives people something they can orbit immediately.",
  },
  {
    title: "Modular extensibility",
    icon: "🔧",
    body:
      "Add regions, swap pathways, wire in EEG streams, or replace the simplified simulation with a more rigorous model without rewriting the UI shell.",
  },
];

export const COMMUNITY_CHANNELS = [
  {
    title: "Hacker News",
    emoji: "🟠",
    body:
      "Strongest technical discovery engine for independent open-source launches. A solid Show HN can create the first real wave of stars and contributors.",
    href: "https://news.ycombinator.com/submit",
    cta: "Submit Show HN",
  },
  {
    title: "Open neuromorphic communities",
    emoji: "🧠",
    body:
      "Your highest-fit audience. This is where the builders who already care about SNNs, Loihi, SpiNNaker, and computational neuroscience will actually engage.",
    href: "https://github.com/open-neuromorphic/open-neuromorphic",
    cta: "Reach the niche",
  },
  {
    title: "Reddit",
    emoji: "👀",
    body:
      "Use r/MachineLearning for the learning rule and r/threejs / r/reactjs for the rendering build. Tailor the post to each audience instead of cross-posting identical copy.",
    href: "https://reddit.com/r/MachineLearning",
    cta: "Open Reddit",
  },
  {
    title: "GitHub Trending",
    emoji: "⭐",
    body:
      "Trending is driven by recent star velocity, not lifetime stars. Your launch page exists to compress demand into one coordinated push window.",
    href: "https://github.com/trending/javascript",
    cta: "Study Trending",
  },
  {
    title: "Product Hunt",
    emoji: "🚀",
    body:
      "Not the first channel, but useful once the visuals and repo look polished. Great for a second-wave discovery event after GitHub and X start moving.",
    href: "https://www.producthunt.com/",
    cta: "Plan Product Hunt",
  },
  {
    title: "Dev.to / Hashnode",
    emoji: "✍️",
    body:
      "A technical write-up compounds. It catches people after launch day and gives you a durable link to share whenever someone asks how it works.",
    href: "https://dev.to/",
    cta: "Write the deep dive",
  },
];

export const GALLERY_ITEMS = [
  {
    title: "Burst mode frame",
    body: "A thalamic spike wave pushing plasticity through the graph.",
  },
  {
    title: "Selected-region focus",
    body: "Camera punched in on HPC ↔ CTX replay dynamics.",
  },
  {
    title: "Weight heat state",
    body: "Edge width and glow after a few minutes of continuous learning.",
  },
];

export const PRE_LAUNCH_CHECKLIST = [
  "Polish the README with a real GIF or MP4 poster frame from burst mode.",
  "Set the GitHub social preview image before launch.",
  "Seed 5–10 good first issues so contributors know where to start.",
  "Deploy the static demo to Vercel or GitHub Pages.",
  "Prepare one short screen recording for X and one square crop for socials.",
  "Test the repo clone flow on a fresh machine.",
  "Line up 20–30 developers or researchers to star and share on launch day.",
];

export const LAUNCH_DAY_CHECKLIST = [
  "Post Show HN early and link to the repo, not the landing page.",
  "Post the X thread with the GitHub link only at the end.",
  "Reply fast for the first 2 hours on every channel.",
  "Drop the project into niche neuromorphic communities after the main posts go live.",
  "Watch star velocity, not just vanity metrics.",
  "Update the README with fresh GIFs or screenshots if people ask similar questions.",
  "Turn notable feedback into issues before the traffic wave cools off.",
];

export const GOOD_FIRST_ISSUES = [
  "Add long-form tooltips for each region with keyboard and touch support.",
  "Create a screenshot export button for the live 3D scene.",
  "Improve the mini activity chart with per-region toggles.",
  "Add a WebGPU simulation mode behind a feature flag.",
  "Write unit tests for the simplified STDP update rule.",
  "Add reduced-motion support for people who prefer less animation.",
  "Create alternate topology presets for memory replay and gating.",
  "Improve mobile camera controls and gesture affordances.",
  "Add a proper benchmark panel for pathway weights and firing activity.",
  "Replace placeholder media with an automated demo capture workflow.",
];

export const SOCIAL_PREVIEW_COPY = {
  hook: "I built a 3D brain network that learns continuously in the browser.",
  sub:
    "7 brain regions. 10 plastic pathways. Live STDP updates. No backprop. No retraining.",
  cta: "Star the repo, fork it, and break it.",
};

export const VIRAL_CONTENT = {
  twitterThread: `1/12
I built a 3D brain network that keeps learning while you watch.

No backprop.
No retraining.
No server.

Just 7 brain regions, 10 plastic pathways, and STDP changing synapses in real time.

2/12
Most neural-network demos show a frozen architecture or a prerecorded animation.
I wanted a browser demo that feels alive — something you can orbit, click, and stress with a thalamic burst.

3/12
BrainSNN models:
CTX = Cortex
HPC = Hippocampus
THL = Thalamus
AMY = Amygdala
BG = Basal Ganglia
PFC = Prefrontal Cortex
CBL = Cerebellum

4/12
The structure is not random:
THL relays sensory input.
BG inhibits / gates thalamic output.
HPC ↔ CTX models memory replay.
PFC shapes control signals.
CBL smooths timing back into cortex.

5/12
The learning rule is STDP:
pre fires before post → synapse strengthens
post fires before pre → synapse weakens

Local updates only.
No gradients.
No retraining loop.

6/12
I built the scene with React Three Fiber + Drei + Three.js.

Each region is a component.
Each edge has weight-driven width and opacity.
Particles move across pathways based on source activity.

7/12
You can pause, burst, reset, click a region, and focus the camera.

So instead of staring at a static diagram, you can actually inspect how the graph behaves under load.

8/12
The default demo is browser-first.
That matters for open source.

The easier it is to open and understand, the easier it is to star, share, and fork.

9/12
Why I think this matters:
brain-inspired systems are still underexplored in frontend developer culture.
Most people never get a tactile mental model for STDP or gating loops.

10/12
This project is intentionally hackable:
add a region
add a pathway
swap the update rule
wire in EEG
replace the simplified simulator

11/12
If you build with:
- ML / computational neuroscience
- React Three Fiber / Three.js
- interactive data viz
- open-source dev tools

this repo should be interesting.

12/12
BrainSNN:
open-source 3D neuromorphic visualizer
MIT licensed
designed to be forked

Repo: ${SITE.repoUrl}
Demo: ${SITE.demoUrl}

If this is interesting, drop a star and share it.`,
  hackerNewsTitle:
    "Show HN: BrainSNN — a 3D neuromorphic brain visualizer with live STDP learning",
  hackerNewsBody: `Hey HN,

I built BrainSNN, a browser-based 3D visualization of a spiking-style brain graph that updates synaptic weights continuously using a simplified STDP rule.

The thing I wanted to make was not “a neural net explainer page,” but something you could actually orbit and poke at while the graph changes in front of you.

Current version:
- 7 brain regions
- 10 plastic pathways
- Thalamus as sensory relay
- Basal Ganglia gating thalamic output
- Hippocampus ↔ Cortex replay loop
- Live weight updates, edge particles, click-to-focus, pause / burst / reset

The rendering layer is React Three Fiber + Drei + Three.js.
The simulation is intentionally lightweight so the demo can stay browser-first.

A few goals:
- make STDP legible to people who know the term but have never watched it
- make the repo attractive to frontend / graphics builders as well as ML / neuroscience people
- keep the architecture modular enough that someone could swap in a more serious simulator later

Repo: ${SITE.repoUrl}

Happy to answer questions about the topology choices, the simplified learning rule, or how the scene is structured.`,
  redditML: `[P] BrainSNN: open-source 3D neuromorphic network visualizer with live STDP updates

I built a browser-first demo of a simplified spiking / neuromorphic graph with 7 brain regions and 10 plastic pathways. It visualizes STDP-like updates in real time instead of using an offline training step.

Topology includes:
- THL as sensory relay
- BG inhibiting / gating THL
- HPC ↔ CTX replay loop
- PFC and CBL feedback into cortical dynamics

The frontend is React Three Fiber + Drei + Three.js. The simulator is intentionally lightweight so people can fork and extend it easily.

Repo: ${SITE.repoUrl}
Demo: ${SITE.demoUrl}

Would love feedback on the biological framing and on how to turn this into a more rigorous benchmark.`,
  redditR3F: `Built a premium open-source landing page + live 3D brain network in React Three Fiber

Each region is a reusable component.
Edges animate weight with width + opacity.
Particles move along 10 pathways.
Clicking a node focuses the camera.
There is a lightweight STDP-style simulation driving the scene.

I wanted it to feel more like a cinematic lab demo than a SaaS homepage.

Repo: ${SITE.repoUrl}
Demo: ${SITE.demoUrl}`,
  launchPlan: `Pre-launch:
- polish GIF / screenshots
- set social preview image
- seed good first issues
- deploy the demo
- line up your first 20–30 stars

Launch day:
- Show HN first
- X thread next
- niche community drop after that
- reply fast for 2 hours
- track star velocity, not just totals`,
};

export const README_MD = `# 🧠 BrainSNN

![MIT License](https://img.shields.io/badge/license-MIT-green)
![React Three Fiber](https://img.shields.io/badge/React%20Three%20Fiber-R3F-black)
![Three.js](https://img.shields.io/badge/Three.js-3D-informational)

**Brain-inspired AI that never stops learning.**

BrainSNN is an open-source 3D neuromorphic brain network visualizer built with React Three Fiber. It models **7 brain regions**, **10 plastic pathways**, and a simplified **STDP continuous learning rule** in real time.

No backprop.  
No retraining.  
No server required for the main demo.  

## Why this project exists

Most neural network demos are static. BrainSNN is built to feel alive.

- **THL** acts as a sensory relay
- **BG** inhibits and gates thalamic output
- **HPC ↔ CTX** models memory replay
- **STDP** updates pathway weights locally from spike timing

This project is designed for:
- developers who love React Three Fiber and Three.js
- ML and computational neuroscience people
- open-source contributors who want a visually compelling repo to fork

## Live demo

- Repo: ${SITE.repoUrl}
- Demo: ${SITE.demoUrl}

> Replace \`${SITE.demoUrl}\` in \`src/constants/site.js\` once you deploy.

## Features

| Feature | Detail |
| --- | --- |
| 3D brain scene | 7 labeled regions arranged in a brain-like spatial layout |
| Plastic pathways | 10 animated connections with weight-driven width and opacity |
| STDP-like updates | Simplified continuous plasticity rule based on local spike timing |
| Interactive controls | Pause, burst, reset, click-to-focus camera |
| Browser-first | No backend required for the core experience |
| Modular code | Easy to add regions, pathways, new content, and launch assets |

## Quick start

\`\`\`bash
git clone ${SITE.repoUrl}
cd the-brain
cd ui/brainsnn-site
npm install
npm run dev
\`\`\`

Build for production:

\`\`\`bash
npm run build
npm run preview
\`\`\`

## Add a new brain region

1. Add the region to \`BRAIN_REGIONS\` in \`src/constants/site.js\`
2. Give it a position, color, and baseline activity
3. Add new pathways to \`PATHWAYS\`
4. Update the copy if the region changes the biological story

Example:

\`\`\`js
{
  code: "OFC",
  name: "Orbitofrontal Cortex",
  position: [2.6, 2.2, 1.1],
  color: "#f59e0b",
  baseActivity: 0.18,
  description: "Reward and valuation signals."
}
\`\`\`

## License

MIT
`;
