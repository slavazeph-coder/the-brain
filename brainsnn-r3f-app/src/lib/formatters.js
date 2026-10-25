export function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function titleFromContent(content = '') {
  const normalized = String(content).replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Untitled scan';
  return normalized.length > 68 ? `${normalized.slice(0, 65)}...` : normalized;
}

export function excerpt(content = '', max = 150) {
  const normalized = String(content).replace(/\s+/g, ' ').trim();
  if (!normalized) return 'No content saved.';
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

export function signedDelta(value) {
  const number = Math.round(Number(value) || 0);
  if (number > 0) return `+${number}`;
  return String(number);
}
