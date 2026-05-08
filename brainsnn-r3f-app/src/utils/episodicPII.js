/**
 * Layer 101 — PII / Secret Sniffer
 *
 * Lightweight regex pass that flags captures containing emails, phone
 * numbers, common API-key prefixes, SSN-shaped numbers, and IP
 * addresses. Surfaced as a warning chip on the capture card so the
 * user notices BEFORE the capture sits in localStorage forever or
 * before they hand the bundle to anyone else.
 *
 * Conservative on purpose — false positives are cheap (a chip), false
 * negatives could leak credentials. Patterns are biased toward common
 * shapes; not a substitute for proper secret scanning.
 */

const PATTERNS = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi,
  // Phone: international E.164 + common North American formats
  phone: /(?:(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\b/g,
  // Recognizable secret prefixes — non-exhaustive but catches the
  // ones that most often leak in copy-paste.
  apiKey: /\b(?:sk-[A-Za-z0-9-_]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|hf_[A-Za-z0-9]{30,}|sk_live_[A-Za-z0-9]{20,}|pk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,})\b/g,
  // SSN: XXX-XX-XXXX, with word boundaries
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  // Public IPv4 (simple)
  ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})\b/g,
  // Long base64-ish blobs (40+ chars without whitespace) — catches
  // raw JWTs, signed URLs, etc. We strip `http(s)://` URLs first to
  // reduce false positives.
  longSecret: /\b[A-Za-z0-9+/]{60,}={0,2}\b/g
};

const PII_LABELS = {
  email: 'email',
  phone: 'phone',
  apiKey: 'API key',
  ssn: 'SSN',
  ipv4: 'IP',
  longSecret: 'token-shaped'
};

// Cap output to keep capture records small.
const MAX_HITS_PER_KIND = 5;

function findAll(re, text) {
  const out = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  let safety = 0;
  while ((m = rx.exec(text)) !== null) {
    out.push(m[0]);
    if (out.length >= MAX_HITS_PER_KIND) break;
    if (m.index === rx.lastIndex) rx.lastIndex++;
    if (++safety > 200) break;
  }
  return out;
}

/**
 * Scan text for PII / secret-shaped substrings.
 * Returns { kinds, total, redacted? }.
 *
 *   kinds:  { [kind]: string[] }   — first 5 matches per kind
 *   total:  number                 — total hits across kinds
 *   first:  string|null            — first matched kind (for chip label)
 */
export function detectPII(text) {
  const safe = String(text || '');
  if (safe.length < 4) return { kinds: {}, total: 0, first: null };

  // Strip URLs before running longSecret pattern to reduce FPs.
  const stripped = safe.replace(/\bhttps?:\/\/\S+/g, ' ');

  const kinds = {};
  let total = 0;
  let first = null;
  for (const [k, re] of Object.entries(PATTERNS)) {
    const source = k === 'longSecret' ? stripped : safe;
    const hits = findAll(re, source);
    if (hits.length) {
      kinds[k] = hits;
      total += hits.length;
      if (!first) first = k;
    }
  }
  return { kinds, total, first };
}

export function piiLabel(kind) {
  return PII_LABELS[kind] || kind;
}

/**
 * Redact a capture text in place — replace each match of every
 * detected PII kind with a typed placeholder. Pure helper used by
 * the panel's "Redact PII" button.
 */
export function redactPII(text) {
  let out = String(text || '');
  for (const [k, re] of Object.entries(PATTERNS)) {
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    out = out.replace(rx, `<${piiLabel(k).toUpperCase()}_REDACTED>`);
  }
  return out;
}
