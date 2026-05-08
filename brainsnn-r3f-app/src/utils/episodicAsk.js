/**
 * Layer 101 — Ask the Vault
 *
 * Natural-language Q&A over the Episodic Cortex. Embeds the question
 * (MiniLM, Layer 24), runs cosine retrieval over the capture log,
 * builds a context block of top-K hits with their pre-computed
 * BrainSNN signals, and either:
 *   - returns the ranked hits + a deterministic local answer
 *     (composed from the hits + their categories + affects), or
 *   - routes the context through Gemma when configured.
 *
 * Falls back to trigram-Jaccard retrieval when embeddings aren't
 * warm. Always returns the same shape so the UI doesn't branch.
 */

import { embed, isReady as embeddingsReady, cosineSimilarity } from './embeddings';
import { getCaptures, getEmbeddingFor } from './episodicMemory';
import { EPISODIC_CATEGORIES } from '../data/episodicTaxonomy';
import { isGemmaConfigured } from './gemmaEngine';

const TOP_K = 6;
const MIN_COSINE = 0.32;

function fmtDate(ts) { return new Date(ts).toISOString().slice(0, 10); }

function trigrams(s) {
  const out = new Set();
  const t = String(s || '').toLowerCase().replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function askTheVault(question, opts = {}) {
  const q = String(question || '').trim();
  if (q.length < 3) return { ok: false, reason: 'question-too-short' };

  const list = getCaptures();
  if (!list.length) return { ok: false, reason: 'empty-vault' };

  // 1) embed the question if possible
  let qVec = null;
  if (embeddingsReady()) {
    try { qVec = await embed(q); } catch { /* fall through */ }
  }

  // 2) score every capture
  const qGrams = trigrams(q);
  const scored = [];
  for (const c of list) {
    let score;
    const cVec = getEmbeddingFor(c.hash);
    if (qVec && cVec) {
      score = cosineSimilarity(qVec, cVec);
    } else {
      score = jaccard(qGrams, trigrams(`${c.title} ${c.text}`));
    }
    if (score >= MIN_COSINE) scored.push({ score, capture: c });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, TOP_K);

  if (!hits.length) {
    return {
      ok: true,
      hits: [],
      answer: 'Nothing in the vault matches that question yet — capture more on this thread first.',
      source: 'local',
      mode: qVec ? 'cosine' : 'lexical'
    };
  }

  // 3) compose a deterministic local answer from the hits
  const local = composeLocalAnswer(q, hits);

  // 4) optionally upgrade through Gemma
  if (opts.useGemma === false || !isGemmaConfigured()) {
    return { ok: true, hits, answer: local, source: 'local', mode: qVec ? 'cosine' : 'lexical' };
  }
  try {
    const gemma = await callGemmaAnswer(q, hits);
    return { ok: true, hits, answer: gemma, source: 'gemma', mode: qVec ? 'cosine' : 'lexical' };
  } catch (err) {
    return { ok: true, hits, answer: local, source: 'local-fallback', gemmaError: String(err?.message || err) };
  }
}

function composeLocalAnswer(question, hits) {
  const lines = [];
  lines.push(`The vault holds ${hits.length} note${hits.length === 1 ? '' : 's'} that touch this question.`);

  const catTally = {};
  for (const h of hits) {
    catTally[h.capture.primary] = (catTally[h.capture.primary] || 0) + 1;
  }
  const topCat = Object.entries(catTally).sort(([, a], [, b]) => b - a)[0];
  if (topCat) {
    const label = EPISODIC_CATEGORIES[topCat[0]]?.label || topCat[0];
    lines.push(`Most are tagged **${label.toLowerCase()}** (${topCat[1]}/${hits.length}).`);
  }

  const press = hits.reduce((s, h) => s + (h.capture.firewall?.pressure || 0), 0) / hits.length;
  if (press > 0.4) {
    lines.push(`Mean firewall pressure across the hits is ${Math.round(press * 100)}% — re-read with that bias in mind.`);
  }

  const top = hits[0];
  if (top) {
    lines.push(`Top hit: "${top.capture.title}" (${fmtDate(top.capture.ts)}, score ${top.score.toFixed(2)}).`);
  }
  return lines.join(' ');
}

async function callGemmaAnswer(question, hits) {
  const ENDPOINT = import.meta.env.VITE_GEMMA_API_ENDPOINT || '';
  const API_KEY = import.meta.env.VITE_GEMMA_API_KEY || '';
  if (!ENDPOINT) throw new Error('Gemma not configured');

  const isGoogle = ENDPOINT.includes('generativelanguage.googleapis.com');
  const url = isGoogle
    ? `${ENDPOINT}${ENDPOINT.includes('?') ? '&' : '?'}key=${API_KEY}`
    : ENDPOINT;
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY && !isGoogle) headers['Authorization'] = `Bearer ${API_KEY}`;

  const system = `You are answering a question against the user's BrainSNN Episodic Cortex (Layer 101). Each retrieved note carries category, dominant affects, manipulation pressure, and a date. Quote titles. Be specific. If the corpus does not actually answer the question, say so. No markdown fences. 2-4 sentences.`;
  const ctx = hits.map((h, i) => {
    const c = h.capture;
    const cat = EPISODIC_CATEGORIES[c.primary]?.label || c.primary;
    const aff = (c.affects?.dominant || []).slice(0, 2).map((a) => a.label).join('/') || '—';
    const press = Math.round((c.firewall?.pressure || 0) * 100);
    const excerpt = c.text.replace(/\s+/g, ' ').slice(0, 320);
    return `[${i + 1}] (score ${h.score.toFixed(2)} · ${fmtDate(c.ts)} · ${cat} · affect ${aff} · pressure ${press}%) "${c.title}" — ${excerpt}`;
  }).join('\n');
  const userPrompt = `Question: ${question}\n\nRetrieved captures:\n${ctx}\n\nAnswer the question grounded in those captures.`;

  let body;
  if (isGoogle) {
    body = JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
    });
  } else {
    body = JSON.stringify({
      model: 'gemma4',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 800
    });
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Gemma ${res.status}`);
  const json = await res.json();
  if (json.candidates?.[0]?.content?.parts?.[0]?.text) return json.candidates[0].content.parts[0].text.trim();
  if (json.choices?.[0]?.message?.content) return json.choices[0].message.content.trim();
  throw new Error('Unexpected Gemma response shape');
}
