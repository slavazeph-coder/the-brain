import { describe, expect, it } from '../test/tinyVitest.js';
import { ROUTE_PATHS } from './routeMeta.js';
import { buildSitemap } from './sitemap.js';

const ORIGIN = 'https://www.brainsnn.com';

describe('buildSitemap', () => {
  it('lists every route the app serves', () => {
    // The reason the paths are imported rather than retyped: this fails the day
    // someone adds a route and does not think about the sitemap.
    const xml = buildSitemap(ORIGIN);
    for (const path of ROUTE_PATHS) {
      expect(xml).toContain(`<loc>${ORIGIN}${path}</loc>`);
    }
    expect((xml.match(/<loc>/g) || []).length).toBe(new Set(ROUTE_PATHS).size);
  });

  it('declares the namespace crawlers actually check', () => {
    expect(buildSitemap(ORIGIN)).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
  });

  it('is well-formed enough to parse as XML', () => {
    const xml = buildSitemap(ORIGIN);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((xml.match(/<url>/g) || []).length).toBe((xml.match(/<\/url>/g) || []).length);
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('does not double the slash on the homepage', () => {
    expect(buildSitemap(ORIGIN)).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(buildSitemap(ORIGIN)).not.toContain('.com//');
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildSitemap('https://www.brainsnn.com/')).not.toContain('.com//');
  });

  it('escapes a path that would break the document', () => {
    const xml = buildSitemap(ORIGIN, ['/a&b']);
    expect(xml).toContain('/a&amp;b');
    expect(xml).not.toContain('/a&b<');
  });

  it('emits each route once even if asked twice', () => {
    expect((buildSitemap(ORIGIN, ['/lab', '/lab']).match(/<loc>/g) || []).length).toBe(1);
  });
});
