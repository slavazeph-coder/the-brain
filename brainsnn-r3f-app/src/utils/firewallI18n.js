/**
 * Layer 52 — Multi-lingual Firewall Packs
 *
 * Language-specific pattern packs for the 4 Cognitive Firewall
 * dimensions. Starts with Spanish + French; can be extended by
 * adding more packs to LANGUAGE_PACKS.
 *
 * detectLanguage() uses a tiny character / stopword heuristic — good
 * enough to route to the right pack for short snippets.
 */

import { ES_COERCION, FR_COERCION, detectLanguage } from "./firewallCore.js";

// detectLanguage is single-sourced in firewallCore (shared with the server);
// re-exported here so existing importers keep working.
export { detectLanguage };

const SPANISH_PACK = {
  urgency: [
    /\bahora\b|\binmediatamente\b|\burgente\b|\bya\b|\balerta\b/gi,
    /\búltima oportunidad\b|\bno (?:te )?pierdas\b|\btiempo limitado\b|\bactúa (?:ya|rápido)\b/gi,
    /!{2,}|\bAVISO\b|\bCRISIS\b|\bIMPACTANTE\b/gi,
  ],
  outrage: [
    /\bindigna(?:ción|nte)\b|\bfurioso\b|\besc[áa]ndalo\b|\bterrible\b|\bhorrible\b/gi,
    /\bincreíble\b|\basqueroso\b|\bimpactante\b|\btraición\b/gi,
    /\bno quieren que sepas\b|\boculto\b|\bsecreto\b|\bencubri(?:eron|do)\b/gi,
  ],
  certainty: [
    /\b100%\b|\bprobado\b|\bgarantizado\b|\bcientíficamente probado\b|\bhecho\b/gi,
    /\btodo el mundo sabe\b|\bobviamente\b|\bclaramente\b|\bsin duda\b/gi,
  ],
  fear: [
    /\bmuerte\b|\bmorir\b|\bmatar\b|\bpeligro\b|\bamenaza\b|\binseguro\b/gi,
    /\bvirus\b|\bpandemia\b|\bataque\b|\bguerra\b|\bcolapso\b/gi,
  ],
  coercion: ES_COERCION,
};

const FRENCH_PACK = {
  urgency: [
    /\bmaintenant\b|\bimmédiatement\b|\burgent(?:e|es)?\b|\balerte\b/gi,
    /\bdernière chance\b|\bne (?:pas )?rater\b|\btemps limité\b|\bagis(?:sez)? vite\b/gi,
    /!{2,}|\bATTENTION\b|\bCRISE\b|\bCHOC\b/gi,
  ],
  outrage: [
    /\bindign(?:ation|é)\b|\bfurieux\b|\bscandale\b|\bterrible\b|\bhorrible\b/gi,
    /\bincroyable\b|\bdég[oo]utant\b|\bchoquant\b|\btrahison\b/gi,
    /\bils ne veulent pas que vous sachiez\b|\bcaché\b|\bsecret\b|\bétouff(?:é|er)\b/gi,
  ],
  certainty: [
    /\b100%\b|\bprouvé\b|\bgaranti\b|\bscientifiquement prouvé\b|\bfait\b/gi,
    /\btout le monde sait\b|\bévidemment\b|\bclairement\b|\bsans aucun doute\b/gi,
  ],
  fear: [
    /\bmort\b|\bmourir\b|\btuer\b|\bdanger\b|\bmenace\b|\brisqué\b/gi,
    /\bvirus\b|\bpandémie\b|\battaque\b|\bguerre\b|\beffondrement\b/gi,
  ],
  coercion: FR_COERCION,
};

export const LANGUAGE_PACKS = {
  es: { label: "Spanish", patterns: SPANISH_PACK },
  fr: { label: "French", patterns: FRENCH_PACK },
};

/**
 * Look up the right pack. Returns null for 'en' (English is the
 * default active ruleset, no replacement needed).
 */
export function patternsFor(lang) {
  if (lang === "en" || !LANGUAGE_PACKS[lang]) return null;
  return LANGUAGE_PACKS[lang].patterns;
}

export function labelFor(lang) {
  if (lang === "en") return "English";
  return LANGUAGE_PACKS[lang]?.label || lang;
}
