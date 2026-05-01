/**
 * Tiny markdown renderer + wikilink extractor for the vault.
 *
 * Deliberately not a full CommonMark implementation. We support what
 * Obsidian users actually rely on day-to-day:
 *
 *   - ATX headings (#, ##, … up to ###### )
 *   - Paragraphs separated by blank lines
 *   - Unordered lists (-, *, +) and ordered lists (1.)
 *   - Inline bold (**), italic (*), code (`)
 *   - Code blocks (```fence)
 *   - Inline links [text](url)
 *   - Wikilinks [[Note Title]] and [[Note Title|alias]]
 *   - Tags #my-tag (alphanumeric + dash)
 *   - Block quotes >
 *
 * The output is a string of safe HTML — every untrusted substring is
 * escaped before interpolation, so user notes can be rendered with
 * dangerouslySetInnerHTML without XSS.
 */

const TAG_RE = /(^|\s)#([a-z0-9][a-z0-9-]{0,40})/gi;
const WIKILINK_RE = /\[\[([^\][\n|]+)(?:\|([^\][\n]+))?\]\]/g;
const INLINE_LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;

// ---------- HTML escape ----------------------------------------------------

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// ---------- public extraction API ------------------------------------------

/**
 * Extract every wikilink target in a body. Returns an array of unique
 * normalised target strings (case-insensitive, whitespace collapsed).
 */
export function extractWikilinks(body) {
  if (!body) return [];
  const out = new Set();
  WIKILINK_RE.lastIndex = 0;
  let m;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const target = m[1].trim();
    if (target) out.add(target);
  }
  return Array.from(out);
}

/**
 * Extract every #tag from a body. Lowercased, deduplicated.
 */
export function extractTags(body) {
  if (!body) return [];
  const out = new Set();
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(body)) !== null) {
    out.add(m[2].toLowerCase());
  }
  return Array.from(out);
}

/**
 * Word count, ignoring code blocks, headings markers, and wikilink syntax.
 */
export function wordCount(body) {
  if (!body) return 0;
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[\[[^\]]+\]\]/g, ' x ')
    .replace(/[#>*_`-]/g, ' ');
  const tokens = stripped.split(/\s+/).filter(Boolean);
  return tokens.length;
}

// ---------- markdown → HTML ------------------------------------------------

function renderInline(s, { resolveWikilink } = {}) {
  let out = escapeHtml(s);

  // Wikilinks first (so internal links can be styled differently).
  out = out.replace(/\[\[([^\][\n|]+)(?:\|([^\][\n]+))?\]\]/g, (_, target, alias) => {
    const t = target.trim();
    const display = (alias ?? t).trim();
    const exists = typeof resolveWikilink === 'function' ? !!resolveWikilink(t) : true;
    const cls = exists ? 'vault-wikilink vault-wikilink-found' : 'vault-wikilink vault-wikilink-missing';
    return `<a class="${cls}" data-wikilink="${escapeHtml(t)}" href="#vault/${escapeHtml(t)}">${escapeHtml(display)}</a>`;
  });

  // Inline external links.
  out = out.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, text, href) => {
    const safeHref = /^(https?:|mailto:|#)/i.test(href) ? href : '#';
    return `<a class="vault-link" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  });

  // Tags.
  out = out.replace(/(^|\s)#([a-z0-9][a-z0-9-]{0,40})/gi, (_, lead, tag) => {
    return `${lead}<span class="vault-tag">#${escapeHtml(tag)}</span>`;
  });

  // Inline code.
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);

  // Bold and italic. Bold first so ** wins over *.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, (_, t) => `<strong>${t}</strong>`);
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, lead, t) => `${lead}<em>${t}</em>`);

  return out;
}

/**
 * Render a markdown string to safe HTML. Pass `resolveWikilink(target)` to
 * differentiate "found" vs "missing" wikilinks; both render as <a> tags.
 */
export function renderMarkdown(body, opts = {}) {
  if (!body) return '';
  const lines = body.split(/\r?\n/);

  const out = [];
  let inCode = false;
  let codeBuffer = [];
  let listKind = null;          // 'ul' or 'ol' or null
  let inQuote = false;
  let paragraph = [];

  function flushParagraph() {
    if (paragraph.length) {
      out.push(`<p>${renderInline(paragraph.join(' '), opts)}</p>`);
      paragraph = [];
    }
  }

  function flushList() {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  }

  function flushQuote() {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  }

  function flushAll() {
    flushParagraph();
    flushList();
    flushQuote();
  }

  for (const line of lines) {
    if (inCode) {
      if (/^```\s*$/.test(line)) {
        out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
        inCode = false;
      } else {
        codeBuffer.push(line);
      }
      continue;
    }
    if (/^```/.test(line)) {
      flushAll();
      inCode = true;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2], opts)}</h${level}>`);
      continue;
    }

    const ulMatch = /^[-*+]\s+(.*)$/.exec(line);
    const olMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (ulMatch || olMatch) {
      flushParagraph();
      flushQuote();
      const kind = ulMatch ? 'ul' : 'ol';
      if (listKind && listKind !== kind) flushList();
      if (!listKind) {
        listKind = kind;
        out.push(`<${kind}>`);
      }
      const text = (ulMatch || olMatch)[1];
      out.push(`<li>${renderInline(text, opts)}</li>`);
      continue;
    }
    if (listKind) flushList();

    const quoteMatch = /^>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      flushParagraph();
      if (!inQuote) {
        inQuote = true;
        out.push('<blockquote>');
      }
      out.push(`<p>${renderInline(quoteMatch[1], opts)}</p>`);
      continue;
    }
    if (inQuote && !line.trim()) flushQuote();

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
  }
  flushAll();

  return out.join('\n');
}
