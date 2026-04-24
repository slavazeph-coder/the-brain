/**
 * Layer 85 — Journalism Bulk Mode
 *
 * Upload a CSV or JSON array of records. For each row, locate the
 * text-bearing column (auto-detected from headers: text, content,
 * body, message, tweet, post) and score it through the Firewall.
 *
 * Output: aggregate stats + a new CSV / JSON with pressure + templates
 * appended as new columns. Lets reporters run a thousand Twitter
 * posts, an email archive, or a Reddit scrape through the scanner
 * without scripting.
 */

import { scoreContent } from './cognitiveFirewall';
import { detectArchetypes } from './adTransparency';

function pressureOf(s) {
  return (s.emotionalActivation + s.cognitiveSuppression + s.manipulationPressure) / 3;
}

const TEXT_COL_CANDIDATES = ['text', 'content', 'body', 'message', 'tweet', 'post', 'status', 'article', 'comment'];

function parseCsv(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { headers: [], rows: [] };
  const lines = [];
  // Simple CSV: handles quoted fields with escaped quotes
  let i = 0;
  while (i < text.length) {
    const row = [];
    let field = '';
    let inQuote = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuote) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (c === '"') { inQuote = false; i++; continue; }
        field += c; i++;
      } else {
        if (c === '"') { inQuote = true; i++; continue; }
        if (c === ',') { row.push(field); field = ''; i++; continue; }
        if (c === '\n') { row.push(field); field = ''; i++; break; }
        field += c; i++;
      }
    }
    if (field || row.length) row.push(field);
    lines.push(row);
  }
  const headers = lines[0] || [];
  const rows = lines.slice(1).filter((r) => r.length && r.some((x) => x !== ''));
  return { headers, rows };
}

function parseJson(raw) {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('JSON must be an array of objects');
  const headerSet = new Set();
  for (const row of data) {
    if (row && typeof row === 'object') for (const k of Object.keys(row)) headerSet.add(k);
  }
  const headers = [...headerSet];
  const rows = data.map((row) => headers.map((h) => {
    const v = row?.[h];
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }));
  return { headers, rows };
}

export function detectInputFormat(raw) {
  const t = String(raw || '').trim();
  if (!t) return 'empty';
  if (t.startsWith('[') || t.startsWith('{')) return 'json';
  return 'csv';
}

function findTextColumn(headers) {
  for (const cand of TEXT_COL_CANDIDATES) {
    const idx = headers.findIndex((h) => h.toLowerCase().trim() === cand);
    if (idx !== -1) return idx;
  }
  // Fall back to the longest-labeled column — "Tweet text" etc.
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].length > bestLen) { best = i; bestLen = headers[i].length; }
  }
  return best;
}

export function parseInput(raw) {
  const format = detectInputFormat(raw);
  if (format === 'empty') return { format, headers: [], rows: [] };
  if (format === 'json') {
    const out = parseJson(raw);
    return { format, ...out };
  }
  const out = parseCsv(raw);
  return { format, ...out };
}

export function analyzeBatch({ headers, rows, textIndex = null }) {
  const textIdx = textIndex ?? findTextColumn(headers);
  if (textIdx < 0) throw new Error('could not find a text column');
  const colName = headers[textIdx] || 'text';
  const scored = rows.map((r, idx) => {
    const t = String(r[textIdx] ?? '').slice(0, 6000);
    const s = scoreContent(t);
    const pressure = pressureOf(s);
    const archetypes = detectArchetypes(s.templates || []);
    return {
      idx,
      original: r,
      text: t,
      pressure: +pressure.toFixed(3),
      emotionalActivation: +(s.emotionalActivation || 0).toFixed(3),
      cognitiveSuppression: +(s.cognitiveSuppression || 0).toFixed(3),
      manipulationPressure: +(s.manipulationPressure || 0).toFixed(3),
      trustErosion: +(s.trustErosion || 0).toFixed(3),
      templates: (s.templates || []).map((x) => x.id),
      archetypes: archetypes.map((x) => x.id),
      language: s.language || 'en',
    };
  });

  const sum = { e: 0, c: 0, m: 0, u: 0, p: 0 };
  for (const row of scored) {
    sum.e += row.emotionalActivation;
    sum.c += row.cognitiveSuppression;
    sum.m += row.manipulationPressure;
    sum.u += row.trustErosion;
    sum.p += row.pressure;
  }
  const n = Math.max(1, scored.length);
  const high = scored.filter((x) => x.pressure >= 0.55).length;
  const topTemplate = (() => {
    const counts = {};
    for (const r of scored) for (const t of r.templates) counts[t] = (counts[t] || 0) + 1;
    const e = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return e ? { id: e[0], n: e[1] } : null;
  })();

  return {
    textColumn: colName,
    textIndex: textIdx,
    rowCount: scored.length,
    meanPressure: sum.p / n,
    meanEmo: sum.e / n,
    meanCog: sum.c / n,
    meanMan: sum.m / n,
    meanTrust: sum.u / n,
    highPressureCount: high,
    topTemplate,
    results: scored,
  };
}

export function exportEnriched({ format, headers, analysis }) {
  const extraHeaders = [
    'bsnn_pressure',
    'bsnn_emotionalActivation',
    'bsnn_cognitiveSuppression',
    'bsnn_manipulationPressure',
    'bsnn_trustErosion',
    'bsnn_templates',
    'bsnn_archetypes',
    'bsnn_language',
  ];

  if (format === 'json') {
    const enriched = analysis.results.map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r.original[i]; });
      obj.bsnn_pressure = r.pressure;
      obj.bsnn_emotionalActivation = r.emotionalActivation;
      obj.bsnn_cognitiveSuppression = r.cognitiveSuppression;
      obj.bsnn_manipulationPressure = r.manipulationPressure;
      obj.bsnn_trustErosion = r.trustErosion;
      obj.bsnn_templates = r.templates;
      obj.bsnn_archetypes = r.archetypes;
      obj.bsnn_language = r.language;
      return obj;
    });
    return JSON.stringify(enriched, null, 2);
  }

  const escape = (s) => {
    const str = String(s ?? '').replace(/"/g, '""');
    return /["\n,]/.test(str) ? `"${str}"` : str;
  };
  const out = [[...headers, ...extraHeaders].map(escape).join(',')];
  for (const r of analysis.results) {
    const row = [
      ...r.original,
      r.pressure,
      r.emotionalActivation,
      r.cognitiveSuppression,
      r.manipulationPressure,
      r.trustErosion,
      r.templates.join(';'),
      r.archetypes.join(';'),
      r.language,
    ];
    out.push(row.map(escape).join(','));
  }
  return out.join('\n');
}
