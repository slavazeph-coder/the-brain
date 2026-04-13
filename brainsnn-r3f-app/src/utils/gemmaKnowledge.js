/**
 * Gemma 4 Knowledge Intelligence
 *
 * Wires Gemma 4 into the Knowledge Brain for:
 * - AI-powered gap analysis ("what should I learn next?")
 * - Smart document classification beyond keywords
 * - Learning path generation
 * - Knowledge synthesis from document clusters
 */

import { isGemmaConfigured, analyzeContentWithGemma } from './gemmaEngine';
import { KNOWLEDGE_DOMAINS } from '../data/knowledgeGraph';

const GAP_ANALYSIS_PROMPT = `You are a knowledge gap analysis engine for a second-brain system called BrainSNN.

Given the following knowledge domain map with depth scores (0-1) and topic lists, identify:
1. The most critical knowledge gaps
2. Specific topics to study next
3. Cross-domain connections that are missing
4. A prioritized learning path

Return ONLY valid JSON with this structure:
{
  "criticalGaps": [{"domain": "ID", "gap": "description", "priority": "high|medium"}],
  "learningPath": [{"step": 1, "topic": "...", "domain": "ID", "reason": "..."}],
  "missingConnections": [{"from": "ID", "to": "ID", "suggestion": "..."}],
  "synthesis": "1-2 sentence overall assessment"
}`;

const CLASSIFY_PROMPT = `You are a document classifier for a knowledge management system.

Given a document title and content snippet, classify it into one or more of these domains:
${Object.entries(KNOWLEDGE_DOMAINS).map(([id, d]) => `- ${id}: ${d.name} (${d.role})`).join('\n')}

Return ONLY valid JSON: {"primary": "DOMAIN_ID", "secondary": "DOMAIN_ID_OR_NULL", "confidence": 0.0-1.0, "topics": ["extracted", "topics"]}`;

// ---------- AI Gap Analysis ----------

export async function analyzeGapsWithGemma(knowledgeMap) {
  if (!isGemmaConfigured()) {
    throw new Error('Gemma API not configured');
  }

  const domainSummary = Object.entries(knowledgeMap).map(([id, data]) => {
    const domain = KNOWLEDGE_DOMAINS[id];
    return `${id} (${domain?.name}): depth=${(data.depth * 100).toFixed(0)}%, docs=${data.count}, topics=[${(data.topics || []).slice(0, 8).join(', ')}]`;
  }).join('\n');

  const prompt = `${GAP_ANALYSIS_PROMPT}\n\nCurrent knowledge map:\n${domainSummary}`;

  // Reuse the Gemma engine but with a custom prompt
  const result = await callGemmaRaw(prompt);
  return result;
}

// ---------- AI Document Classification ----------

export async function classifyWithGemma(title, contentSnippet = '') {
  if (!isGemmaConfigured()) return null;

  const prompt = `${CLASSIFY_PROMPT}\n\nDocument: "${title}"\nContent: "${contentSnippet.slice(0, 500)}"`;
  return callGemmaRaw(prompt);
}

// ---------- Learning Path Generation ----------

export async function generateLearningPath(knowledgeMap, goals = '') {
  if (!isGemmaConfigured()) {
    throw new Error('Gemma API not configured');
  }

  const domainSummary = Object.entries(knowledgeMap).map(([id, data]) => {
    const domain = KNOWLEDGE_DOMAINS[id];
    return `${id} (${domain?.name}): depth=${(data.depth * 100).toFixed(0)}%`;
  }).join(', ');

  const prompt = `Given this knowledge map: ${domainSummary}
${goals ? `User's learning goals: ${goals}` : 'No specific goals — optimize for balanced growth.'}

Generate a 5-step learning path. Return ONLY valid JSON:
[{"step": 1, "topic": "...", "domain": "DOMAIN_ID", "reason": "...", "resources": ["suggested resource type"]}]`;

  return callGemmaRaw(prompt);
}

// ---------- Internal helper ----------

async function callGemmaRaw(prompt) {
  // Use the existing Gemma engine infrastructure
  const { analyzeContentWithGemma: analyze } = await import('./gemmaEngine');
  // We're repurposing the text analysis endpoint with a custom prompt
  // The engine will send this as the user message
  const ENDPOINT = import.meta.env.VITE_GEMMA_API_ENDPOINT || '';
  const API_KEY = import.meta.env.VITE_GEMMA_API_KEY || '';
  const isGoogleAI = ENDPOINT.includes('generativelanguage.googleapis.com');

  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY && !isGoogleAI) headers['Authorization'] = `Bearer ${API_KEY}`;
  const url = isGoogleAI ? `${ENDPOINT}${ENDPOINT.includes('?') ? '&' : '?'}key=${API_KEY}` : ENDPOINT;

  let body;
  if (isGoogleAI) {
    body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json' }
    });
  } else {
    body = JSON.stringify({
      model: 'gemma4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3, max_tokens: 2048
    });
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Gemma API ${res.status}`);
  const json = await res.json();

  let raw;
  if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
    raw = json.candidates[0].content.parts[0].text;
  } else if (json.choices?.[0]?.message?.content) {
    raw = json.choices[0].message.content;
  } else {
    throw new Error('Unexpected Gemma response');
  }

  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  return JSON.parse(cleaned);
}

// ---------- Availability check ----------

export function isGemmaKnowledgeAvailable() {
  return isGemmaConfigured();
}
