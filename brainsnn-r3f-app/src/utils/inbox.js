/**
 * Layer 44 — Inbox Mode
 *
 * Bulk-paste emails, DMs, Slack messages, support tickets — anything
 * with repeated sender/subject delimiters — and get a manipulation-
 * ranked list. Shareable anonymized summary (/n/<hash>).
 *
 * Accepted item delimiters (any of these on its own line splits items):
 *   ---
 *   ===
 *   From: <sender>
 *   Subject: <subject>
 */

import { scoreContent } from './cognitiveFirewall';

function extractHeader(block, key) {
  const re = new RegExp(`^\\s*${key}\\s*[:：]\\s*(.+)$`, 'im');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function splitItems(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  // Primary split: --- or === lines
  const hardSplit = text.split(/\n[\-=]{3,}\n+/);
  if (hardSplit.length > 1) return hardSplit.map((b) => b.trim()).filter(Boolean);

  // Secondary: message boundary is a blank line followed by From:
  const parts = text.split(/\n{2,}(?=From:|FROM:)/);
  if (parts.length > 1) return parts.map((b) => b.trim()).filter(Boolean);

  // Tertiary: blank-line-separated blocks
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks;
}

function pressureOf(score) {
  return (score.emotionalActivation + score.cognitiveSuppression + score.manipulationPressure) / 3;
}

/**
 * Parse + score. Returns [{idx,from,subject,text,pressure,templates}]
 * sorted by pressure descending.
 */
export function analyzeInbox(raw = '') {
  const blocks = splitItems(raw);
  if (!blocks.length) return [];
  const items = blocks.map((block, idx) => {
    const from = extractHeader(block, 'From') || extractHeader(block, 'Sender') || '';
    const subject = extractHeader(block, 'Subject') || extractHeader(block, 'Re') || '';
    // Strip header lines from body so they don't double-count
    const text = block
      .split('\n')
      .filter((l) => !/^\s*(From|Subject|Sender|To|Cc|Bcc|Date|Re)\s*[:：]/i.test(l))
      .join('\n')
      .trim() || block.trim();
    const score = scoreContent(text);
    return {
      idx,
      from,
      subject,
      text,
      pressure: pressureOf(score),
      templates: score.templates || [],
      recommendedAction: score.recommendedAction || '',
    };
  });
  items.sort((a, b) => b.pressure - a.pressure);
  return items;
}

export function inboxSummary(items) {
  if (!items.length) return { count: 0, meanPressure: 0, high: 0, worst: null };
  const meanPressure = items.reduce((acc, v) => acc + v.pressure, 0) / items.length;
  const high = items.filter((i) => i.pressure >= 0.55).length;
  const worst = items[0];
  return { count: items.length, meanPressure, high, worst };
}

// ---------- share payload (Layer 44 /n/<hash>) -------------------------

function b64urlEncode(str) {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(str, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof window !== 'undefined' && typeof window.atob === 'function') return window.atob(base);
  return Buffer.from(base, 'base64').toString('utf-8');
}

function redactFrom(from) {
  // Keep domain, replace localpart with dots
  const m = (from || '').match(/^.*?([a-z0-9._-]+)@([a-z0-9.-]+).*$/i);
  if (m) return `***@${m[2]}`;
  return (from || '').slice(0, 2) + '***';
}

const MAX_TOP = 5;
const MAX_TITLE = 48;

export function buildInboxPayload({ title, items }) {
  const summary = inboxSummary(items);
  const top = items.slice(0, MAX_TOP).map((it) => ({
    f: redactFrom(it.from),
    s: (it.subject || '').slice(0, 40),
    p: +(it.pressure).toFixed(3),
    tpl: (it.templates || []).slice(0, 2).map((t) => t.label).join(','),
  }));
  return {
    ttl: String(title || 'Inbox triage').slice(0, MAX_TITLE),
    n: summary.count,
    mp: +(summary.meanPressure).toFixed(3),
    hi: summary.high,
    top,
    ts: Date.now(),
  };
}

export function encodeInbox(p) {
  try { return b64urlEncode(JSON.stringify(p)); } catch { return ''; }
}

export function decodeInbox(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      title: p.ttl || 'Inbox triage',
      count: p.n || 0,
      meanPressure: p.mp || 0,
      high: p.hi || 0,
      top: p.top || [],
      ts: p.ts || 0,
    };
  } catch { return null; }
}

export function inboxUrl(origin, payload) {
  return `${origin}/n/${encodeInbox(payload)}`;
}

export const INBOX_EXAMPLE = `From: hr@example.com
Subject: URGENT — action required by EOD
Please sign the attached policy today. This is not optional. We need 100% compliance, no exceptions.

---

From: coworker@example.com
Subject: Re: lunch?
Hey! Any interest in grabbing lunch at the new place on Wednesday? No pressure if you're busy.

---

From: vendor@example.com
Subject: Last chance — offer expires tonight
Limited time — only a few spots left! Thousands already signed up. Don't miss out. Act now.

---

From: friend@example.com
Subject: Weekend
Raincheck on Saturday? I got called in to work a shift. Sunday still works if you're around.`;
