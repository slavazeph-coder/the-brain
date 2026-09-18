import { parseSettings } from "./types.js";
import { reelAssemble, wan22I2V, wan22I2VCpuVae } from "./wan.js";

// The picker renders THIS. Three entries, every one of them real. Upstream's
// catalog has 38 because it wraps other people's endpoints; ours has what the
// box can actually run, so the studio cannot advertise a model that does not exist.
export const MODELS = [wan22I2V, wan22I2VCpuVae, reelAssemble];

export function getModel(id) {
  const entry = MODELS.find((m) => m.id === id);
  if (!entry) throw new Error(`Unknown model: ${id}`);
  return entry;
}

/** A model is available only if every pinned workflow id it needs is present. */
export function resolveWorkflows(entry, env = {}) {
  const keys = entry.workflowEnv || [];
  const missing = keys.filter((k) => !String(env[k] ?? "").trim());
  const bindings = Object.fromEntries(keys.map((k) => [k, env[k]]));
  return { available: missing.length === 0, missing, bindings };
}

export function availability(env = {}) {
  return MODELS.map((m) => {
    const wf = resolveWorkflows(m, env);
    return { id: m.id, label: m.label, surface: m.surface, available: wf.available, missing: wf.missing };
  });
}

/** Catalog integrity. A duplicate id would silently shadow a model in the picker. */
export function assertCatalog(models = MODELS) {
  const seen = new Set();
  for (const m of models) {
    if (seen.has(m.id)) throw new Error(`Duplicate model id: ${m.id}`);
    seen.add(m.id);
    if (!["image", "video"].includes(m.surface)) throw new Error(`Bad surface: ${m.id}`);
    if (!m.label) throw new Error(`Missing label: ${m.id}`);
    if (!m.roles || Object.keys(m.roles).length === 0) throw new Error(`No media roles: ${m.id}`);
    parseSettings(m, {}); // a model whose own defaults fail validation is broken
    for (const [key, field] of Object.entries(m.settings)) {
      if (!["enum", "range", "boolean"].includes(field.type)) throw new Error(`Bad field ${key} on ${m.id}`);
    }
  }
  return seen.size;
}

export { parseSettings };
