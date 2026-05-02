export const SITE = {
  name: "BrainSNN",
  repoUrl: "https://github.com/slavazeph-coder/the-brain",
  demoUrl: "https://brainsnn.com",
  issuesUrl: "https://github.com/slavazeph-coder/the-brain/issues",
  license: "MIT",
  repoOwner: "slavazeph-coder",
  repoName: "the-brain",
  positioning:
    "An affective-intelligence engine that detects the emotional payload inside online content before it shapes attention, behavior, brand risk, or public perception.",
  tagline: "See the emotional payload of any post — before it moves the room.",
  badge: "Affective-Intelligence Engine · Open Source · MIT",
  heroLead:
    "BrainSNN scores any text, screenshot, or thread for manipulation pressure across four affective dimensions, then renders the response inside a live 3D brain. Read the feeling a piece of content installs — fear, certainty, urgency, outrage — and see it before it travels.",
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
    title: "Attention",
    icon: "👁",
    body:
      "Engagement is downstream of feeling. Surface the urgency, awe, or fear a piece of content is engineered to install — before it earns its first thousand impressions.",
  },
  {
    title: "Behavior",
    icon: "⇢",
    body:
      "Manipulation pressure tells you whether a message is asking for a thoughtful read or a reflex. See the push before the click, the share, or the reply.",
  },
  {
    title: "Brand risk",
    icon: "◈",
    body:
      "Score every inbound mention, ad creative, or AI-generated draft for outrage, gaslighting, and false certainty. Catch the line your brand should not stand next to.",
  },
  {
    title: "Public perception",
    icon: "◐",
    body:
      "Run a thread, an inbox, or a press cycle through the engine and watch the affective trajectory. Cooling, escalating, hostile — labeled, plotted, and shareable.",
  },
  {
    title: "Auditable scoring",
    icon: "✓",
    body:
      "Every scan returns evidence: the exact words that fired, the templates matched, a deterministic receipt hash. Not a vibes detector — an inspectable one.",
  },
  {
    title: "Open and local-first",
    icon: "⌬",
    body:
      "MIT-licensed. The core engine runs in the browser. No content leaves the device for the default scan path — useful when the input is sensitive.",
  },
];

export const AUDIENCE_CARDS = [
  {
    title: "Brand & marketing teams",
    emoji: "◈",
    body:
      "Vet creative, partner posts, and AI-drafted copy before launch. Catch the line that reads as outrage, gaslighting, or false certainty in the eyes of a critical audience.",
    cta: "Try the firewall",
    href: "#demo",
  },
  {
    title: "Comms, PR, and public affairs",
    emoji: "◐",
    body:
      "Run an inbound thread, a press release, or a crisis chain through the engine. See the affective trajectory rise, cool, or escalate — with a shareable card per scan.",
    cta: "Score a thread",
    href: "#demo",
  },
  {
    title: "Trust & safety / moderation",
    emoji: "✓",
    body:
      "Auditable per-rule evidence and a deterministic receipt for every scan. Plug the public scoring API into review queues without sending content to a third-party model.",
    cta: "Read the API",
    href: "#quick-start",
  },
  {
    title: "Researchers & journalists",
    emoji: "✶",
    body:
      "Bulk-score CSV / JSON of posts, name the manipulation templates that fire, export the enriched table. Built to make the analysis legible to a reader, not just a model.",
    cta: "Bulk mode",
    href: "#demo",
  },
  {
    title: "Security teams",
    emoji: "▣",
    body:
      "Phishing, social engineering, and AI-generated lures all carry affective signatures. Score email bodies and DMs with the same engine that catches outrage and urgency.",
    cta: "Hook into the API",
    href: "#quick-start",
  },
  {
    title: "Builders & open source",
    emoji: "⌬",
    body:
      "MIT-licensed, browser-first, fork-friendly. Add a region, write a custom rule pack, swap the scoring model — the React + R3F shell stays out of your way.",
    cta: "Star on GitHub",
    href: "https://github.com/slavazeph-coder/the-brain",
  },
];

export const COMMUNITY_CHANNELS = AUDIENCE_CARDS;

export const GALLERY_ITEMS = [
  {
    title: "Fear cascade",
    body: "AMY glows red as a high-urgency post fires across the threat dimension. Evidence words highlighted inline.",
    image: "/scan-fear-cascade.svg",
  },
  {
    title: "Certainty theater",
    body: "PFC dampened, BG rising — a confident, unhedged claim that the engine flags as false-certainty pressure.",
    image: "/scan-certainty-theater.svg",
  },
  {
    title: "Affective trajectory",
    body: "A 30-message inbox plotted as pressure-over-turns. Cooling, escalating, hostile — labeled in one glance.",
    image: "/scan-affective-trajectory.svg",
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
  hook: "An affective-intelligence engine for the open web.",
  sub:
    "Score the emotional payload of any post — fear, urgency, certainty, outrage — with auditable evidence and a live 3D brain.",
  cta: "Try the demo. Fork the engine. Star the repo.",
};

export const VIRAL_CONTENT = {
  twitterThread: `1/
Paste any tweet into a 3D brain. Watch which feeling it installs in you.

BrainSNN is a browser-native 3D brain with 35 cognitive layers — a Cognitive Firewall, an Affective Decoder, a Neurochemistry sandbox, a Dream Mode.

Live: ${SITE.demoUrl}

2/
The Firewall scores any text for manipulation pressure across 4 dimensions:
• emotional activation
• cognitive suppression
• manipulation pressure
• trust erosion

You see the bars, the evidence words, AND a 3D brain reacting in real time.

3/
Each scan produces a share card.
AMY glowing red = fear cascade.
PFC dampened = certainty theater.
Click "Share this reaction" and you get a /r/<hash> URL that renders a 1200×630 OG card anywhere it's pasted.

4/
There's a Spot-the-Manipulation quiz. 10 short messages. Slide toward "calm" or "manipulative." The Firewall already knows the truth. How close can you get?

Your Spot Accuracy becomes a shareable card. Leaderboard included.

5/
There's a Dream Mode that runs while you're idle. The brain replays recent states, reinforces co-active regions via STDP, and wakes on any activity.

Yes — your 3D brain will consolidate its weights if you walk away.

6/
There's an MCP bridge. 14 tools — get_brain_state, scan_content, apply_scenario, narrate_state, impact_analysis.

Your Claude Code / Codex agent can read and steer this brain over a websocket. Tool results come back live in the 3D view.

7/
There's a Brain Evolve loop that mutates the Firewall ruleset via UCB1 + MAP-Elites, scores each candidate against a red team corpus, and promotes the winner.

The Firewall literally evolves new rules to catch attacks it missed.

8/
There's an adversarial feed — submit a bypass attempt, the Firewall scores it, anything under 40% pressure gets published on the weekly leaderboard for Brain Evolve to catch next round.

Offense ↔ defense, public.

9/
Everything runs in your browser.
No install.
No signup.
No server for the main demo.

TRIBE v2 (real fMRI), Gemma 4 (deep multimodal), WebSocket sync — each is an optional upgrade behind one env var.

10/
Open source, MIT licensed. 35 layers of code you can fork and break.

Try a tweet, paste your inbox, stress-test your feed.

→ ${SITE.demoUrl}
Repo: ${SITE.repoUrl}

If this moves the needle on how you read your timeline, star it.`,
  hackerNewsTitle:
    "Show HN: BrainSNN — paste any tweet, see which feeling it installs in your brain",
  hackerNewsBody: `Hey HN,

BrainSNN is a browser-native 3D brain with 35 cognitive layers on top. The core demo: paste any text (or URL), a regex + Gemma 4 Cognitive Firewall scores it across 4 manipulation dimensions, and the 3D brain reacts — AMY glows on fear, PFC dampens on certainty theater, BG rises on manipulation pressure.

Demo: ${SITE.demoUrl}
Repo: ${SITE.repoUrl}

What's different vs. the usual "vibes detector" approach:

- Every scan produces a share card. /r/<hash> → a 1200×630 OG image with your excerpt + 4 score bars + affect label. Each share drags new viewers into the same loop.
- There's a Spot-the-Manipulation quiz: 10 items, you slide 0–100, your accuracy vs the Firewall is a score you can share.
- A Cognitive Immunity score persists across sessions (4 dimensions, streak multiplier). Weekly leaderboard ranks are submittable.
- A Red Team Simulator runs a 65-sample attack corpus through the Firewall and reports detection rate, FPR, F1, and an A–F verdict.
- A Brain Evolve loop (cannibalized from ASI-Evolve — UCB1, Island, MAP-Elites) mutates firewall rulesets against the red team corpus and promotes winners.
- A Dream Mode triggers after idle and replays recent states with STDP reinforcement between co-active regions. Any activity wakes the brain.
- An MCP bridge exposes 14 tools via JSON-RPC so Claude Code / Codex agents can read and steer the brain over a WebSocket.

The main demo runs pure frontend — no backend, no keys. TRIBE v2 (Meta's fMRI foundation model), Gemma 4, and WebSocket sync are each optional upgrades behind one env var.

Stack: React 18, Vite, React Three Fiber, Three.js, transformers.js (MiniLM in-browser embeddings), FFmpeg.wasm, Express + satori on the server side for OG image generation + the leaderboard.

Happy to dig into the firewall's regex → Gemma fallback chain, the Brain Evolve MAP-Elites bins, or the MCP tool design.`,
  redditML: `[P] BrainSNN: browser-native 3D brain with 35 cognitive layers + a Cognitive Firewall

I built a 3D brain viewer (React Three Fiber) and stacked 35 layers on top:

- Cognitive Firewall: regex + Gemma 4 scoring across 4 manipulation dimensions
- Affective Decoder: 12-affect taxonomy on Russell's valence × arousal circumplex
- Brain Evolve: UCB1 + Island + MAP-Elites evolution over firewall rulesets, cannibalized from GAIR-NLP/ASI-Evolve (~250 LOC JS port)
- Attack Evolve: co-evolutionary counterpart — string mutations (inject-benign, letter-split, synonym-soften) evaluated by evasion × continuity fitness
- Red Team Simulator: 65-sample synthetic attack corpus vs the firewall, reports F1 + A–F verdict
- Multimodal RAG + Vector-Graph Fusion (ported from HKUDS/RAG-Anything)
- In-browser embeddings via transformers.js (MiniLM, ~25MB quantized)
- Dream Mode: idle-triggered replay-consolidation with STDP weight updates
- MCP bridge: 14 tools so Claude/Codex agents can steer the brain

Everything runs in the browser. Optional TRIBE v2 backend (Meta fMRI foundation model) + Gemma 4 multimodal analysis behind one env var each.

Live: ${SITE.demoUrl}
Repo: ${SITE.repoUrl}

Would love feedback on the MAP-Elites bin design for firewall evolution and on the red team corpus — if you can break the scanner, submission UI is live and anything that scores under 40% gets published on a weekly feed.`,
  redditR3F: `Built a 3D neuromorphic brain viewer with 46 panels — React Three Fiber + postprocessing + FFmpeg.wasm

Live: ${SITE.demoUrl}

- 7 anatomical regions, 10 plastic pathways
- GPU-animated TubeGeometry pathways with custom GLSL shaders
- Signal pulse waves radiate through the connectome when regions fire
- Quality tiers (low/high/ultra) with PerformanceMonitor auto-switching
- WebM recording + GIF export via FFmpeg.wasm in-browser
- Each panel is a modular React component — 46 of them, lazy-rendered on demand

On top: a Cognitive Firewall that scores any text for manipulation and lights up the brain accordingly, a Dream Mode that consolidates weights while idle, an MCP bridge so AI agents can steer the brain over a WebSocket.

All MIT. Easy to fork — add a region, swap a pathway, wire a new scenario.

Repo: ${SITE.repoUrl}`,
  launchPlan: `Pre-launch:
- brainsnn.com pointed at the Railway app
- Upstash env vars set (leaderboard + attack feed)
- 6 reaction cards pre-generated + pinned to X
- 3 quiz share cards pre-generated (one for each verdict tier)
- GitHub social preview image uploaded
- 8–10 good first issues seeded

Launch day (Tue 08:00 PT):
- Show HN with the "paste any tweet" framing
- X thread (10 tweets) with 3 reaction cards embedded
- r/MachineLearning post focused on Brain Evolve + MAP-Elites
- r/reactjs post focused on 46 panels + FFmpeg.wasm
- Drop in neuromorphic + MCP Discords
- Monitor star velocity; reply within 10 min for first 2 hours

Day 2–3:
- Spot the Manipulation quiz thread with 3 public quiz results
- Weekly bypass leaderboard thread on Twitter
- Post in r/privacy + r/cybersecurity focused on Cognitive Firewall`,
};

export const SHARE_ROUTES = {
  reactionCard: "/r/<hash>",
  immunityCard: "/i/<hash>",
  quizCard: "/q/<hash>",
  ogImage: "/api/og?type=reaction|immunity|quiz&h=<hash>",
  urlFetcher: "/api/fetch-url?u=<url>",
  leaderboard: "/api/leaderboard",
  attacks: "/api/attacks",
};

export const README_MD = `# 🧠 BrainSNN

![MIT License](https://img.shields.io/badge/license-MIT-green)
![React Three Fiber](https://img.shields.io/badge/React%20Three%20Fiber-R3F-black)
![Three.js](https://img.shields.io/badge/Three.js-3D-informational)

**An affective-intelligence engine for the open web.**

BrainSNN detects the emotional payload inside online content — text, screenshots, threads — *before* it shapes attention, behavior, brand risk, or public perception. Every scan returns four-dimensional pressure scores, named manipulation templates, evidence words, and a deterministic receipt.

The engine renders inside a live 3D brain (React Three Fiber, 7 regions, 10 plastic pathways) so the response is visible, not hidden behind a single number.

No backprop.
No retraining.
No server required for the default scan path.

## What it surfaces

- **Attention** — urgency, awe, and curiosity loads engineered to win the first impression
- **Behavior** — manipulation pressure that pushes toward reflex over thought
- **Brand risk** — outrage, gaslighting, and false certainty in copy your brand may be near
- **Public perception** — affective trajectories across a thread, an inbox, or a press cycle

## Who it's for

- Brand & marketing teams vetting creative and AI-drafted copy
- Comms, PR, and public-affairs teams reading inbound and outbound at speed
- Trust & safety, moderation, and security teams plugging the API into review queues
- Researchers and journalists scoring posts in bulk with auditable evidence
- Open-source builders forking the engine, the rule packs, or the 3D shell

## Live demo

- Repo: ${SITE.repoUrl}
- Demo: ${SITE.demoUrl}

> Replace \`${SITE.demoUrl}\` in \`src/constants/site.js\` once you deploy.

## Features

| Layer | What it does |
| --- | --- |
| Cognitive Firewall | Scores text across 4 affective dimensions with per-rule evidence |
| Manipulation templates | Names the technique that fired (gaslighting, DARVO, FOMO, scarcity, …) |
| 3D brain feedback | Live R3F scene reacts as regions absorb the affective payload |
| Public scoring API | \`POST /api/score\` and an SSE streaming variant — bring your own pipeline |
| Receipts | Deterministic SHA-256 stamp per scan for audit trails |
| Browser-first | Default scan path runs entirely in the browser; nothing leaves the device |

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
