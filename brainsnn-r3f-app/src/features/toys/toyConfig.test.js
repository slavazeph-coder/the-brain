import { describe, expect, it } from '../../test/tinyVitest.js';
import { readAttribution } from '../../lib/attribution.js';
import {
  getToy,
  otherToys,
  sponsorFor,
  SPONSORS,
  TOYS,
  toyCaption,
  toyFileName,
  toyShareUrl,
} from './toyConfig.js';

function throwsTypeError(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof TypeError;
  }
  return false;
}

describe('toy registry', () => {
  it('toys: every toy has a unique id, route, share source and a written hook', () => {
    const ids = new Set(TOYS.map((toy) => toy.id));
    const paths = new Set(TOYS.map((toy) => toy.path));
    const sources = new Set(TOYS.map((toy) => toy.shareSource));
    expect(ids.size).toBe(TOYS.length);
    expect(paths.size).toBe(TOYS.length);
    expect(sources.size).toBe(TOYS.length);
    for (const toy of TOYS) {
      expect(toy.hook.length).toBeGreaterThan(10);
      expect(toy.shareSource).toMatch(/^toy\d-share$/);
    }
  });

  it('toys: the three written hooks are carried verbatim', () => {
    expect(getToy('poke').hook).toBe('poke the brain and watch the signal travel');
    expect(getToy('fool').hook).toBe('can you fool our AI detector?');
    expect(getToy('duel').hook).toBe('make two drafts fight');
  });

  it('toys: the poke toy lives on the homepage and the others on their own routes', () => {
    expect(getToy('poke').path).toBe('/');
    for (const toy of otherToys('poke')) expect(toy.path.startsWith('/toys/')).toBe(true);
    expect(otherToys('duel').some((toy) => toy.id === 'duel')).toBe(false);
    expect(getToy('nope')).toBe(null);
  });
});

describe('toy share links', () => {
  it('toys: share links carry the per-toy src tag', () => {
    const url = new URL(toyShareUrl('poke'));
    expect(url.origin).toBe('https://www.brainsnn.com');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('src')).toBe('toy1-share');
    expect(new URL(toyShareUrl('fool')).searchParams.get('src')).toBe('toy2-share');
  });

  it('toys: extra params survive but can never override src', () => {
    const url = new URL(toyShareUrl('defend', { params: { lab: 'braingame', state: 'mission~x', src: 'spoofed', empty: '' } }));
    expect(url.searchParams.get('lab')).toBe('braingame');
    expect(url.searchParams.get('state')).toBe('mission~x');
    expect(url.searchParams.get('src')).toBe('toy4-share');
    expect(url.searchParams.has('empty')).toBe(false);
  });

  it('toys: a shared link is attributed to the toy that produced it', () => {
    const search = new URL(toyShareUrl('duel')).search;
    expect(readAttribution(search, '', 'www.brainsnn.com')).toEqual({ share: 'toy3-share' });
  });

  it('toys: the caption leads with the hook and ends with the tagged link', () => {
    const caption = toyCaption('fool', { result: 'Ghost — 80/100' });
    const lines = caption.split('\n');
    expect(lines[0]).toBe('Can you fool our AI detector?');
    expect(lines[1]).toBe('Ghost — 80/100');
    expect(lines[2]).toContain('src=toy2-share');
    expect(toyCaption('duel').split('\n')).toHaveLength(2);
  });

  it('toys: unknown toys are rejected rather than producing a broken link', () => {
    expect(throwsTypeError(() => toyShareUrl('missing'))).toBe(true);
    expect(throwsTypeError(() => toyCaption('missing'))).toBe(true);
  });

  it('toys: download names are filesystem-safe', () => {
    expect(toyFileName('poke', 'Clip 6s!', '.WEBM')).toBe('brainsnn-poke-clip-6s.webm');
    expect(toyFileName('fool', '', '')).toBe('brainsnn-fool-share.png');
  });
});

describe('toy sponsor slots', () => {
  it('toys: sponsor slots ship wired and empty', () => {
    expect(Object.keys(SPONSORS)).toHaveLength(0);
    for (const toy of TOYS) expect(sponsorFor(toy.id)).toBe(null);
  });

  it('toys: a configured sponsor is picked up per toy or site-wide, https links only', () => {
    const sponsors = {
      all: { name: 'Everywhere Inc.', url: 'https://everywhere.example' },
      duel: { name: '  Duel Co.  ', url: 'javascript:alert(1)' },
    };
    expect(sponsorFor('poke', sponsors)).toEqual({ name: 'Everywhere Inc.', url: 'https://everywhere.example/' });
    expect(sponsorFor('duel', sponsors)).toEqual({ name: 'Duel Co.', url: null });
    expect(sponsorFor('fool', { fool: { name: '' } })).toBe(null);
  });
});
