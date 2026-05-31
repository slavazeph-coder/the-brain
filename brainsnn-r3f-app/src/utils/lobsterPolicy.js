// Cheap, synchronous Lobster Trap policy + audit-log surface. Extracted from
// lobsterTrap.js so the panel and consumers can read constants and persistence
// helpers via a STATIC import without pulling in the regex inspection engine.
// That keeps lobsterTrap.js purely *dynamically* imported — out of the entry
// chunk, and with no mixed static/dynamic "won't move module" chunk warning.

export const REMOTE_URL = import.meta.env.VITE_LOBSTER_TRAP_URL || "";
export const REMOTE_KEY = import.meta.env.VITE_LOBSTER_TRAP_KEY || "";
const POLICY_KEY = "brainsnn_lobster_policy_v1";
const LOG_KEY = "brainsnn_lobster_log_v1";
const LOG_CAP = 200;

export const DEFAULT_POLICY = {
  blockOnPromptInjection: true,
  redactPII: true,
  blockOnSecrets: true,
  maxPressure: 0.85,
  forbiddenCategories: [],
  allowToolDestructive: false,
  remoteEnabled: REMOTE_URL.length > 0,
};

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
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {}
}

export function isRemoteEnabled() {
  return REMOTE_URL.length > 0;
}

export function getRemoteUrl() {
  return REMOTE_URL;
}
