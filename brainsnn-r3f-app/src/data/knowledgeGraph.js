/**
 * Knowledge Brain — Data Model
 *
 * Maps the BrainSNN 7-region architecture to a knowledge domain graph.
 * Each "region" becomes a knowledge domain. Pathways become cross-domain
 * connections. Activity = knowledge depth. Weights = connection strength.
 *
 * Follows Karpathy's LLM-Wiki organizing framework:
 *   - Core domains with defined scope
 *   - Cross-domain links that show how knowledge areas reinforce each other
 *   - Depth scoring (0-1) per domain based on document count, freshness, coverage
 *   - Gap detection when domains fall below threshold
 */

// ---------- Knowledge domains (maps 1:1 to brain regions) ----------

export const KNOWLEDGE_DOMAINS = {
  CTX: {
    name: 'Architecture & Systems',
    role: 'High-level system design, infrastructure, distributed systems, data pipelines.',
    color: '#4fa8b3',
    keywords: ['architecture', 'system', 'infrastructure', 'pipeline', 'distributed', 'microservice', 'api', 'server', 'deploy', 'docker', 'kubernetes'],
    wikiSection: 'systems'
  },
  HPC: {
    name: 'Memory & Knowledge Base',
    role: 'Personal notes, references, bookmarks, research papers, learning logs.',
    color: '#fdab43',
    keywords: ['note', 'reference', 'bookmark', 'paper', 'research', 'learn', 'study', 'memory', 'wiki', 'documentation'],
    wikiSection: 'knowledge'
  },
  THL: {
    name: 'Input & Ingestion',
    role: 'News feeds, RSS, social media, email digests, information intake patterns.',
    color: '#6daa45',
    keywords: ['feed', 'news', 'rss', 'email', 'social', 'intake', 'read', 'consume', 'source', 'stream'],
    wikiSection: 'inputs'
  },
  AMY: {
    name: 'Risk & Security',
    role: 'Threat models, vulnerabilities, compliance, safety, cognitive security.',
    color: '#dd6974',
    keywords: ['security', 'risk', 'threat', 'vulnerability', 'compliance', 'safety', 'audit', 'firewall', 'privacy', 'encryption'],
    wikiSection: 'security'
  },
  BG: {
    name: 'Business & Strategy',
    role: 'Market analysis, monetization, competitive intelligence, growth strategy.',
    color: '#5591c7',
    keywords: ['business', 'strategy', 'market', 'revenue', 'growth', 'competition', 'pricing', 'customer', 'product', 'roadmap'],
    wikiSection: 'business'
  },
  PFC: {
    name: 'AI & Machine Learning',
    role: 'Models, training, inference, prompts, agents, LLMs, embeddings, fine-tuning.',
    color: '#a86fdf',
    keywords: ['ai', 'ml', 'model', 'llm', 'prompt', 'agent', 'training', 'inference', 'embedding', 'transformer', 'neural', 'gpt', 'claude', 'gemma'],
    wikiSection: 'ai-ml'
  },
  CBL: {
    name: 'Tools & Workflows',
    role: 'CLI tools, IDE configs, automation scripts, CI/CD, developer productivity.',
    color: '#d19900',
    keywords: ['tool', 'workflow', 'cli', 'ide', 'automation', 'script', 'ci', 'cd', 'git', 'build', 'test', 'lint'],
    wikiSection: 'tooling'
  }
};

// Cross-domain knowledge connections (maps to LINKS)
export const KNOWLEDGE_LINKS = [
  ['THL', 'CTX', 'Ingested info feeds into system design'],
  ['CTX', 'HPC', 'Architecture decisions stored as knowledge'],
  ['HPC', 'CTX', 'Past knowledge informs new architecture'],
  ['CTX', 'PFC', 'Systems thinking enhances AI work'],
  ['PFC', 'CTX', 'AI capabilities shape system design'],
  ['CTX', 'AMY', 'System design considers security risks'],
  ['AMY', 'BG', 'Risk awareness shapes business strategy'],
  ['BG', 'THL', 'Business needs drive information intake'],
  ['CBL', 'CTX', 'Tools enable architecture implementation'],
  ['PFC', 'HPC', 'AI research stored in knowledge base']
];

// ---------- LLM-Wiki template (Karpathy-style) ----------

export const LLM_WIKI_TEMPLATE = {
  title: 'Knowledge Brain Wiki',
  description: 'Structured knowledge map organized by domain, following the LLM-Wiki framework.',
  domains: Object.entries(KNOWLEDGE_DOMAINS).map(([key, domain]) => ({
    id: key,
    section: domain.wikiSection,
    name: domain.name,
    description: domain.role,
    topics: [],       // filled by scanner
    documentCount: 0, // filled by scanner
    depth: 0,         // 0-1 score
    lastUpdated: null,
    gaps: []          // identified by gap detector
  }))
};

// ---------- Classify content into domains ----------

export function classifyContent(text) {
  const lower = text.toLowerCase();
  const scores = {};

  for (const [domainId, domain] of Object.entries(KNOWLEDGE_DOMAINS)) {
    let matchCount = 0;
    for (const kw of domain.keywords) {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      const matches = lower.match(regex);
      if (matches) matchCount += matches.length;
    }
    scores[domainId] = matchCount;
  }

  // Normalize to 0-1
  const max = Math.max(...Object.values(scores), 1);
  for (const k of Object.keys(scores)) {
    scores[k] = parseFloat((scores[k] / max).toFixed(3));
  }

  // Primary domain
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = sorted[0][1] > 0 ? sorted[0][0] : null;
  const secondary = sorted[1]?.[1] > 0.3 ? sorted[1][0] : null;

  return { scores, primary, secondary };
}

// ---------- Compute knowledge depth from document inventory ----------

export function computeKnowledgeDepth(documents, domain) {
  if (!documents?.length) return { depth: 0, freshness: 0, coverage: 0, count: 0 };

  const domainDocs = documents.filter((d) => d.domain === domain.id || d.domains?.includes(domain.id));
  const count = domainDocs.length;
  if (count === 0) return { depth: 0, freshness: 0, coverage: 0, count: 0 };

  // Count-based depth (log scale, caps at ~50 docs)
  const countScore = Math.min(1, Math.log(count + 1) / Math.log(51));

  // Freshness: how recently was the domain updated?
  const now = Date.now();
  const newest = Math.max(...domainDocs.map((d) => d.lastModified || 0));
  const daysSinceUpdate = (now - newest) / (1000 * 60 * 60 * 24);
  const freshness = Math.max(0, 1 - daysSinceUpdate / 90); // decays over 90 days

  // Keyword coverage
  const allText = domainDocs.map((d) => d.content || d.title || '').join(' ').toLowerCase();
  const covered = domain.keywords.filter((kw) => allText.includes(kw)).length;
  const coverage = covered / Math.max(domain.keywords.length, 1);

  const depth = parseFloat((countScore * 0.3 + freshness * 0.35 + coverage * 0.35).toFixed(3));

  return { depth, freshness: parseFloat(freshness.toFixed(3)), coverage: parseFloat(coverage.toFixed(3)), count };
}

// ---------- Map knowledge state to brain regions ----------

export function knowledgeToBrainState(knowledgeMap) {
  const regions = {};
  const weights = {};

  for (const [domainId] of Object.entries(KNOWLEDGE_DOMAINS)) {
    regions[domainId] = knowledgeMap[domainId]?.depth ?? 0.1;
  }

  // Connection weights based on co-occurrence of cross-domain docs
  for (const [from, to] of KNOWLEDGE_LINKS) {
    const key = `${from}→${to}`;
    const fromDepth = regions[from] || 0;
    const toDepth = regions[to] || 0;
    weights[key] = parseFloat((fromDepth * toDepth * 0.9 + 0.08).toFixed(3));
  }

  return { regions, weights, scenario: 'Knowledge Brain' };
}
