import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '../test/tinyVitest.js';
import { applyRouteMeta, renderContentBlock, resolveRouteMeta } from './routeMeta.js';
import { buildHoldoutReport } from './holdoutReport.js';

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
  it('leads with the World Engine and keeps the poke toy on /play', () => {
    const home = resolveRouteMeta('/');
    expect(home.title).toBe('BrainSNN | Turn video into a 3D world');
    expect(home.heading).toBe('Turn your videos into 3D worlds.');
    expect(home.description).toContain('phone');
    expect(home.description).toContain('early access');
    expect(home.image).toBe('/og-image.png');
    const body = home.body.join(' ');
    expect(body).toContain('camera tracking');
    expect(body).toContain('independent validation');
    expect(body).toContain('not generally available');
    expect(body).not.toContain('US$171.43');

    const scan = resolveRouteMeta('/scan');
    expect(scan.title).toBe('Capture a space | BrainSNN World Engine');
    expect(scan.body.join(' ')).toContain('Nothing is uploaded until you choose to build a world');
    expect(scan.body.join(' ')).toContain('directly to BrainSNN\'s reconstruction worker, not the website');
    expect(scan.body.join(' ')).toContain('kept for 24 hours');
    expect(resolveRouteMeta('/scan/').title).toBe(scan.title);

    const play = resolveRouteMeta('/play');
    expect(play.title).toBe('BrainSNN | Sapient Playground');
    expect(play.heading).toBe('Poke the brain and watch the signal travel.');
    expect(play.image).toBe('/og/toy-poke.png');
    expect(play.body.join(' ')).toContain('Explore more toys in Lab');
    expect(play.body.join(' ')).toContain('not a recording of anyone’s brain');
  });

  it('gives every toy its own preview, hook and honest boundary', () => {
    const fool = resolveRouteMeta('/toys/fool-the-detector');
    expect(fool.heading).toBe('Can you fool our AI detector?');
    expect(fool.image).toBe('/og/toy-fool.png');
    expect(fool.body.join(' ')).toContain('do not establish universal capability');
    const duel = resolveRouteMeta('/toys/draft-duel');
    expect(duel.heading).toBe('Make two drafts fight.');
    expect(duel.body.join(' ')).toContain('not a verdict on quality');
    const defend = resolveRouteMeta('/toys/defend-the-brain');
    expect(defend.body.join(' ')).toContain('not probabilities');
    expect(defend.image).toBe('/og/toy-defend.png');
    // A shared toy link carries ?src=; the preview must not care.
    expect(resolveRouteMeta('/toys/draft-duel', '?src=toy3-share').title).toBe(duel.title);
    expect(renderContentBlock(resolveRouteMeta('/lab'), '/lab')).toContain('href="/toys/fool-the-detector"');
  });

  it('makes office the single Review workbench with visible limitations', () => {
    const office = resolveRouteMeta('/office');
    expect(office.title).toBe('Review | BrainSNN');
    expect(office.title).not.toBe(resolveRouteMeta('/').title);
    expect(office.body.join(' ')).toContain('Passage, Two drafts, Claim split and Video cues');
    expect(office.body.join(' ')).toContain('Known misses and false alarms');
    expect(office.body.join(' ')).toContain('do not recognize objects');
    expect(renderContentBlock(resolveRouteMeta('/'), '/')).toContain('href="/office"');
  });

  it('resolves the former workbenches to the matching Review tabs', () => {
    for (const [path, tab] of [['/app', 'passage'], ['/engine', 'drafts'], ['/reconstruct', 'claims']]) {
      const legacy = resolveRouteMeta(path);
      expect(legacy).toEqual(resolveRouteMeta('/office', `?tab=${tab}`));
      const html = applyRouteMeta(HTML, path, '', 'https://www.brainsnn.com');
      expect(tagContent(html, 'rel="canonical" href="([^"]*)"')).toBe('https://www.brainsnn.com/office');
    }
  });

  it('gives each Review tab a title without exposing arbitrary query text', () => {
    for (const [tab, label] of [['passage', 'Passage'], ['drafts', 'Two drafts'], ['claims', 'Claim split'], ['video', 'Video cues']]) {
      expect(resolveRouteMeta('/office', `?tab=${tab}`).title).toBe(`Review: ${label} | BrainSNN`);
    }
    expect(resolveRouteMeta('/office', '?tab=<script>')).toEqual(resolveRouteMeta('/office'));
    expect(resolveRouteMeta('/office', '?tab=constructor')).toEqual(resolveRouteMeta('/office'));
  });

  it('gives the Arcade a dedicated preview instead of making it the homepage', () => {
    expect(resolveRouteMeta('/arcade').title).toBe('Arcade | BrainSNN');
    expect(resolveRouteMeta('/').title).not.toContain('GaugeGap Foundry');
  });

  it('positions missions as Arena tasks with an explicit practice boundary', () => {
    expect(resolveRouteMeta('/missions')).toEqual(resolveRouteMeta('/arena/'));
    expect(resolveRouteMeta('/missions/build')).toEqual(resolveRouteMeta('/arena/tasks/build'));
    expect(resolveRouteMeta('/arena/').body.join(' ')).toContain('Local practice — not a model score');
    expect(resolveRouteMeta('/arena/tasks/build').title).toBe('Arena tasks | BrainSNN');
    expect(resolveRouteMeta('/arena/tasks/build').body.join(' ')).toContain('Tasks without an implementation remain unavailable');
  });

  it('distinguishes the Lab index from the powder experiment', () => {
    expect(resolveRouteMeta('/lab').title).toBe('Lab | BrainSNN');
    expect(resolveRouteMeta('/lab/powder').title).toContain('Powder Lab');
    expect(resolveRouteMeta('/lab/powder/anything').title).toContain('Powder Lab');
    expect(resolveRouteMeta('/').title).toContain('BrainSNN');
  });

  it('falls back to the homepage card for an unknown path', () => {
    expect(resolveRouteMeta('/nope').title).toBe(resolveRouteMeta('/').title);
    expect(resolveRouteMeta('/laboratory').title).toBe(resolveRouteMeta('/').title);
  });

  it('describes a shared grid differently from the lab itself', () => {
    const shared = resolveRouteMeta('/lab/powder', '?grid=p1:240x160:1eB');
    const plain = resolveRouteMeta('/lab/powder');
    expect(shared.title).not.toBe(plain.title);
    expect(shared.title.toLowerCase()).toContain('built this');
    expect(resolveRouteMeta('/lab', '?grid=p1:240x160:1eB')).toEqual(shared);
  });

  it('ignores a query string that merely mentions grid', () => {
    expect(resolveRouteMeta('/lab', '?ungridded=1').title).toBe(resolveRouteMeta('/lab').title);
  });

  it('rewrites title, description, og and twitter tags together', () => {
    const html = applyRouteMeta(HTML, '/', '', 'https://www.brainsnn.com');
    const title = tagContent(html, '<title>([^<]*)</title>');
    expect(title).toContain('BrainSNN');
    const description = resolveRouteMeta('/').description;
    for (const attribute of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
      expect(tagContent(html, `${attribute} content="([^"]*)"`)).toBe(description);
    }
    expect(description).toContain('camera-first 3D capture');
    expect(tagContent(html, 'property="og:title" content="([^"]*)"')).toBe(title);
    expect(tagContent(html, 'name="twitter:title" content="([^"]*)"')).toBe(title);
  });

  it('points canonical and og:url at the route being served', () => {
    const html = applyRouteMeta(HTML, '/arcade', '', 'https://www.brainsnn.com');
    expect(tagContent(html, 'property="og:url" content="([^"]*)"')).toBe('https://www.brainsnn.com/arcade');
    expect(tagContent(html, 'rel="canonical" href="([^"]*)"')).toBe('https://www.brainsnn.com/arcade');
    const taskHtml = applyRouteMeta(HTML, '/arena/tasks/refund-authority', '', 'https://www.brainsnn.com');
    expect(tagContent(taskHtml, 'rel="canonical" href="([^"]*)"')).toBe('https://www.brainsnn.com/arena/tasks/refund-authority');
  });

  it('keeps the site card for a route that declares no image of its own', () => {
    const html = applyRouteMeta(HTML, '/arcade', '', 'https://www.brainsnn.com');
    expect(html).toContain('og-image.png');
  });

  it('uses the rendered toy screenshot for /play and the site card for the lobby', () => {
    const playHtml = applyRouteMeta(HTML, '/play', '', 'https://www.brainsnn.com');
    expect(tagContent(playHtml, 'property="og:image" content="([^"]*)"')).toBe('https://www.brainsnn.com/og/toy-poke.png');
    expect(resolveRouteMeta('/play').image).toBe('/og/toy-poke.png');
    const homeHtml = applyRouteMeta(HTML, '/', '', 'https://www.brainsnn.com');
    expect(tagContent(homeHtml, 'property="og:image" content="([^"]*)"')).toBe('https://www.brainsnn.com/og-image.png');
    expect(resolveRouteMeta('/').image).toBe('/og-image.png');
    expect(resolveRouteMeta('/arcade').image).toBe('/og-image.png');
  });

  it('points every toy preview at an image that actually ships in public/', () => {
    for (const path of ['/play', '/toys/fool-the-detector', '/toys/draft-duel', '/toys/defend-the-brain']) {
      const image = resolveRouteMeta(path).image;
      expect(existsSync(join(process.cwd(), 'public', image))).toBe(true);
    }
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
    for (const path of ['/', '/scan', '/office', '/arcade', '/lab', '/app', '/engine', '/evidence', '/reconstruct']) {
      const html = applyRouteMeta(HTML, path, '', 'https://www.brainsnn.com');
      const heading = tagContent(html, '<h1[^>]*>([^<]*)</h1>');
      expect(heading.length).toBeGreaterThan(10);
      expect((html.match(/<p style/g) || []).length).toBeGreaterThan(1);
    }
  });

  it('quotes the live holdout numbers on the evidence page', () => {
    const html = applyRouteMeta(HTML, '/evidence', '', 'https://x.test');
    expect(html).toMatch(/Rank agreement[^<]*0\.\d+/);
    const report = buildHoldoutReport();
    const home = resolveRouteMeta('/');
    expect(html).toContain(`${report.falseAlarmCount} false alarms`);
    expect(home.description).not.toContain('rank agreement');
    expect(home.description).not.toContain('unseen passages');
  });

  it('puts experiments under Lab and limits lobby navigation to the public destinations', () => {
    const html = applyRouteMeta(HTML, '/lab', '', 'https://x.test');
    expect(html).toContain('href="/arcade"');
    expect(html).toContain('href="/office"');
    expect(html).toContain('href="/lab/powder"');
    expect(html).toContain('href="/play"');
    expect(html).not.toContain('href="/lab"');
    const home = applyRouteMeta(HTML, '/', '', 'https://x.test');
    for (const path of ['/scan', '/arena/', '/office', '/evidence', '/lab']) expect(home).toContain(`href="${path}"`);
    for (const path of ['/play', '/arcade', '/app', '/engine', '/missions', '/reconstruct', '/pricing']) expect(home).not.toContain(`href="${path}"`);
    expect(home).toContain('<details><summary>More</summary>');
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

describe('static application metadata', () => {
  it('brands the initial document as BrainSNN and gives structured data the served route description', () => {
    const template = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(template).not.toContain('Sapient Playground');
    expect(template).toContain('<title>BrainSNN | Turn video into a 3D world</title>');
    const html = applyRouteMeta(template, '/office', '?tab=video', 'https://www.brainsnn.com');
    const structured = JSON.parse(html.match(/<script id="site-schema" type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    expect(structured.name).toBe('BrainSNN');
    expect(structured.description).toBe(resolveRouteMeta('/office', '?tab=video').description);
    expect(structured.url).toBe('https://www.brainsnn.com/office');
    expect(html).not.toContain('decision intelligence');
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
