import { describe, expect, it } from '../test/tinyVitest.js';
import { legacyRedirect } from './legacyRoutes.js';

describe('public route migration', () => {
  it('preserves attribution and input queries while selecting the appropriate Review tab', () => {
    expect(legacyRedirect('/app/', '?src=old-link')).toBe('/office?src=old-link&tab=passage');
    expect(legacyRedirect('/engine', '?tab=bad')).toBe('/office?tab=drafts');
    expect(legacyRedirect('/reconstruct')).toBe('/office?tab=claims');
  });
  it('keeps curated tasks and published identifiers addressable inside Arena', () => {
    expect(legacyRedirect('/missions')).toBe('/arena/');
    expect(legacyRedirect('/missions/navigation-baseline')).toBe('/arena/tasks/navigation-baseline');
    expect(legacyRedirect('/m/example-42')).toBe('/arena/tasks/published/example-42');
    expect(legacyRedirect('/missions/build')).toBe('/arena/tasks/build');
  });
  it('opens old powder grids without stealing ordinary Lab index links', () => {
    expect(legacyRedirect('/lab', '?grid=abc&s=lab')).toBe('/lab/powder?grid=abc&s=lab');
    expect(legacyRedirect('/lab', '?src=nav')).toBe(null);
    expect(legacyRedirect('/lab/powder', '?grid=abc')).toBe(null);
  });
  it('never redirects API paths or already canonical destinations', () => {
    for (const path of ['/api/missions', '/office', '/arena/tasks/build', '/play', '/evidence']) expect(legacyRedirect(path)).toBe(null);
  });
});
