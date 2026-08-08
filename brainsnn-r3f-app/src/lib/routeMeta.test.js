import { describe, expect, it } from '../test/tinyVitest.js';
import { applyRouteMeta, resolveRouteMeta } from './routeMeta.js';

// A trimmed copy of the shape index.html actually has, so the rewrites are
// tested against the real tag formatting rather than a convenient stand-in.
const HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>GaugeGap Foundry | Play with the impossible</title>
    <meta name="description" content="Original description." />
    <link rel="canonical" href="https://www.brainsnn.com/" />
    <meta property="og:title" content="Original og title" />
    <meta property="og:description" content="Original og description" />
    <meta property="og:url" content="https://www.brainsnn.com/" />
    <meta property="og:image" content="https://www.brainsnn.com/og-image.png" />
    <meta name="twitter:title" content="Original twitter title" />
    <meta name="twitter:description" content="Original twitter description" />
  </head>
  <body><div id="root"></div></body>
</html>`;

function tagContent(html, pattern) {
  const match = new RegExp(pattern).exec(html);
  return match ? match[1] : null;
}

describe('per-route social previews', () => {
  it('gives each route its own title', () => {
    const titles = ['/', '/lab', '/app', '/reconstruct'].map((p) => resolveRouteMeta(p).title);
    // The whole point: four routes used to share one card.
    expect(new Set(titles).size).toBe(4);
  });

  it('matches the longest prefix, so /lab is not the homepage', () => {
    expect(resolveRouteMeta('/lab').title).toContain('Powder Lab');
    expect(resolveRouteMeta('/lab/anything').title).toContain('Powder Lab');
    expect(resolveRouteMeta('/').title).toContain('GaugeGap Foundry');
  });

  it('falls back to the homepage card for an unknown path', () => {
    expect(resolveRouteMeta('/nope').title).toBe(resolveRouteMeta('/').title);
  });

  // The share button promises the link "carries the whole grid". The preview
  // should at least say a grid is what you are about to open.
  it('describes a shared grid differently from the lab itself', () => {
    const shared = resolveRouteMeta('/lab', '?grid=p1:240x160:1eB');
    const plain = resolveRouteMeta('/lab');
    expect(shared.title).not.toBe(plain.title);
    expect(shared.title.toLowerCase()).toContain('built this');
  });

  it('ignores a query string that merely mentions grid', () => {
    expect(resolveRouteMeta('/lab', '?ungridded=1').title).toBe(resolveRouteMeta('/lab').title);
  });

  it('rewrites title, description, og and twitter tags together', () => {
    const html = applyRouteMeta(HTML, '/lab', '', 'https://www.brainsnn.com');
    const title = tagContent(html, '<title>([^<]*)</title>');
    expect(title).toContain('Powder Lab');
    expect(tagContent(html, 'name="description" content="([^"]*)"')).toContain('falling-sand');
    expect(tagContent(html, 'property="og:title" content="([^"]*)"')).toBe(title);
    expect(tagContent(html, 'name="twitter:title" content="([^"]*)"')).toBe(title);
    expect(tagContent(html, 'property="og:description" content="([^"]*)"')).toContain('falling-sand');
  });

  it('points canonical and og:url at the route being served', () => {
    const html = applyRouteMeta(HTML, '/lab', '', 'https://www.brainsnn.com');
    expect(tagContent(html, 'property="og:url" content="([^"]*)"')).toBe('https://www.brainsnn.com/lab');
    expect(tagContent(html, 'rel="canonical" href="([^"]*)"')).toBe('https://www.brainsnn.com/lab');
  });

  it('leaves the preview image alone', () => {
    // There is one og-image.png and it is still the right card art.
    const html = applyRouteMeta(HTML, '/lab', '', 'https://www.brainsnn.com');
    expect(html).toContain('og-image.png');
  });

  // Duplicate og:title tags are resolved differently by different scrapers, so
  // rewriting in place matters more than it looks.
  it('never emits a second copy of a tag it rewrites', () => {
    const html = applyRouteMeta(HTML, '/app', '', 'https://www.brainsnn.com');
    expect((html.match(/property="og:title"/g) || []).length).toBe(1);
    expect((html.match(/<title>/g) || []).length).toBe(1);
    expect((html.match(/name="description"/g) || []).length).toBe(1);
  });

  it('escapes anything that would break out of an attribute', () => {
    const html = applyRouteMeta(HTML, '/lab', '?grid="><script>alert(1)</script>', 'https://x.test');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('leaves the document intact when no origin is known', () => {
    const html = applyRouteMeta(HTML, '/lab');
    expect(html).toContain('<div id="root">');
    expect(tagContent(html, '<title>([^<]*)</title>')).toContain('Powder Lab');
  });
});
