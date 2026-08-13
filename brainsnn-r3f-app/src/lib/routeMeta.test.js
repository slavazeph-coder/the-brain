import { describe, expect, it } from '../test/tinyVitest.js';
import { applyRouteMeta, renderContentBlock, resolveRouteMeta } from './routeMeta.js';

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

  it('keeps the site card for a route that declares no image of its own', () => {
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

// A crawler that does not execute JavaScript used to receive an empty <div> on
// every URL. These are about what such a crawler now reads.
describe('content a crawler can read without running JavaScript', () => {
  it('puts the route content inside #root, where React will replace it', () => {
    const html = applyRouteMeta(HTML, '/lab', '', 'https://www.brainsnn.com');
    // Outside #root it would survive hydration and sit under the running app.
    expect(html).toContain('<div id="root"><main data-prerendered="1"');
    expect(html).toContain('</main></div>');
  });

  it('gives every route a heading and real prose', () => {
    for (const path of ['/', '/lab', '/app', '/evidence', '/reconstruct']) {
      const html = applyRouteMeta(HTML, path, '', 'https://www.brainsnn.com');
      const heading = tagContent(html, '<h1[^>]*>([^<]*)</h1>');
      expect(heading.length).toBeGreaterThan(10);
      expect((html.match(/<p style/g) || []).length).toBeGreaterThan(1);
    }
  });

  it('gives each route a different heading', () => {
    const headings = ['/', '/lab', '/app', '/evidence', '/reconstruct'].map(
      (path) => tagContent(applyRouteMeta(HTML, path, '', 'https://x.test'), '<h1[^>]*>([^<]*)</h1>'),
    );
    expect(new Set(headings).size).toBe(5);
  });

  it('quotes the live holdout numbers on the evidence page', () => {
    // The figures are computed, so this asserts a number reached the HTML rather
    // than asserting a specific value that would pin the corpus.
    const html = applyRouteMeta(HTML, '/evidence', '', 'https://x.test');
    expect(html).toMatch(/Rank agreement[^<]*0\.\d+/);
  });

  it('links the other routes, so each page is not an island', () => {
    const html = applyRouteMeta(HTML, '/lab', '', 'https://x.test');
    expect(html).toContain('href="/evidence"');
    expect(html).toContain('href="/app"');
    // No self-link: it is the page you are on.
    expect(html).not.toContain('href="/lab"');
  });

  it('describes a shared grid as the grid rather than as the lab', () => {
    const html = applyRouteMeta(HTML, '/lab', '?grid=p1', 'https://x.test');
    expect(tagContent(html, '<h1[^>]*>([^<]*)</h1>')).toContain('built this');
  });

  it('escapes prose rather than trusting it to be tag-free', () => {
    const block = renderContentBlock({
      heading: 'Break <script>alert(1)</script> out',
      body: ['Also <img src=x onerror=alert(1)> here'],
    });
    expect(block).not.toContain('<script>');
    expect(block).not.toContain('<img');
    expect(block).toContain('&lt;script&gt;');
  });

  it('renders nothing for a route with no content of its own', () => {
    expect(renderContentBlock({ title: 'x' })).toBe('');
    expect(renderContentBlock(null)).toBe('');
  });

  it('emits exactly one h1 and one main', () => {
    const html = applyRouteMeta(HTML, '/app', '', 'https://x.test');
    expect((html.match(/<h1/g) || []).length).toBe(1);
    expect((html.match(/<main/g) || []).length).toBe(1);
  });
});

describe('per-route preview image', () => {
  it('rewrites og:image and twitter:image when a route names one', () => {
    const html = applyRouteMeta(
      HTML.replace('<meta property="og:image"', '<meta name="twitter:image" content="x" />\n    <meta property="og:image"'),
      '/lab',
      '?grid=p1',
      'https://www.brainsnn.com',
    );
    expect(html).toContain('https://www.brainsnn.com/api/og/lab?grid=p1');
    expect((html.match(/property="og:image"/g) || []).length).toBe(1);
  });
});
