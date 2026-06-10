export const SITE = {
  name: "BrainSNN",
  repoUrl: "https://github.com/slavazeph-coder/the-brain",
  domainUrl: "https://brainsnn.com",
  demoUrl: "https://brainsnn.com",
  issuesUrl: "https://github.com/slavazeph-coder/the-brain/issues",
  license: "MIT",
  repoOwner: "slavazeph-coder",
  repoName: "the-brain",
  tagline: "Affective intelligence for the AI internet.",
  mission:
    "An affective-intelligence engine that detects the emotional payload inside online content before it shapes attention, behavior, brand risk, or public perception.",
  badge: "Emotional Payload Intelligence · Brand Risk · Public Perception",
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
    description: "The intake gate: what content makes the nervous system notice first.",
  },
  {
    code: "CTX",
    name: REGION_LONG_NAMES.CTX,
    position: [2.45, 0.65, -0.15],
    color: "#5fb7c1",
    baseActivity: 0.26,
    description: "Meaning assembly: how claims, frames, and context become interpretation.",
  },
  {
    code: "HPC",
    name: REGION_LONG_NAMES.HPC,
    position: [1.25, -1.6, 1.35],
    color: "#d8ab3a",
    baseActivity: 0.18,
    description: "Memory linkage: what the message connects to past beliefs and stories.",
  },
  {
    code: "PFC",
    name: REGION_LONG_NAMES.PFC,
    position: [3.45, 1.9, 0.75],
    color: "#a78ce5",
    baseActivity: 0.2,
    description: "Executive control: whether a reader can stay reflective instead of reactive.",
  },
  {
    code: "AMY",
    name: REGION_LONG_NAMES.AMY,
    position: [1.85, -0.95, -2.15],
    color: "#d86e78",
    baseActivity: 0.13,
    description: "Threat and salience: fear, outrage, urgency, shame, and protective attention.",
  },
  {
    code: "BG",
    name: REGION_LONG_NAMES.BG,
    position: [-1.9, -0.55, -1.25],
    color: "#5b92cf",
    baseActivity: 0.14,
    description: "Behavioral gating: what the message pressures the reader to do next.",
  },
  {
    code: "CBL",
    name: REGION_LONG_NAMES.CBL,
    position: [-3.1, 1.2, 1.6],
    color: "#c69f31",
    baseActivity: 0.17,
    description: "Pattern calibration: timing, repetition, and subtle emotional conditioning.",
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

export const USE_CASES = [
  {
    title: "Brands and agencies",
    icon: "◎",
    body:
      "Preflight posts, ads, landing pages, and crisis replies before they trigger the wrong emotion or damage trust.",
  },
  {
    title: "Public perception teams",
    icon: "◐",
    body:
      "Map how narratives move attention, what feeling they install, and where reputational risk starts to compound.",
  },
  {
    title: "Creators and media operators",
    icon: "✦",
    body:
      "Understand why a hook works, whether it crosses into manipulation, and how to rewrite it without killing the signal.",
  },
  {
    title: "Compliance and comms review",
    icon: "⌁",
    body:
      "Flag emotional overreach, implied pressure, missing context, and claims that could create brand, legal, or trust exposure.",
  },
  {
    title: "Research and red teams",
    icon: "◇",
    body:
      "Stress-test persuasion patterns, cognitive vulnerabilities, and adversarial content with repeatable scoring and evidence trails.",
  },
  {
    title: "AI-generated content pipelines",
    icon: "▣",
    body:
      "Add an emotional-risk layer between generation and publication so AI output is reviewed for human impact, not only grammar.",
  },
];

export const PRODUCT_WORKFLOW = [
  ["Paste or connect content", "Drop in a tweet, ad, email, script, article, campaign concept, or public narrative."],
  ["Decode the payload", "BrainSNN scores affect, persuasion pressure, trust erosion, behavioral push, and public-perception risk."],
  ["See the brain reaction", "The 3D model makes the invisible visible: salience, memory linkage, action pressure, and executive override."],
  ["Rewrite with control", "Get safer, sharper alternatives that keep persuasion ethical and protect brand trust."],
];

export const TRUST_CARDS = [
  {
    title: "Emotional payload detection",
    icon: "⚡",
    body:
      "The product is built around what content does to attention and behavior, not only what the words literally say.",
  },
  {
    title: "Evidence-first scoring",
    icon: "⌕",
    body:
      "Each result should expose the exact phrases, frames, and signals that triggered fear, urgency, trust loss, or manipulation risk.",
  },
  {
    title: "Affective decoder",
    icon: "◉",
    body:
      "Classifies content across threat, reward, social, and cognitive affect clusters so teams can understand the feeling being installed.",
  },
  {
    title: "Brand-risk layer",
    icon: "🛡",
    body:
      "Useful for reputation, comms, marketing, compliance, and public-response workflows where emotional misfire is expensive.",
  },
  {
    title: "Human-readable interface",
    icon: "▧",
    body:
      "The 3D brain is not decoration. It turns invisible cognitive pressure into a visual system that non-technical users can read quickly.",
  },
  {
    title: "Research-ready architecture",
    icon: "🧠",
    body:
      "Neuromorphic, SNN, affective-computing, and red-team modules can evolve behind the same product surface without confusing first-time users.",
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
    body: "The fundable category is emotional payload intelligence for the AI-generated internet, not a vague brain demo.",
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
  hook: "BrainSNN detects the emotional payload inside online content before it moves people.",
  sub:
    "Paste any post, ad, email, or narrative. See fear, trust erosion, urgency, desire, shame, belonging, and behavior pressure.",
  cta: "Try the demo or join the pilot.",
};

export const VIRAL_CONTENT = {
  twitterThread: `BrainSNN is an affective-intelligence engine for the AI-generated internet.\n\nPaste a post, ad, email, or script. It detects the emotional payload before it shapes attention, behavior, brand risk, or public perception.\n\nDemo: ${SITE.demoUrl}`,
  hackerNewsTitle: "Show HN: BrainSNN — emotional payload intelligence for online content",
  hackerNewsBody: `BrainSNN analyzes posts, ads, scripts, and messages for emotional payload, persuasion pressure, trust erosion, and public-perception risk.\n\nThe product direction is simple: content should be reviewed for what it does to people, not only what it says.\n\nDemo: ${SITE.demoUrl}\nRepo: ${SITE.repoUrl}`,
  redditML: `BrainSNN: affective-intelligence layer for online content. It maps emotional payloads, persuasion patterns, and brand-risk signals before publication. Demo: ${SITE.demoUrl}`,
  redditR3F: `BrainSNN uses a 3D brain interface to make emotional payload analysis visible to non-technical users. Demo: ${SITE.demoUrl}`,
  launchPlan: `Launch around one clear claim: online content has an emotional payload. BrainSNN detects it before it shapes attention, behavior, brand risk, or public perception.`,
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

**Affective intelligence for the AI internet.**

BrainSNN is an affective-intelligence engine that detects the emotional payload inside online content before it shapes attention, behavior, brand risk, or public perception.

## What it does

- Analyzes posts, ads, emails, scripts, articles, and public narratives
- Detects fear, urgency, outrage, shame, belonging, desire, trust erosion, and manipulation pressure
- Shows evidence behind each score
- Visualizes the reaction through a 3D brain interface
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
