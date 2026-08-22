import { describe, expect, it } from '../test/tinyVitest.js';
import { applyRouteMeta, renderContentBlock, resolveRouteMeta } from './routeMeta.js';

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>BrainSNN</title>
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
  it('positions the homepage as BrainSNN decision intelligence', () => {
    const home = resolveRouteMeta('/');
    expect(home.title).toContain('BrainSNN');
    expect(home.title).toContain('decision intelligence');
    expect(home.description).toContain('screen recording');
  });

  it('keeps the legacy /app route aligned with the homepage product', () => {
    expect(resolveRouteMeta('/app').title).toBe(resolveRouteMeta('/').title);
    expect(resolveRouteMeta('/app').description).toContain('workflow steps');
  });

  it('gives the Arcade a dedicated preview instead of making it the homepage', () => {
    expect(resolveRouteMeta('/arcade').title).toContain('GaugeGap Arcade');
    expect(resolveRouteMeta('/').title).not.toContain('GaugeGap Foundry');
  });

  it('matches the longest prefix, so /lab is not the homepage', () => {
    expect(resolveRouteMeta('/lab').title).toContain('Powder Lab');
    expect(resolveRouteMeta('/lab/anything').title).toContain('Powder Lab');
    expect(resolveRouteMeta('/').title).toContain('BrainSNN');
  });

  it('falls back to the homepage card for an unknown path', () => {
    expect(resolveRouteMeta('/nope').title).toBe(resolveRouteMeta('/').title);
  });

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
    const html = applyRouteMeta(HTML, '/', '', 'https://www.brainsnn.com');
    const title = tagContent(html, '<title>([^<]*)</title>');
    expect(title).toContain('BrainSNN');
    expect(tagContent(html, 'name="description" content="([^"]*)"')).toContain('screen recording');
    expect(tagContent(html, 'property="og:title" content="([^"]*)"')).toBe(title);
    expect(tagContent(html, 'name="twitter:title" content="([^"]*)"')).toBe(title);
  });

  it('points canonical and og:url at the route being served', () => {
    const html = applyRouteMeta(HTML, '/arcade', '', 'https://www.brainsnn.com');
    expect(tagContent(html, 'property="og:url" content="([^"]*)"')).toBe('https://www.brainsnn.com/arcade');
    expect(tagContent(html, 'rel="canonical" href="([^"]*)"')).toBe('https://www.brainsnn.com/arcade');
  });

  it('keeps the site card for a route that declares no image of its own', () => {
    const html = applyRouteMeta(HTML, '/arcade', '', 'https://www.brainsnn.com');
    expect(html).toContain('og-image.png');
  });

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
});

describe('content a crawler can read without running JavaScript', () => {
  it('puts route content inside #root', () => {
    const html = applyRouteMeta(HTML, '/', '', 'https://www.brainsnn.com');
    expect(html).toContain('<div id="root"><main data-prerendered="1"');
    expect(html).toContain('</main></div>');
  });

  it('gives every major route a heading and real prose', () => {
    for (const path of ['/', '/arcade', '/lab', '/app', '/evidence', '/reconstruct']) {
      const html = applyRouteMeta(HTML, path, '', 'https://www.brainsnn.com');
      const heading = tagContent(html, '<h1[^>]*>([^<]*)</h1>');
      expect(heading.length).toBeGreaterThan(10);
      expect((html.match(/<p style/g) || []).length).toBeGreaterThan(1);
    }
  });

  it('quotes the live holdout numbers on the evidence page', () => {
    const html = applyRouteMeta(HTML, '/evidence', '', 'https://x.test');
    expect(html).toMatch(/Rank agreement[^<]*0\.\d+/);
  });

  it('links the Arcade and analyzer so crawler routes are not islands', () => {
    const html = applyRouteMeta(HTML, '/lab', '', 'https://x.test');
    expect(html).toContain('href="/arcade"');
    expect(html).toContain('href="/app"');
    expect(html).not.toContain('href="/lab"');
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
});

describe('per-route preview image', () => {
  it('rewrites og:image and twitter:image when a shared grid names one', () => {
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
