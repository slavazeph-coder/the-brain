export const SITE = {
  name: "BrainSNN",
  repoUrl: "https://github.com/slavazeph-coder/the-brain",
  domainUrl: "https://brainsnn.com",
  demoUrl: "https://brainsnn.com/app",
  issuesUrl: "https://github.com/slavazeph-coder/the-brain/issues",
  license: "MIT",
  repoOwner: "slavazeph-coder",
  repoName: "the-brain",
  tagline: "Your personal AI brain. You own it.",
  mission:
    "BrainSNN is a cognitive engine that runs in your browser, learns from what you feed it, and wires straight into your AI agents — no cloud account, no server, no one else's infrastructure between you and your data.",
  badge: "Personal AI Infrastructure · Zero Server Core · 100 Cognitive Layers",
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
    description:
      "The intake gate: what content makes the nervous system notice first.",
  },
  {
    code: "CTX",
    name: REGION_LONG_NAMES.CTX,
    position: [2.45, 0.65, -0.15],
    color: "#5fb7c1",
    baseActivity: 0.26,
    description:
      "Meaning assembly: how claims, frames, and context become interpretation.",
  },
  {
    code: "HPC",
    name: REGION_LONG_NAMES.HPC,
    position: [1.25, -1.6, 1.35],
    color: "#d8ab3a",
    baseActivity: 0.18,
    description:
      "Memory linkage: what the message connects to past beliefs and stories.",
  },
  {
    code: "PFC",
    name: REGION_LONG_NAMES.PFC,
    position: [3.45, 1.9, 0.75],
    color: "#a78ce5",
    baseActivity: 0.2,
    description:
      "Executive control: whether a reader can stay reflective instead of reactive.",
  },
  {
    code: "AMY",
    name: REGION_LONG_NAMES.AMY,
    position: [1.85, -0.95, -2.15],
    color: "#d86e78",
    baseActivity: 0.13,
    description:
      "Threat and salience: fear, outrage, urgency, shame, and protective attention.",
  },
  {
    code: "BG",
    name: REGION_LONG_NAMES.BG,
    position: [-1.9, -0.55, -1.25],
    color: "#5b92cf",
    baseActivity: 0.14,
    description:
      "Behavioral gating: what the message pressures the reader to do next.",
  },
  {
    code: "CBL",
    name: REGION_LONG_NAMES.CBL,
    position: [-3.1, 1.2, 1.6],
    color: "#c69f31",
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
  "Fear, threat, urgency, and outrage pressure",
  "Trust erosion, certainty theatre, and authority hijacking",
  "Shame, status, belonging, desire, and identity activation",
  "Behavioral push: click, share, comply, attack, withdraw, or buy",
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
    "Paste or connect content",
    "Drop in a tweet, ad, email, script, article, campaign concept, or public narrative.",
  ],
  [
    "Decode the payload",
    "BrainSNN scores affect, persuasion pressure, trust erosion, behavioral push, and public-perception risk.",
  ],
  [
    "See the brain reaction",
    "The 3D model makes the invisible visible: salience, memory linkage, action pressure, and executive override.",
  ],
  [
    "Rewrite with control",
    "Get safer, sharper alternatives that keep persuasion ethical and protect brand trust.",
  ],
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
  hook: "Everyone will own a cloud. BrainSNN is what runs on yours.",
  sub: "A 100-layer cognitive engine that runs in your browser, wires into your AI agents, and never asks you to log in.",
  cta: "Run your brain, or try the manipulation scanner first.",
};

export const VIRAL_CONTENT = {
  twitterThread: `Steve Jobs bet on everyone owning a computer. BrainSNN is a bet that everyone will own a brain.\n\n100 cognitive layers. Runs in your browser. Wires into Claude/Codex via MCP. No account, no server, no one else's infrastructure.\n\nDemo: ${SITE.demoUrl}`,
  hackerNewsTitle:
    "Show HN: BrainSNN — a personal AI brain that runs in your browser",
  hackerNewsBody: `BrainSNN is a 100-layer cognitive engine — firewall, affective decoder, knowledge brain, dream mode, MCP bridge to your agents — that runs entirely client-side. No account, no cloud dependency for the core.\n\nThe thesis: AI infrastructure shouldn't require renting someone else's cloud. This one runs on yours.\n\nDemo: ${SITE.demoUrl}\nRepo: ${SITE.repoUrl}`,
  redditML: `BrainSNN: a browser-native cognitive engine — SNN-style regions, an MCP bridge to your AI agents, local Gemma/Ollama support. You own the compute. Demo: ${SITE.demoUrl}`,
  redditR3F: `BrainSNN uses a 3D brain interface to make a personal AI engine's internal state visible and ownable. Demo: ${SITE.demoUrl}`,
  launchPlan: `Launch around one clear claim: AI infrastructure doesn't have to be rented. BrainSNN is a personal AI brain you own outright, with the emotional-payload scanner as the first visceral demo of what it can do.`,
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

**Your personal AI brain. You own it.**

BrainSNN is a 100-layer cognitive engine that runs entirely in your browser — no account, no server, no one else's infrastructure between you and your data. It wires directly into your AI agents via MCP, and ships with an emotional-payload scanner as its first proof of power: paste any post, ad, or email and see the manipulation pressure before it shapes attention, behavior, brand risk, or public perception.

## What it does

- Runs the full cognitive engine client-side — zero server required for the core
- Bridges 14 tools to Claude Code, Codex, or any MCP-aware agent
- Scans posts, ads, emails, scripts, and articles for fear, urgency, outrage, shame, belonging, desire, trust erosion, and manipulation pressure
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
