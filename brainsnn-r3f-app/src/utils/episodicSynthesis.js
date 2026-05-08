/**
 * Layer 101 — Episodic Synthesis Engine
 *
 * Two outputs that turn the vault from a graveyard into a thinking
 * partner (cyrilXBT thesis: "a second brain that never talks back is
 * not a second brain"):
 *
 *   dailyBrief(captures, opts)
 *     → { connections, pattern, question }
 *
 *   weeklySynthesis(captures, opts)
 *     → { emergingThesis, contradictions, knowledgeGaps, oneAction }
 *
 * Both have a deterministic local path that uses the BrainSNN signals
 * already attached to every capture (affect, firewall pressure,
 * regions, episodic category, MiniLM embeddings) and an optional
 * Gemma path (Layer 5) when configured. Gemma errors fall back to
 * local — the panel always renders something useful.
 *
 * The Gemma prompts are upgraded versions of the cyrilXBT prompts:
 * they accept BrainSNN signals so the LLM can reference the brain's
 * own measurements ("AMY peaked Wednesday on the @cyrilxbt thread")
 * instead of treating notes as opaque text.
 */

import { mineClusters, findSimilar } from './episodicMemory';
import { EPISODIC_CATEGORIES } from '../data/episodicTaxonomy';
import { isGemmaConfigured } from './gemmaEngine';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- shared helpers ----------

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

function daysAgo(ts) {
  const dd = (Date.now() - ts) / DAY_MS;
  if (dd < 1) return 'today';
  if (dd < 2) return 'yesterday';
  if (dd < 7) return `${Math.floor(dd)}d ago`;
  if (dd < 30) return `${Math.floor(dd / 7)}w ago`;
  return fmtDate(ts);
}

function topN(arr, n, fn) {
  return arr.slice().sort((a, b) => fn(b) - fn(a)).slice(0, n);
}

function quoteSnippet(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function normalizeBucket(captures) {
  // Defensive: drop any malformed entries the panel might have
  return (captures || []).filter((c) => c && c.text && c.id);
}

// ---------- local connection mining ----------

function localConnections(captures, { k = 3 } = {}) {
  const list = normalizeBucket(captures);
  if (list.length < 2) return [];

  // Pass 1 — clustered connections (multi-member threads).
  const clusters = mineClusters(list, { threshold: 0.42 });
  const fromClusters = clusters.slice(0, k).map((cl) => {
    const a = topN(cl.members, 1, (c) => c.firewall?.pressure || 0)[0];
    const others = cl.members.filter((m) => m.id !== a.id);
    const b = topN(others, 1, (c) => c.ts)[0] || others[0];
    const span = cl.tsSpanMs ? `${Math.round(cl.tsSpanMs / DAY_MS)}d span` : 'same day';
    const sharedAffect = sharedAffectLabel([a, b]);
    return {
      kind: 'cluster',
      headline: `${cl.size} notes converge on ${cl.categories.map((x) => x.label.toLowerCase()).join(' + ')}`,
      detail: `"${quoteSnippet(a.title)}" (${daysAgo(a.ts)}) ⇄ "${quoteSnippet(b?.title || '')}" (${daysAgo(b?.ts || a.ts)}) · ${span}${sharedAffect ? ` · shared affect: ${sharedAffect}` : ''}`,
      memberIds: cl.members.map((m) => m.id)
    };
  });

  // Pass 2 — pairwise matches for any newest captures not already covered.
  const covered = new Set();
  fromClusters.forEach((c) => c.memberIds.forEach((id) => covered.add(id)));

  const newest = topN(list, Math.min(8, list.length), (c) => c.ts);
  const pair = [];
  for (const a of newest) {
    if (covered.has(a.id)) continue;
    const sims = findSimilar(a.id, { k: 1, minScore: 0.36 });
    const best = sims[0];
    if (!best || covered.has(best.id)) continue;
    pair.push({
      kind: 'pair',
      headline: `Echo of an older note in "${quoteSnippet(a.title, 60)}"`,
      detail: `"${quoteSnippet(a.title)}" (${daysAgo(a.ts)}) ↔ "${quoteSnippet(best.capture.title)}" (${daysAgo(best.capture.ts)}) · cosine ${best.score.toFixed(2)}`,
      memberIds: [a.id, best.id]
    });
    covered.add(a.id);
    covered.add(best.id);
    if (fromClusters.length + pair.length >= k) break;
  }

  return [...fromClusters, ...pair].slice(0, k);
}

function sharedAffectLabel(members) {
  const tally = {};
  for (const m of members) {
    for (const a of (m.affects?.dominant || [])) {
      tally[a.label] = (tally[a.label] || 0) + a.score;
    }
  }
  const ranked = Object.entries(tally).sort(([, x], [, y]) => y - x);
  const top = ranked[0];
  if (!top || top[1] < 0.4) return null;
  return top[0].toLowerCase();
}

// ---------- local pattern mining ----------

function localPattern(captures) {
  const list = normalizeBucket(captures);
  if (!list.length) return 'Not enough recent captures yet — feed it a few notes first.';

  const catTally = {};
  const affectTally = {};
  const regionTally = {};
  let pressureSum = 0;
  let pressureN = 0;
  for (const c of list) {
    catTally[c.primary] = (catTally[c.primary] || 0) + 1;
    for (const a of (c.affects?.dominant || [])) {
      affectTally[a.label] = (affectTally[a.label] || 0) + a.score;
    }
    for (const [r, v] of Object.entries(c.regions || {})) {
      regionTally[r] = (regionTally[r] || 0) + v;
    }
    if (c.firewall?.pressure != null) {
      pressureSum += c.firewall.pressure;
      pressureN += 1;
    }
  }

  const topCat = Object.entries(catTally).sort(([, a], [, b]) => b - a)[0];
  const topAffect = Object.entries(affectTally).sort(([, a], [, b]) => b - a)[0];
  const topRegion = Object.entries(regionTally).sort(([, a], [, b]) => b - a)[0];
  const meanPressure = pressureN ? pressureSum / pressureN : 0;

  const catLabel = topCat ? EPISODIC_CATEGORIES[topCat[0]]?.label || topCat[0] : 'mixed';
  const affectLabel = topAffect ? topAffect[0].toLowerCase() : 'neutral';
  const regionLabel = topRegion ? topRegion[0] : 'CTX';

  const pressureFrame = meanPressure > 0.45
    ? `mean firewall pressure is high (${Math.round(meanPressure * 100)}%) — manipulative content is leaking into your inputs`
    : meanPressure > 0.25
      ? `mean firewall pressure is mid (${Math.round(meanPressure * 100)}%) — some pressured material in the mix`
      : `mean firewall pressure is low (${Math.round(meanPressure * 100)}%) — clean inputs`;

  return `${list.length} captures over the window. Your brain is mostly in **${catLabel}** mode, with **${affectLabel}** as the dominant affect and **${regionLabel}** as the cortex peak. ${pressureFrame}.`;
}

// ---------- local question generation ----------

function localQuestion(captures) {
  const list = normalizeBucket(captures);
  if (!list.length) return 'What is one thing you have been chewing on but never written down?';

  // Open questions with no follow-up insight in the same week
  const openQs = list.filter((c) => c.primary === 'question');
  const recentInsightTitles = list.filter((c) => c.primary === 'insight').map((c) => c.title.toLowerCase());
  const orphaned = openQs.filter((q) =>
    !recentInsightTitles.some((t) => sharesNgram(t, q.title.toLowerCase(), 4))
  );

  if (orphaned.length) {
    const oldest = orphaned.sort((a, b) => a.ts - b.ts)[0];
    return `Open question from ${daysAgo(oldest.ts)} you never closed: "${quoteSnippet(oldest.title, 160)}" — what do you actually believe now?`;
  }

  // Otherwise: ask about the highest-pressure recent note.
  const hottest = topN(list, 1, (c) => c.firewall?.pressure || 0)[0];
  if (hottest && (hottest.firewall?.pressure || 0) > 0.4) {
    return `You saved "${quoteSnippet(hottest.title, 80)}" (${daysAgo(hottest.ts)}) at ${Math.round(hottest.firewall.pressure * 100)}% manipulation pressure. Do you actually agree with the framing, or did the urgency just bypass you?`;
  }

  // Otherwise: ask about the largest cluster.
  const clusters = mineClusters(list, { threshold: 0.42 });
  const big = clusters[0];
  if (big && big.size >= 2) {
    return `${big.size} notes are clustering around ${big.categories[0]?.label.toLowerCase() || 'a topic'}. What is the single sentence that ties them together?`;
  }

  return 'What is one belief you held a month ago that the last week of inputs would now contradict?';
}

function sharesNgram(a, b, n = 4) {
  const grams = (s) => {
    const out = new Set();
    const tokens = s.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(' '));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  for (const x of A) if (B.has(x)) return true;
  return false;
}

// ---------- weekly synthesis local ----------

function localEmergingThesis(captures) {
  const list = normalizeBucket(captures);
  if (list.length < 3) {
    return 'Vault is still warming up — emerging thesis needs at least 3 captures to triangulate.';
  }

  // Center of gravity = capture with the highest mean cosine to the rest.
  // Falls back to the largest cluster's most-pressured member.
  const clusters = mineClusters(list, { threshold: 0.40 });
  const big = clusters[0];
  if (big) {
    const center = topN(big.members, 1, (c) => c.firewall?.pressure || 0)[0];
    const catLabels = big.categories.map((c) => c.label.toLowerCase()).join(' + ');
    return `Your gravitational center is forming around **${catLabels}**. The anchor: "${quoteSnippet(center.title, 120)}" (${daysAgo(center.ts)}). ${big.size} notes are pulling toward it. The position you have not stated yet is whatever you would write if forced to title that cluster.`;
  }

  const newest = topN(list, 1, (c) => c.ts)[0];
  return `No tight cluster yet — but the most recent move was "${quoteSnippet(newest.title, 120)}". If a thesis is forming, it is upstream of that note.`;
}

function localContradictions(captures) {
  const list = normalizeBucket(captures);
  if (list.length < 2) return [];

  const out = [];
  // Find pairs in same cluster with opposite valence (semantic-similar but
  // emotionally opposite — the shape of a belief in motion).
  const clusters = mineClusters(list, { threshold: 0.40 });
  for (const cl of clusters) {
    const positives = cl.members.filter((m) => (m.affects?.valence || 0) > 0.25);
    const negatives = cl.members.filter((m) => (m.affects?.valence || 0) < -0.25);
    if (positives.length && negatives.length) {
      const a = positives[0];
      const b = negatives[0];
      out.push({
        headline: `Same topic, opposite charge`,
        detail: `Earlier you saved "${quoteSnippet(a.title, 90)}" (valence ${a.affects.valence.toFixed(2)}). Then later "${quoteSnippet(b.title, 90)}" (valence ${b.affects.valence.toFixed(2)}). The brain is rotating around it — which side do you actually hold?`,
        memberIds: [a.id, b.id]
      });
    }
    if (out.length >= 3) break;
  }

  // Decision ↔ Incident in same cluster — a choice followed by something breaking.
  for (const cl of clusters) {
    const dec = cl.members.find((m) => m.primary === 'decision');
    const inc = cl.members.find((m) => m.primary === 'incident');
    if (dec && inc && Math.abs(dec.ts - inc.ts) < 30 * DAY_MS) {
      out.push({
        headline: `Decision shadowed by incident`,
        detail: `Decision "${quoteSnippet(dec.title, 90)}" (${daysAgo(dec.ts)}) and incident "${quoteSnippet(inc.title, 90)}" (${daysAgo(inc.ts)}) are in the same cluster. Was the call wrong, or is this an unrelated cost?`,
        memberIds: [dec.id, inc.id]
      });
    }
    if (out.length >= 3) break;
  }

  return out.slice(0, 3);
}

function localKnowledgeGaps(captures) {
  const list = normalizeBucket(captures);
  if (!list.length) return [];

  const out = [];
  // Open questions older than 7 days without a clearly related insight
  const cutoff = Date.now() - 7 * DAY_MS;
  const openQs = list.filter((c) => c.primary === 'question' && c.ts < cutoff);
  const insightTitles = list.filter((c) => c.primary === 'insight').map((c) => c.title.toLowerCase());

  for (const q of openQs.slice(0, 3)) {
    if (insightTitles.some((t) => sharesNgram(t, q.title.toLowerCase(), 4))) continue;
    out.push({
      headline: `Stale open question`,
      detail: `"${quoteSnippet(q.title, 140)}" — saved ${daysAgo(q.ts)}. No follow-up insight in the vault.`,
      memberIds: [q.id]
    });
  }

  // Orphan high-pressure captures with no neighbors — high signal, low context.
  // Bound the work: take the top 8 highest-pressure candidates first so we
  // don't run findSimilar over the entire list when the corpus is large.
  const candidates = list
    .filter((c) => (c.firewall?.pressure || 0) >= 0.4)
    .sort((a, b) => (b.firewall?.pressure || 0) - (a.firewall?.pressure || 0))
    .slice(0, 8);
  const orphans = candidates.filter((c) => {
    const sims = findSimilar(c.id, { k: 1, minScore: 0.36 });
    return sims.length === 0;
  });
  for (const o of orphans.slice(0, 2)) {
    out.push({
      headline: `High-pressure orphan`,
      detail: `"${quoteSnippet(o.title, 140)}" (${Math.round((o.firewall?.pressure || 0) * 100)}% pressure, ${daysAgo(o.ts)}) is sitting alone — what context would make this make sense?`,
      memberIds: [o.id]
    });
    if (out.length >= 4) break;
  }

  return out.slice(0, 4);
}

function localOneAction(captures) {
  const list = normalizeBucket(captures);
  if (!list.length) return 'Drop your first capture into the panel above. The vault cannot brief you on an empty corpus.';

  const clusters = mineClusters(list, { threshold: 0.42 });
  const big = clusters[0];
  if (big && big.size >= 3) {
    const cat = big.categories[0]?.label || 'recent notes';
    return `Compose one paragraph that titles the ${big.size}-note cluster on **${cat.toLowerCase()}**. If you cannot name it, the position is not real yet.`;
  }

  const hottest = topN(list, 1, (c) => c.firewall?.pressure || 0)[0];
  if (hottest && (hottest.firewall?.pressure || 0) > 0.5) {
    return `Counter-draft "${quoteSnippet(hottest.title, 80)}" — mean pressure is high enough that re-reading the rewrite will tell you whether you actually agreed or just absorbed.`;
  }

  const openQs = list.filter((c) => c.primary === 'question').sort((a, b) => a.ts - b.ts);
  if (openQs.length) {
    return `Sit 10 minutes with "${quoteSnippet(openQs[0].title, 120)}" and answer it in writing. An open question becomes a belief the moment you commit one sentence.`;
  }

  return 'Pick one capture from the last week that you have not re-read since saving. Re-read it. Decide whether to pin it or delete it.';
}

// ---------- Gemma augmentation ----------

function buildGemmaContext(captures, { maxItems = 30, maxChars = 320 } = {}) {
  const list = normalizeBucket(captures).slice(0, maxItems);
  const lines = list.map((c, i) => {
    const cat = EPISODIC_CATEGORIES[c.primary]?.label || c.primary;
    const aff = (c.affects?.dominant || []).slice(0, 2).map((a) => a.label).join('/') || '—';
    const press = Math.round((c.firewall?.pressure || 0) * 100);
    const excerpt = c.text.replace(/\s+/g, ' ').slice(0, maxChars);
    return `[${i + 1}] (${fmtDate(c.ts)} · ${cat} · affect ${aff} · pressure ${press}%) "${c.title}" — ${excerpt}`;
  });
  return lines.join('\n');
}

const BRIEF_SYSTEM = `You are the synthesis voice of BrainSNN's Episodic Cortex (Layer 101). Each note in the vault has been pre-classified with: episodic category (decision/insight/question/artifact/win/project/person/incident), dominant affects, manipulation pressure, and brain-region activation. Use these signals — do not just summarize text.

Return ONLY valid JSON with EXACTLY these fields:
{
  "connections": [ { "headline": "...", "detail": "..." }, ...up to 3 ],
  "pattern": "single-sentence pattern across the window",
  "question": "one question worth sitting with today (not a task)"
}
Be specific. Quote titles. Reference categories or affects when they matter. No markdown fences, no commentary.`;

const SYNTH_SYSTEM = `You are the weekly-synthesis voice of BrainSNN's Episodic Cortex (Layer 101). Use the pre-classified signals on each note (category, affect, pressure, region) — they are not decoration, they are the measurement.

Return ONLY valid JSON with EXACTLY these fields:
{
  "emergingThesis": "what position is forming that the user has not yet stated",
  "contradictions": [ { "headline": "...", "detail": "..." }, ...up to 3 ],
  "knowledgeGaps": [ { "headline": "...", "detail": "..." }, ...up to 3 ],
  "oneAction": "single highest-leverage action this week"
}
Be direct. Challenge. Do not summarize what the user already knows. No markdown fences.`;

async function callGemmaJson(systemPrompt, userPrompt) {
  const ENDPOINT = import.meta.env.VITE_GEMMA_API_ENDPOINT || '';
  const API_KEY = import.meta.env.VITE_GEMMA_API_KEY || '';
  if (!ENDPOINT) throw new Error('Gemma not configured');

  const isGoogle = ENDPOINT.includes('generativelanguage.googleapis.com');
  const url = isGoogle
    ? `${ENDPOINT}${ENDPOINT.includes('?') ? '&' : '?'}key=${API_KEY}`
    : ENDPOINT;
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY && !isGoogle) headers['Authorization'] = `Bearer ${API_KEY}`;

  let body;
  if (isGoogle) {
    body = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1500, responseMimeType: 'application/json' }
    });
  } else {
    body = JSON.stringify({
      model: 'gemma4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 1500
    });
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Gemma ${res.status}`);
  const json = await res.json();
  let raw;
  if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
    raw = json.candidates[0].content.parts[0].text;
  } else if (json.choices?.[0]?.message?.content) {
    raw = json.choices[0].message.content;
  } else {
    throw new Error('Unexpected Gemma response shape');
  }
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  return JSON.parse(cleaned);
}

// ---------- public entrypoints ----------

/**
 * Daily Brief: connections + pattern + question across captures from
 * the last `windowDays` days (default 7 days for connections, 1 day
 * for the pattern feed).
 */
export async function dailyBrief(captures, opts = {}) {
  const { useGemma = isGemmaConfigured(), windowDays = 7 } = opts;
  const list = normalizeBucket(captures).filter((c) => Date.now() - c.ts <= windowDays * DAY_MS);

  // Each section is wrapped so a single bad regex or malformed capture
  // can't tank the whole brief — render whatever sections we can.
  let connections = [];
  let pattern = '';
  let question = '';
  try { connections = localConnections(list, { k: 3 }); } catch (e) { console.warn('[episodicSynthesis] connections failed:', e?.message); }
  try { pattern = localPattern(list); } catch (e) { console.warn('[episodicSynthesis] pattern failed:', e?.message); pattern = 'Pattern unavailable.'; }
  try { question = localQuestion(list); } catch (e) { console.warn('[episodicSynthesis] question failed:', e?.message); question = 'What is one thing you have not written down yet?'; }
  const local = { connections, pattern, question, source: 'local', count: list.length };

  if (!useGemma || list.length < 3) return local;

  try {
    const context = buildGemmaContext(list);
    const userPrompt = `Window: last ${windowDays} days. ${list.length} captures.\n\n${context}\n\nReturn the JSON spec defined in the system prompt.`;
    const out = await callGemmaJson(BRIEF_SYSTEM, userPrompt);
    return {
      connections: Array.isArray(out.connections) ? out.connections.slice(0, 3) : connections,
      pattern: typeof out.pattern === 'string' ? out.pattern : pattern,
      question: typeof out.question === 'string' ? out.question : question,
      source: 'gemma',
      count: list.length
    };
  } catch (err) {
    return { ...local, source: 'local-fallback', gemmaError: String(err?.message || err) };
  }
}

/**
 * Weekly Synthesis: thesis + contradictions + gaps + one action over
 * the last `windowDays` days (default 7).
 */
export async function weeklySynthesis(captures, opts = {}) {
  const { useGemma = isGemmaConfigured(), windowDays = 7 } = opts;
  const list = normalizeBucket(captures).filter((c) => Date.now() - c.ts <= windowDays * DAY_MS);

  let emergingThesis = '';
  let contradictions = [];
  let knowledgeGaps = [];
  let oneAction = '';
  try { emergingThesis = localEmergingThesis(list); } catch (e) { console.warn('[episodicSynthesis] thesis failed:', e?.message); emergingThesis = 'Thesis unavailable for this window.'; }
  try { contradictions = localContradictions(list); } catch (e) { console.warn('[episodicSynthesis] contradictions failed:', e?.message); }
  try { knowledgeGaps = localKnowledgeGaps(list); } catch (e) { console.warn('[episodicSynthesis] gaps failed:', e?.message); }
  try { oneAction = localOneAction(list); } catch (e) { console.warn('[episodicSynthesis] action failed:', e?.message); oneAction = 'Re-read one capture from this week.'; }
  const local = { emergingThesis, contradictions, knowledgeGaps, oneAction, source: 'local', count: list.length };

  if (!useGemma || list.length < 4) return local;

  try {
    const context = buildGemmaContext(list, { maxItems: 40 });
    const userPrompt = `Window: last ${windowDays} days. ${list.length} captures.\n\n${context}\n\nReturn the JSON spec defined in the system prompt.`;
    const out = await callGemmaJson(SYNTH_SYSTEM, userPrompt);
    return {
      emergingThesis: typeof out.emergingThesis === 'string' ? out.emergingThesis : emergingThesis,
      contradictions: Array.isArray(out.contradictions) ? out.contradictions.slice(0, 3) : contradictions,
      knowledgeGaps: Array.isArray(out.knowledgeGaps) ? out.knowledgeGaps.slice(0, 4) : knowledgeGaps,
      oneAction: typeof out.oneAction === 'string' ? out.oneAction : oneAction,
      source: 'gemma',
      count: list.length
    };
  } catch (err) {
    return { ...local, source: 'local-fallback', gemmaError: String(err?.message || err) };
  }
}

/**
 * Lightweight idle-pass synthesis used by Dream Mode.
 *
 * Returns a list of "consolidation pairs" — connections strong enough
 * to STDP-reinforce. Pure local, no LLM, deterministic.
 */
export function consolidationPass(captures, { topK = 3, threshold = 0.45 } = {}) {
  const list = normalizeBucket(captures);
  if (list.length < 2) return [];
  const clusters = mineClusters(list, { threshold });
  const out = [];
  for (const cl of clusters.slice(0, topK)) {
    if (cl.members.length < 2) continue;
    const a = cl.members[0];
    const b = cl.members[1];
    out.push({
      pairIds: [a.id, b.id],
      memberIds: cl.members.map((m) => m.id),
      regionKey: dominantRegionKey(cl.members),
      reason: `co-active in ${cl.size}-note cluster (${cl.categories[0]?.label || ''})`
    });
  }
  return out;
}

function dominantRegionKey(members) {
  const tally = {};
  for (const m of members) {
    for (const [r, v] of Object.entries(m.regions || {})) {
      tally[r] = (tally[r] || 0) + v;
    }
  }
  return Object.entries(tally).sort(([, a], [, b]) => b - a)[0]?.[0] || 'CTX';
}
