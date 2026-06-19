export const SITE = {
  name: "BrainSNN",
  repoUrl: "https://github.com/slavazeph-coder/the-brain",
  domainUrl: "https://www.brainsnn.com",
  demoUrl: "https://www.brainsnn.com/app",
  issuesUrl: "https://github.com/slavazeph-coder/the-brain/issues",
  license: "MIT",
  repoOwner: "slavazeph-coder",
  repoName: "the-brain",
  tagline: "See the emotions AI can't see.",
  mission:
    "BrainSNN uses Crumb LLM and spiking-neural analysis to reveal the emotional payload inside posts, ads, videos, and narratives before they shape attention, behavior, brand risk, or perception.",
  badge: "Affective intelligence / Crumb LLM / Live brain scan",
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
  background: "#0a0a0f",
  surface: "#10121d",
  surfaceAlt: "#15172a",
  text: "#f8fafc",
  muted: "#a9b2c7",
  teal: "#22d3ee",
  cyan: "#00f5ff",
  gold: "#f59e0b",
  red: "#fb7185",
};

export const BRAIN_REGIONS = [
  {
    code: "THL",
    name: REGION_LONG_NAMES.THL,
    position: [0, 0.1, 0],
    color: "#22d3ee",
    baseActivity: 0.56,
    description:
      "The intake gate: what content makes the nervous system notice first.",
  },
  {
    code: "CTX",
    name: REGION_LONG_NAMES.CTX,
    position: [2.45, 0.65, -0.15],
    color: "#00f5ff",
    baseActivity: 0.26,
    description:
      "Meaning assembly: how claims, frames, and context become interpretation.",
  },
  {
    code: "HPC",
    name: REGION_LONG_NAMES.HPC,
    position: [1.25, -1.6, 1.35],
    color: "#a855f7",
    baseActivity: 0.18,
    description:
      "Memory linkage: what the message connects to past beliefs and stories.",
  },
  {
    code: "PFC",
    name: REGION_LONG_NAMES.PFC,
    position: [3.45, 1.9, 0.75],
    color: "#38bdf8",
    baseActivity: 0.2,
    description:
      "Executive control: whether a reader can stay reflective instead of reactive.",
  },
  {
    code: "AMY",
    name: REGION_LONG_NAMES.AMY,
    position: [1.85, -0.95, -2.15],
    color: "#fb7185",
    baseActivity: 0.13,
    description:
      "Threat and salience: fear, outrage, urgency, shame, and protective attention.",
  },
  {
    code: "BG",
    name: REGION_LONG_NAMES.BG,
    position: [-1.9, -0.55, -1.25],
    color: "#8b5cf6",
    baseActivity: 0.14,
    description:
      "Behavioral gating: what the message pressures the reader to do next.",
  },
  {
    code: "CBL",
    name: REGION_LONG_NAMES.CBL,
    position: [-3.1, 1.2, 1.6],
    color: "#14b8a6",
    baseActivity: 0.17,
    description:
      "Pattern calibration: timing, repetition, and subtle emotional conditioning.",
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
    label: "attention to meaning",
  },
  {
    id: "CTX-HPC",
    from: "CTX",
    to: "HPC",
    initialWeight: 0.46,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.45, 0.15, 0.55],
    label: "context to memory",
  },
  {
    id: "HPC-CTX",
    from: "HPC",
    to: "CTX",
    initialWeight: 0.42,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.1, -0.25, -0.2],
    label: "memory to interpretation",
  },
  {
    id: "CTX-PFC",
    from: "CTX",
    to: "PFC",
    initialWeight: 0.49,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.35, 0.65, 0.35],
    label: "interpretation to judgment",
  },
  {
    id: "PFC-CTX",
    from: "PFC",
    to: "CTX",
    initialWeight: 0.34,
    plastic: true,
    inhibitory: false,
    curveOffset: [-0.2, 0.25, -0.35],
    label: "reflection to meaning",
  },
  {
    id: "CTX-AMY",
    from: "CTX",
    to: "AMY",
    initialWeight: 0.31,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.4, -0.2, -0.7],
    label: "meaning to salience",
  },
  {
    id: "AMY-BG",
    from: "AMY",
    to: "BG",
    initialWeight: 0.34,
    plastic: true,
    inhibitory: false,
    curveOffset: [-0.35, -0.05, 0.1],
    label: "emotion to action pressure",
  },
  {
    id: "BG-THL",
    from: "BG",
    to: "THL",
    initialWeight: 0.26,
    plastic: true,
    inhibitory: true,
    curveOffset: [-0.25, 0.15, -0.2],
    label: "behavioral gate",
  },
  {
    id: "CBL-CTX",
    from: "CBL",
    to: "CTX",
    initialWeight: 0.29,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.15, -0.35, -0.3],
    label: "pattern calibration",
  },
  {
    id: "PFC-HPC",
    from: "PFC",
    to: "HPC",
    initialWeight: 0.32,
    plastic: true,
    inhibitory: false,
    curveOffset: [0.55, 0.05, 0.55],
    label: "judgment to memory",
  },
];

export const IMPACT_SIGNALS = [
  "Joy, fear, trust, anger, surprise, shame, and belonging cues",
  "Attention spikes, cognitive load, urgency, and certainty theatre",
  "Brand-safety risk, trust erosion, and public-perception drift",
  "Behavioral push: click, share, comply, attack, withdraw, or buy",
];

export const LIVE_SCAN_EXAMPLES = [
  {
    label: "Viral reel",
    title: "Creator hook before the payoff",
    sample:
      "If you skip this, you will be behind everyone who already saw the signal.",
    verdict:
      "Status pressure and scarcity are carrying the hook. The scan recommends keeping the urgency, but adding evidence before asking viewers to act.",
    metrics: [
      ["Affective score", 87],
      ["Attention spike", 92],
      ["Brand risk", 41],
      ["Viral potential", 84],
    ],
    regionBoosts: {
      THL: 0.72,
      AMY: 0.66,
      BG: 0.58,
      PFC: 0.18,
      CTX: 0.42,
      HPC: 0.3,
      CBL: 0.46,
    },
    regionColors: {
      THL: "#00f5ff",
      AMY: "#fb7185",
      BG: "#a855f7",
      CTX: "#22d3ee",
      PFC: "#38bdf8",
      HPC: "#c084fc",
      CBL: "#14b8a6",
    },
    timeline: [22, 34, 68, 91, 88, 74, 59, 82, 71, 48],
    affects: [
      ["Surprise", 78],
      ["Fear", 62],
      ["Trust", 34],
      ["Anger", 28],
    ],
  },
  {
    label: "Ad preflight",
    title: "Launch claim with implied authority",
    sample:
      "Experts agree this is the only safe option before the market changes.",
    verdict:
      "Authority and false certainty are doing too much work. Add source detail and reduce the absolute claim before publishing.",
    metrics: [
      ["Affective score", 73],
      ["Attention spike", 68],
      ["Brand risk", 76],
      ["Viral potential", 58],
    ],
    regionBoosts: {
      THL: 0.48,
      AMY: 0.42,
      BG: 0.5,
      PFC: 0.24,
      CTX: 0.66,
      HPC: 0.52,
      CBL: 0.3,
    },
    regionColors: {
      THL: "#22d3ee",
      AMY: "#f97316",
      BG: "#a855f7",
      CTX: "#00f5ff",
      PFC: "#38bdf8",
      HPC: "#c084fc",
      CBL: "#14b8a6",
    },
    timeline: [18, 28, 39, 52, 69, 76, 72, 61, 57, 44],
    affects: [
      ["Trust", 46],
      ["Fear", 38],
      ["Certainty", 81],
      ["Risk", 76],
    ],
  },
  {
    label: "News frame",
    title: "Crisis headline with missing context",
    sample:
      "A shocking collapse is coming, and officials do not want families to know.",
    verdict:
      "Threat, hidden-truth framing, and trust erosion are stacked together. The safer rewrite names what is known and removes the implied cover-up.",
    metrics: [
      ["Affective score", 91],
      ["Attention spike", 86],
      ["Brand risk", 88],
      ["Viral potential", 79],
    ],
    regionBoosts: {
      THL: 0.62,
      AMY: 0.86,
      BG: 0.64,
      PFC: 0.12,
      CTX: 0.36,
      HPC: 0.58,
      CBL: 0.28,
    },
    regionColors: {
      THL: "#00f5ff",
      AMY: "#ff6b35",
      BG: "#fb7185",
      CTX: "#22d3ee",
      PFC: "#38bdf8",
      HPC: "#a855f7",
      CBL: "#14b8a6",
    },
    timeline: [31, 45, 73, 88, 93, 84, 69, 76, 63, 51],
    affects: [
      ["Fear", 86],
      ["Anger", 64],
      ["Trust loss", 82],
      ["Surprise", 71],
    ],
  },
];

export const CRUMB_PIPELINE = [
  {
    label: "Input",
    detail: "URL, text, video, ad, article, or social post",
    intensity: 0.35,
  },
  {
    label: "Crumb LLM",
    detail: "Wave-field processing mixes context in O(N log N)",
    intensity: 0.68,
  },
  {
    label: "SNN spikes",
    detail: "Affect maps into thalamus, amygdala, cortex, and basal ganglia",
    intensity: 0.92,
  },
  {
    label: "Brain scan",
    detail: "Risk, attention, emotion, and shareable output",
    intensity: 0.78,
  },
];

export const EMOTION_LAYERS = [
  ["Joy", "#22d3ee"],
  ["Fear", "#fb7185"],
  ["Trust", "#14b8a6"],
  ["Anger", "#f97316"],
  ["Surprise", "#a855f7"],
];

export const RESEARCH_CARDS = [
  {
    title: "Crumb LLM",
    label: "Physics-first AI",
    body: "Wave-field language processing for long context, fixed field-cache behavior, and BrainSNN's affective analysis pipeline.",
    href: "/crumb-llm",
  },
  {
    title: "GaugeGap Foundry",
    label: "Verification infrastructure",
    body: "Finite-system benchmark tracks for GaugeGap, FlowGap, and CurveRank, with explicit boundaries around what is and is not proven.",
    href: "/research",
  },
  {
    title: "Cognitive Firewall",
    label: "Product evidence",
    body: "Regex, semantic, and server-side scorers return the exact phrases and frames that pushed a scan into risk.",
    href: SITE.demoUrl,
  },
];

export const YOUR_STACK = [
  {
    title: "Runs in your browser",
    icon: "◈",
    body: "The core engine — all 100 cognitive layers — needs no server, no account, and no API key. Open the page and the brain is already running on your machine.",
  },
  {
    title: "Wired to your agents",
    icon: "⌁",
    body: "An MCP bridge exposes 14 tools so Claude Code, Codex, or any MCP-aware agent can read and steer the brain directly — your tools, your control.",
  },
  {
    title: "Your second brain, not theirs",
    icon: "▣",
    body: "The Knowledge Brain scans your own files and notes locally. Nothing leaves your machine to build it.",
  },
  {
    title: "Bring your own model",
    icon: "◉",
    body: "Point it at local Gemma or Ollama instead of a hosted API. Swap the brain's reasoning layer without swapping who owns the data.",
  },
  {
    title: "Consolidates while you're away",
    icon: "✦",
    body: "Dream Mode replays and reweights on idle, the way a brain consolidates memory overnight — on your machine, on your time.",
  },
  {
    title: "Open source, not a black box",
    icon: "⚙",
    body: "MIT-licensed. Every layer — firewall, decoder, evolve loop — is code you can read, fork, and run without anyone's permission.",
  },
];

export const USE_CASES = [
  {
    title: "Brands and agencies",
    icon: "◎",
    body: "Preflight posts, ads, landing pages, and crisis replies before they trigger the wrong emotion or damage trust.",
  },
  {
    title: "Public perception teams",
    icon: "◐",
    body: "Map how narratives move attention, what feeling they install, and where reputational risk starts to compound.",
  },
  {
    title: "Creators and media operators",
    icon: "✦",
    body: "Understand why a hook works, whether it crosses into manipulation, and how to rewrite it without killing the signal.",
  },
  {
    title: "Compliance and comms review",
    icon: "⌁",
    body: "Flag emotional overreach, implied pressure, missing context, and claims that could create brand, legal, or trust exposure.",
  },
  {
    title: "Research and red teams",
    icon: "◇",
    body: "Stress-test persuasion patterns, cognitive vulnerabilities, and adversarial content with repeatable scoring and evidence trails.",
  },
  {
    title: "AI-generated content pipelines",
    icon: "▣",
    body: "Add an emotional-risk layer between generation and publication so AI output is reviewed for human impact, not only grammar.",
  },
];

export const PRODUCT_WORKFLOW = [
  [
    "Input content",
    "Paste a URL, text, post, ad, script, or uploaded clip. Preloaded demos keep the scan experience working even before every backend is configured.",
  ],
  [
    "Crumb LLM wave processing",
    "The physics-based Crumb layer mixes context through wave-field processing, then hands a structured affective signal to BrainSNN.",
  ],
  [
    "Spiking neural analysis",
    "The SNN layer lights up salience, memory linkage, action pressure, and executive override like a live brain scan.",
  ],
  [
    "Output and share",
    "Generate emotional payload scores, evidence, safer rewrite direction, and shareable scan assets for teams or social posts.",
  ],
];

export const FEED_MIRROR_STEPS = [
  {
    label: "Social graph",
    title: "Instagram shows who you know.",
    body: "Friends, creators, follows, and social proof become the surface layer.",
  },
  {
    label: "Attention graph",
    title: "TikTok predicts what keeps you watching.",
    body: "The system learns the next clip before the viewer can name the feeling.",
  },
  {
    label: "Cognitive graph",
    title: "BrainSNN shows what the feed is doing.",
    body: "Fear, urgency, status, belonging, certainty, and action pressure become readable evidence.",
  },
];

export const FEED_PAYLOAD_SIGNALS = [
  {
    label: "Urgency",
    value: 86,
    detail: "Time pressure is carrying the hook.",
  },
  {
    label: "Status",
    value: 72,
    detail: "The copy implies insiders already moved.",
  },
  {
    label: "Certainty",
    value: 64,
    detail: "Missing evidence is presented as settled fact.",
  },
  {
    label: "Action push",
    value: 78,
    detail: "The message nudges a fast share or click.",
  },
];

export const TRUST_CARDS = [
  {
    title: "Yours, not rented",
    icon: "⚡",
    body: "The brain runs on your machine. There is no account that can be suspended and no vendor that can raise the price of your own cognition.",
  },
  {
    title: "Evidence-first scoring",
    icon: "⌕",
    body: "Each result should expose the exact phrases, frames, and signals that triggered fear, urgency, trust loss, or manipulation risk.",
  },
  {
    title: "Affective decoder",
    icon: "◉",
    body: "Classifies content across threat, reward, social, and cognitive affect clusters so you can understand the feeling being installed.",
  },
  {
    title: "Agent-native",
    icon: "🛡",
    body: "The MCP bridge means your AI agents don't call an API to think — they read and steer this brain directly, as an extension of themselves.",
  },
  {
    title: "Human-readable interface",
    icon: "▧",
    body: "The 3D brain is not decoration. It turns invisible cognitive state into a visual system anyone can read at a glance.",
  },
  {
    title: "Research-ready architecture",
    icon: "🧠",
    body: "Neuromorphic, SNN, affective-computing, and red-team modules evolve behind the same product surface without confusing first-time users.",
  },
];

export const ROADMAP_CARDS = [
  {
    title: "Pilot dashboard",
    body: "Team workspace for saved scans, evidence trails, rewrite history, and approval-ready reports.",
  },
  {
    title: "Public narrative monitor",
    body: "Track how emotional patterns shift across posts, comments, articles, and campaign waves.",
  },
  {
    title: "API and integrations",
    body: "Plug emotional-risk scanning into Slack, Docs, CMS tools, ad workflows, and agent pipelines.",
  },
];

export const PILOT_CHECKLIST = [
  "Analyze 50–100 posts, ads, emails, or public replies from one real team.",
  "Return emotional payload, manipulation pressure, risk evidence, and safer rewrites.",
  "Create a weekly emotional-risk report with the top patterns and recommended fixes.",
  "Use pilot feedback to tune categories, thresholds, dashboard language, and export format.",
];

export const WHY_CARDS = TRUST_CARDS;

export const COMMUNITY_CHANNELS = [
  {
    title: "Agencies",
    emoji: "◎",
    body: "Best first customer profile: they already manage content risk and can test the tool across multiple accounts.",
    href: SITE.demoUrl,
    cta: "Open demo",
  },
  {
    title: "Brand teams",
    emoji: "◐",
    body: "Position BrainSNN as preflight review for campaigns, replies, landing pages, and crisis communications.",
    href: SITE.domainUrl,
    cta: "Visit domain",
  },
  {
    title: "Compliance",
    emoji: "⌁",
    body: "Frame it around pressure, implied claims, missing context, and reputational exposure in public-facing language.",
    href: SITE.repoUrl,
    cta: "View repo",
  },
  {
    title: "Researchers",
    emoji: "🧠",
    body: "Affective computing, persuasion detection, neuromorphic AI, and red-team benchmarks can become the technical moat.",
    href: SITE.issuesUrl,
    cta: "Open issues",
  },
  {
    title: "Creators",
    emoji: "✦",
    body: "A simple viral wedge: paste a post, see what feeling it installs, then rewrite it with less manipulation and more clarity.",
    href: SITE.demoUrl,
    cta: "Try scan",
  },
  {
    title: "Investors",
    emoji: "▣",
    body: "The fundable category is personal AI infrastructure — owned compute, not rented intelligence — with manipulation detection as the wedge that proves it works.",
    href: SITE.repoUrl,
    cta: "Review code",
  },
];

export const GALLERY_ITEMS = ROADMAP_CARDS;

export const PRE_LAUNCH_CHECKLIST = [
  "Replace placeholder copy with the emotional-payload intelligence thesis.",
  "Point the main CTA to the working Railway demo.",
  "Add a pilot signup path for brands, agencies, creators, and comms teams.",
  "Record a 60-second demo showing paste → scan → evidence → rewrite.",
  "Update GitHub README and social preview to match the same positioning.",
  "Collect 3–5 real content examples and turn them into sanitized case studies.",
  "Ask 10 potential users what report format would make them pay for this weekly.",
];

export const LAUNCH_DAY_CHECKLIST = [
  "Post the product thesis: content has an emotional payload before it has business impact.",
  "Lead with one screenshot or clip of a real scan, not abstract architecture.",
  "Invite agencies and brand teams into a paid pilot instead of only asking for stars.",
  "Capture every objection as a homepage, pricing, or product language improvement.",
  "Track demo scans, pilot requests, replies, and repeat usage — not vanity traffic alone.",
  "Turn the best 5 scans into a public examples library.",
  "Follow up with every serious user within 24 hours.",
];

export const GOOD_FIRST_ISSUES = [
  "Add a pilot signup form wired to email or a lightweight backend.",
  "Create sample scans for brands, agencies, creators, and crisis comms.",
  "Add exportable PDF/PNG emotional-risk reports.",
  "Improve mobile readability for the hero and demo sections.",
  "Add tests for scoring categories and rewrite recommendations.",
  "Create a privacy note explaining what is and is not stored.",
  "Add a public examples page with sanitized content analyses.",
  "Add integrations for Slack, Google Docs, and Notion review workflows.",
  "Add benchmark examples for benign, persuasive, manipulative, and high-risk copy.",
  "Replace placeholder media with a polished product walkthrough video.",
];

export const SOCIAL_PREVIEW_COPY = {
  hook: "See the emotions AI can't see.",
  sub: "Affective intelligence powered by Crumb LLM and spiking neural analysis.",
  cta: "Scan content, watch the brain react, and share the result.",
};

export const VIRAL_CONTENT = {
  twitterThread: `Most AI reads sentiment. BrainSNN reads the payload.

Paste a post, ad, article, or narrative and see the emotion, pressure, trust risk, and attention curve as a live brain scan powered by Crumb LLM and SNN analysis.

Demo: ${SITE.demoUrl}`,
  hackerNewsTitle:
    "Show HN: BrainSNN - live affective intelligence for online content",
  hackerNewsBody: `BrainSNN scans posts, ads, emails, scripts, and narratives for emotional payload: fear, urgency, status, belonging, certainty, trust erosion, and behavior pressure.

The product combines Crumb LLM wave processing, a cognitive firewall, and a live 3D SNN brain scan. The first experience is simple: paste content, see what it is trying to do, inspect the evidence, and open the full scanner.

Demo: ${SITE.demoUrl}
Repo: ${SITE.repoUrl}`,
  redditML: `BrainSNN: live affective intelligence for content analysis - paste content and see emotion, pressure, trust risk, and attention curves as a brain scan. Demo: ${SITE.demoUrl}`,
  redditR3F: `BrainSNN uses a 3D brain interface to make a personal AI engine's internal state visible and ownable. Demo: ${SITE.demoUrl}`,
  launchPlan: `Launch around one clear claim: BrainSNN shows the emotions AI cannot see. Lead with scan -> brain view -> evidence -> shareable output, then show Crumb LLM and GaugeGap underneath.`,
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

export const README_MD = `# BrainSNN

**BrainSNN shows the emotions AI can't see.**

BrainSNN is a live affective-intelligence engine that starts with one simple promise: paste any post, ad, email, script, or narrative and see what it is trying to make people feel, believe, and do before it shapes attention, behavior, brand risk, or public perception.

## What it does

- Runs the full cognitive engine client-side — zero server required for the core
- Bridges 14 tools to Claude Code, Codex, or any MCP-aware agent
- Scans posts, ads, emails, scripts, and articles for fear, urgency, outrage, shame, belonging, desire, trust erosion, and manipulation pressure
- Uses Crumb LLM wave processing and SNN-style brain visualization for the public demo path
- Shows evidence behind each score
- Visualizes brain state through a live 3D interface
- Builds a local Knowledge Brain from your own files — nothing leaves your machine
- Produces safer rewrite options and report-ready outputs

## Live links

- Product domain: ${SITE.domainUrl}
- Working demo: ${SITE.demoUrl}
- Repo: ${SITE.repoUrl}

## Quick start

\`\`\`bash
git clone ${SITE.repoUrl}
cd the-brain/ui/brainsnn-site
npm install
npm run dev
\`\`\`

## License

MIT
`;
