// Cannibalized from wide-trace/open-higgsfield (src/generation/catalog).
// Design rule taken whole: the catalog is the single source of truth. The studio
// renders what a model declares; nothing is hardcoded in a parallel list.
//
// Deviation from upstream, deliberate: upstream's parseSettings silently ignores
// unknown keys. An unknown key is a typo or a lie about capability, so we throw.

export const SURFACES = ["image", "video"];
export const MEDIA_ROLES = ["start", "end", "reference", "video", "audio"];

export function enumField(values, fallback) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("enumField needs values");
  if (!values.includes(fallback)) throw new Error(`default ${fallback} not in ${values}`);
  return { type: "enum", values, default: fallback };
}

export function rangeField(min, max, fallback, step) {
  if (!(min < max)) throw new Error("rangeField needs min < max");
  if (fallback < min || fallback > max) throw new Error(`default ${fallback} outside ${min}..${max}`);
  return { type: "range", min, max, default: fallback, step };
}

export function booleanField(fallback = false) {
  return { type: "boolean", default: fallback };
}

/** Coerce raw input against a model's declared settings. Never invents a value. */
export function parseSettings(model, raw = {}) {
  if (raw && typeof raw !== "object") throw new Error("settings must be an object");
  for (const key of Object.keys(raw)) {
    if (!Object.prototype.hasOwnProperty.call(model.settings, key)) {
      throw new Error(`Unknown setting: ${key}`);
    }
  }
  const out = {};
  for (const [key, field] of Object.entries(model.settings)) {
    const value = raw[key];
    if (field.type === "enum") {
      const picked = typeof value === "string" ? value : field.default;
      if (!field.values.includes(picked)) throw new Error(`Invalid ${key}`);
      out[key] = picked;
      continue;
    }
    if (field.type === "range") {
      const picked = typeof value === "number" && Number.isFinite(value) ? value : field.default;
      if (picked < field.min || picked > field.max) throw new Error(`Invalid ${key}`);
      out[key] = picked;
      continue;
    }
    out[key] = typeof value === "boolean" ? value : field.default;
  }
  return out;
}
