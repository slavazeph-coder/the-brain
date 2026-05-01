/**
 * Layer 111 — Daily notes helper.
 *
 * "Today's note" is a vault note titled with today's date in ISO format
 * (YYYY-MM-DD). The helper opens (or creates) it deterministically. A
 * caller can pass a date to navigate; defaults to now.
 *
 * Templates are kept dead simple — a single string the caller can carry,
 * with `{{date}}` and `{{weekday}}` substitutions.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function applyTemplate(template, { date, weekday } = {}) {
  return String(template || '')
    .replaceAll('{{date}}', date)
    .replaceAll('{{weekday}}', weekday);
}

export const DEFAULT_TEMPLATE = `# {{date}} ({{weekday}})

## Today

-

## Notes

`;

/**
 * Return today's daily note from a vault, creating it if missing.
 * The vault's ``create`` slug is "YYYY-MM-DD" so a stable round-trip is
 * possible across days.
 */
export function ensureDailyNote(vault, { now = new Date(), template = DEFAULT_TEMPLATE } = {}) {
  const date = isoDate(now);
  const weekday = WEEKDAYS[now.getDay()];
  const existing = vault.get(date);
  if (existing) return existing;
  const body = applyTemplate(template, { date, weekday });
  return vault.create({ title: date, body, tags: ['daily'] });
}
