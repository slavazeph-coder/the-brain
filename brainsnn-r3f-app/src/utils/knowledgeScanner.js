/**
 * Knowledge Scanner
 *
 * Scans a file inventory (provided as JSON or manually entered)
 * to build a knowledge map. In a Claude Code context, this would
 * scan the actual file system. In the browser, it accepts:
 *   - Pasted file lists (path + title per line)
 *   - Uploaded JSON inventories
 *   - Manual topic entries
 *
 * Outputs a knowledge map: { [domainId]: { depth, count, topics, gaps, freshness } }
 */

import { KNOWLEDGE_DOMAINS, classifyContent, computeKnowledgeDepth } from '../data/knowledgeGraph';

// ---------- Parse file inventory ----------

/**
 * Parse a text block of file paths / titles into document entries.
 * Accepts formats:
 *   path/to/file.md
 *   path/to/file.md | Title of document
 *   path/to/file.md | Title | 2024-01-15
 */
export function parseFileInventory(text) {
  return text.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim());
      const path = parts[0] || '';
      const title = parts[1] || path.split('/').pop()?.replace(/\.\w+$/, '') || path;
      const dateStr = parts[2] || '';
      const lastModified = dateStr ? new Date(dateStr).getTime() : Date.now();

      return { path, title, content: title + ' ' + path, lastModified };
    });
}

/**
 * Parse a JSON array of document objects.
 * Expected shape: [{ path, title, content?, lastModified?, tags? }]
 */
export function parseJSONInventory(jsonStr) {
  const arr = JSON.parse(jsonStr);
  if (!Array.isArray(arr)) throw new Error('Expected JSON array');
  return arr.map((item) => ({
    path: item.path || '',
    title: item.title || item.name || '',
    content: item.content || item.title || '',
    lastModified: item.lastModified || item.modified || Date.now(),
    tags: item.tags || []
  }));
}

// ---------- Classify documents into domains ----------

export function classifyDocuments(documents) {
  return documents.map((doc) => {
    const text = [doc.title, doc.content, doc.path, ...(doc.tags || [])].join(' ');
    const { scores, primary, secondary } = classifyContent(text);
    return {
      ...doc,
      domain: primary,
      domains: [primary, secondary].filter(Boolean),
      domainScores: scores
    };
  });
}

// ---------- Build full knowledge map ----------

export function buildKnowledgeMap(documents) {
  const classified = classifyDocuments(documents);
  const map = {};

  for (const [domainId, domain] of Object.entries(KNOWLEDGE_DOMAINS)) {
    const domainObj = { id: domainId, ...domain };
    const { depth, freshness, coverage, count } = computeKnowledgeDepth(classified, domainObj);
    const domainDocs = classified.filter((d) => d.domain === domainId);

    // Extract unique topics from document titles
    const topics = [...new Set(domainDocs.map((d) => d.title))].slice(0, 15);

    map[domainId] = {
      depth,
      freshness,
      coverage,
      count,
      topics,
      name: domain.name,
      color: domain.color
    };
  }

  return { map, documents: classified, totalDocs: documents.length };
}

// ---------- Gap detection ----------

const GAP_THRESHOLD = 0.3;
const STALE_DAYS = 30;

export function detectGaps(knowledgeMap) {
  const gaps = [];

  for (const [domainId, data] of Object.entries(knowledgeMap)) {
    const domain = KNOWLEDGE_DOMAINS[domainId];
    if (!domain) continue;

    if (data.depth < GAP_THRESHOLD) {
      gaps.push({
        domain: domainId,
        name: domain.name,
        type: 'shallow',
        severity: data.depth < 0.1 ? 'critical' : 'moderate',
        message: `${domain.name} has very low knowledge depth (${(data.depth * 100).toFixed(0)}%). Consider adding more resources.`,
        suggestion: `Add documents about: ${domain.keywords.slice(0, 5).join(', ')}`
      });
    }

    if (data.count > 0 && data.freshness < 0.3) {
      gaps.push({
        domain: domainId,
        name: domain.name,
        type: 'stale',
        severity: 'moderate',
        message: `${domain.name} knowledge is getting stale (freshness ${(data.freshness * 100).toFixed(0)}%).`,
        suggestion: `Review and update recent developments in ${domain.name.toLowerCase()}.`
      });
    }

    if (data.count > 0 && data.coverage < 0.4) {
      gaps.push({
        domain: domainId,
        name: domain.name,
        type: 'narrow',
        severity: 'moderate',
        message: `${domain.name} coverage is narrow — only ${(data.coverage * 100).toFixed(0)}% of key topics covered.`,
        suggestion: `Broaden knowledge with topics: ${domain.keywords.filter((kw) => {
          const topics = (data.topics || []).join(' ').toLowerCase();
          return !topics.includes(kw);
        }).slice(0, 4).join(', ')}`
      });
    }
  }

  return gaps.sort((a, b) => {
    const sev = { critical: 0, moderate: 1 };
    return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
  });
}

// ---------- Self-learning suggestions ----------

export function generateLearningSuggestions(gaps, knowledgeMap) {
  const suggestions = [];

  // Priority: critical gaps first
  for (const gap of gaps.slice(0, 5)) {
    suggestions.push({
      domain: gap.domain,
      priority: gap.severity === 'critical' ? 'high' : 'medium',
      action: gap.suggestion,
      reason: gap.message
    });
  }

  // Cross-domain: if two connected domains are both weak, suggest bridging
  const weakDomains = Object.entries(knowledgeMap)
    .filter(([, data]) => data.depth < 0.35)
    .map(([id]) => id);

  if (weakDomains.length >= 2) {
    suggestions.push({
      domain: 'cross-domain',
      priority: 'high',
      action: `Bridge knowledge gap between ${weakDomains.slice(0, 3).map((d) => KNOWLEDGE_DOMAINS[d]?.name || d).join(' and ')}`,
      reason: 'Multiple connected domains are weak, creating a systemic knowledge gap.'
    });
  }

  return suggestions;
}
