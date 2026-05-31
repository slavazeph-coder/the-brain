// Cheap, synchronous Gemini configuration surface. Extracted from
// geminiEngine.js so panels/utils can read config (isGeminiConfigured,
// getGeminiModel) via a STATIC import without pulling in the heavy engine.
// That keeps geminiEngine.js purely *dynamically* imported — out of the entry
// chunk, and with no mixed static/dynamic "won't move module" chunk warning.

export const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
export const MODEL = import.meta.env.VITE_GEMINI_MODEL || "gemini-2.5-flash";
export const API_BASE =
  import.meta.env.VITE_GEMINI_API_BASE ||
  "https://generativelanguage.googleapis.com/v1beta";

export function isGeminiConfigured() {
  return API_KEY.length > 0;
}

export function getGeminiModel() {
  return MODEL;
}
