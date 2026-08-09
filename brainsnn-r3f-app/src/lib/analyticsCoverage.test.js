// Does the analytics allowlist match the code that actually fires events?
//
// It did not. Sixteen event names were being passed to `track()` by real call
// sites and dropped by the allowlist, all of them in the interactive labs:
// `gaugegap_brain_mission_won`, `gaugegap_snn_run`, `gaugegap_content_scan_completed`
// and so on. The failure is silent by construction — `track()` returns early on
// an unknown name — and the symptom is indistinguishable from nobody having
// played the labs at all.
//
// A one-time audit fixes the sixteen. This test is what stops the seventeenth,
// which will otherwise arrive with the next lab.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from '../test/tinyVitest.js';
import { __ALLOWED_EVENTS_FOR_TEST } from './analytics.js';

const ALLOWED = new Set(__ALLOWED_EVENTS_FOR_TEST);

/** The allowlist itself, its server twin and the tests are not call sites. */
const NOT_A_CALL_SITE = /(analytics\.js|eventSink\.js|\.test\.jsx?|\.test\.ts)$/;

function sourceFiles() {
  return execFileSync(
    'find',
    ['src', '-name', '*.js', '-o', '-name', '*.jsx', '-o', '-name', '*.ts', '-o', '-name', '*.tsx'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((file) => file && !NOT_A_CALL_SITE.test(file));
}

/**
 * Event names passed as literals to `track(...)`.
 *
 * Deliberately syntactic rather than clever: it catches `track('name')` and the
 * ternary form `track(cond ? 'a' : 'b')` that useScanEngine.js uses. Names built
 * at runtime are invisible to it, which is a reason not to build them at
 * runtime.
 */
function firedEvents() {
  const fired = new Map();
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/track\(\s*['"]([a-z0-9_]+)['"]/g)) {
      fired.set(match[1], file);
    }
    for (const match of source.matchAll(/track\(\s*[^)'"]*\?\s*['"]([a-z0-9_]+)['"]\s*:\s*['"]([a-z0-9_]+)['"]/g)) {
      fired.set(match[1], file);
      fired.set(match[2], file);
    }
  }
  return fired;
}

describe('analytics coverage', () => {
  it('finds the call sites at all, so a silent pass is impossible', () => {
    // If the regex or the layout ever changes, an empty map would make every
    // assertion below trivially true. This is the canary for that.
    const fired = firedEvents();
    expect(fired.size).toBeGreaterThan(30);
    expect(fired.has('scan_started')).toBe(true);
    // Fired through a ternary, so it only appears if that branch works.
    expect(fired.has('scan_completed')).toBe(true);
  });

  it('allows every event the code fires', () => {
    const dropped = [...firedEvents()]
      .filter(([name]) => !ALLOWED.has(name))
      .map(([name, file]) => `${name} (${file})`);
    // track() drops an unlisted name and returns, so this is data loss with no
    // error anywhere.
    expect(dropped).toEqual([]);
  });

  it('lists no event that no longer exists anywhere in the app', () => {
    // The other direction. A name on the list and in no source file is either a
    // funnel step that was never instrumented or a leftover from deleted code;
    // both make the list a worse description of reality than it looks.
    const sources = sourceFiles().map((file) => readFileSync(file, 'utf8'));
    const unreferenced = [...ALLOWED].filter(
      (name) => !sources.some((source) => source.includes(`'${name}'`) || source.includes(`"${name}"`)),
    );
    // Only `checkout_started` may be declared ahead of its call site: checkout
    // is not open, and the Stripe handler that will fire it already exists.
    expect(unreferenced).toEqual(['checkout_started']);
  });
});
