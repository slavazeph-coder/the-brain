/**
 * Veea Lobster Trap — deep prompt inspection + policy enforcement.
 *
 * Sits in front of every model call and every MCP tool dispatch. Detects
 * prompt-injection patterns, sensitive-data leakage, and category-level
 * policy violations. Emits an audit trail consumed by LobsterTrapPanel.
 *
 * Two backends:
 *   - Local (default): regex + heuristics, zero network.
 *   - Remote: POST to VITE_LOBSTER_TRAP_URL with the Veea-issued
 *     VITE_LOBSTER_TRAP_KEY when the env is configured. The remote
 *     response is expected to match the local decision shape.
 *
 * Decision shape:
 *   { action: 'allow' | 'redact' | 'block',
 *     reasons: string[],
 *     redacted?: string,
 *     score: number (0-1),
 *     surface: string,
 *     ts: number,
 *     id: string }
 */

const REMOTE_URL = import.meta.env.VITE_LOBSTER_TRAP_URL || '';
const REMOTE_KEY = import.meta.env.VITE_LOBSTER_TRAP_KEY || '';
const POLICY_KEY = 'brainsnn_lobster_policy_v1';
const LOG_KEY = 'brainsnn_lobster_log_v1';
const LOG_CAP = 200;

export const DEFAULT_POLICY = {
  blockOnPromptInjection: true,
  redactPII: true,
  blockOnSecrets: true,
  maxPressure: 0.85,
  forbiddenCategories: [],
  allowToolDestructive: false,
  remoteEnabled: REMOTE_URL.length > 0
};

const INJECTION_PATTERNS = [
  /ignore (all|previous|prior) (instructions|prompts|rules)/i,
  /disregard (the|your) (system|developer) (prompt|message|instructions?)/i,
  /you are (now|actually) (a|an) [\w\s-]+(?:assistant|jailbreak|hacker|root|admin)/i,
  /reveal (your|the) (system|hidden|secret) (prompt|instructions?|rules?)/i,
  /pretend (to be|you are|that you('re| are)) (jailbroken|unrestricted|DAN|evil)/i,
  /act as (if )?(?:you have no|there are no) (restrictions|filters|guidelines)/i,
  /\bDAN\b.*\bmode\b/i,
  /\bdeveloper mode\b.*(?:enabled|activated|on)/i,
  /jailbreak.*?(prompt|mode|instructions)/i,
  /<\|.*?\|>/,
  /\{\{\s*system\s*\}\}/i,
  /\[\[\s*end of instructions\s*\]\]/i
];

const SECRET_PATTERNS = [
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'aws_secret', re: /\b[A-Za-z0-9/+=]{40}\b(?=\s|$)/ },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: 'openai_key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/ },
  { name: 'github_token', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'slack_token', re: /\bxox[abps]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'private_key', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ }
];

const PII_PATTERNS = [
  { name: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replace: '[email]' },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g, replace: '[ssn]' },
  { name: 'credit_card', re: /\b(?:\d[ -]?){13,19}\b/g, replace: '[card]' },
  { name: 'phone_us', re: /\b\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/g, replace: '[phone]' }
];

const DESTRUCTIVE_TOOLS = new Set([
  'reset_brain',
  'apply_scenario',
  'trigger_burst'
]);

// ---------- policy persistence ----------

export function loadPolicy() {
  try {
    const raw = localStorage.getItem(POLICY_KEY);
    if (!raw) return { ...DEFAULT_POLICY };
    return { ...DEFAULT_POLICY, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function savePolicy(policy) {
  try {
    localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
  } catch {}
}

// ---------- audit log ----------

export function appendLog(entry) {
  try {
    const log = loadLog();
    log.unshift(entry);
    const trimmed = log.slice(0, LOG_CAP);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function loadLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearLog() {
  try { localStorage.removeItem(LOG_KEY); } catch {}
}

// ---------- inspection ----------

function detectInjection(text) {
  const hits = [];
  for (const re of INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(m[0].slice(0, 60));
  }
  return hits;
}

function detectSecrets(text) {
  const hits = [];
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) hits.push(name);
  }
  return hits;
}

function redactPII(text) {
  let out = text;
  const hits = [];
  for (const { name, re, replace } of PII_PATTERNS) {
    if (re.test(out)) {
      hits.push(name);
      out = out.replace(re, replace);
    }
  }
  return { redacted: out, hits };
}

function makeId() {
  return `lt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Inspect a prompt or any free-form text destined for a model.
 * Synchronous + local. Use inspectPromptRemote() for the Veea backend.
 */
export function inspectPrompt({ prompt, surface = 'unknown', policy = loadPolicy() }) {
  const text = String(prompt || '');
  const reasons = [];
  let action = 'allow';
  let redacted;

  const injection = detectInjection(text);
  if (injection.length && policy.blockOnPromptInjection) {
    action = 'block';
    reasons.push(`prompt_injection: ${injection.slice(0, 2).join(' | ')}`);
  }

  const secrets = detectSecrets(text);
  if (secrets.length && policy.blockOnSecrets) {
    action = 'block';
    reasons.push(`secret_leak: ${secrets.join(', ')}`);
  }

  if (action !== 'block' && policy.redactPII) {
    const { redacted: r, hits } = redactPII(text);
    if (hits.length) {
      action = 'redact';
      redacted = r;
      reasons.push(`pii_redacted: ${hits.join(', ')}`);
    }
  }

  const score = Math.min(1, injection.length * 0.4 + secrets.length * 0.5 + (action === 'redact' ? 0.2 : 0));
  const entry = {
    id: makeId(),
    ts: Date.now(),
    surface,
    action,
    reasons,
    score,
    sample: text.slice(0, 120),
    redacted
  };
  appendLog(entry);
  return entry;
}

/**
 * Inspect an MCP tool call before it executes.
 */
export function inspectToolCall({ name, args = {}, policy = loadPolicy() }) {
  const reasons = [];
  let action = 'allow';

  if (DESTRUCTIVE_TOOLS.has(name) && !policy.allowToolDestructive) {
    action = 'block';
    reasons.push(`destructive_tool: ${name} requires policy opt-in`);
  }

  if (typeof args.text === 'string' && args.text.length) {
    const nested = inspectPrompt({ prompt: args.text, surface: `mcp.${name}`, policy });
    if (nested.action === 'block') {
      action = 'block';
      reasons.push(...nested.reasons);
    } else if (nested.action === 'redact' && action === 'allow') {
      action = 'redact';
      reasons.push(...nested.reasons);
      args = { ...args, text: nested.redacted };
    }
  }

  const entry = {
    id: makeId(),
    ts: Date.now(),
    surface: `mcp.${name}`,
    action,
    reasons,
    score: action === 'block' ? 1 : action === 'redact' ? 0.4 : 0,
    sample: JSON.stringify(args).slice(0, 120),
    redactedArgs: action === 'redact' ? args : undefined
  };
  appendLog(entry);
  return entry;
}

/**
 * Remote inspection via Veea Lobster Trap endpoint when configured.
 * Falls back to local on any error.
 */
export async function inspectPromptRemote({ prompt, surface = 'unknown', policy = loadPolicy() }) {
  if (!REMOTE_URL || !policy.remoteEnabled) {
    return inspectPrompt({ prompt, surface, policy });
  }
  try {
    const res = await fetch(REMOTE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(REMOTE_KEY ? { 'Authorization': `Bearer ${REMOTE_KEY}` } : {})
      },
      body: JSON.stringify({ prompt, surface, policy })
    });
    if (!res.ok) throw new Error(`Lobster Trap ${res.status}`);
    const remote = await res.json();
    const entry = {
      id: makeId(),
      ts: Date.now(),
      surface,
      action: remote.action || 'allow',
      reasons: remote.reasons || ['veea_remote'],
      score: typeof remote.score === 'number' ? remote.score : 0,
      sample: String(prompt).slice(0, 120),
      redacted: remote.redacted,
      backend: 'veea'
    };
    appendLog(entry);
    return entry;
  } catch (err) {
    const fallback = inspectPrompt({ prompt, surface, policy });
    fallback.reasons.push(`remote_fallback: ${err.message}`);
    return fallback;
  }
}

export function isRemoteEnabled() {
  return REMOTE_URL.length > 0;
}

export function getRemoteUrl() {
  return REMOTE_URL;
}
