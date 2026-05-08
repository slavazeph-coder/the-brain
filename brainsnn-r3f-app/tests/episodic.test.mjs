/**
 * Layer 101 — Smoke tests for the pure episodic modules.
 *
 * Run with:  node --test tests/episodic.test.mjs
 *
 * Scope: only modules that have NO Vite-specific imports (no
 * import.meta.env, no transformers.js, no localStorage at import
 * time). episodicPII and episodicTaxonomy qualify.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectPII, redactPII, piiLabel } from '../src/utils/episodicPII.js';
import {
  EPISODIC_CATEGORIES,
  EPISODIC_IDS,
  EPISODIC_CLUSTERS,
  categoryColor,
  clusterFor,
  DEFAULT_REGIONS
} from '../src/data/episodicTaxonomy.js';

describe('episodicTaxonomy', () => {
  it('exposes 8 categories', () => {
    assert.equal(EPISODIC_IDS.length, 8);
  });

  it('every category has triggers and region affinities', () => {
    for (const id of EPISODIC_IDS) {
      const cat = EPISODIC_CATEGORIES[id];
      assert.ok(cat, `category ${id} exists`);
      assert.ok(Array.isArray(cat.triggers) && cat.triggers.length >= 2, `${id} has ≥2 triggers`);
      assert.ok(cat.regions && Object.keys(cat.regions).length >= 2, `${id} has region affinities`);
      assert.ok(EPISODIC_CLUSTERS[cat.cluster], `${id} cluster ${cat.cluster} exists`);
      assert.ok(typeof cat.color === 'string' && /^#/.test(cat.color), `${id} color is hex`);
    }
  });

  it('decision triggers fire on canonical phrases', () => {
    const dec = EPISODIC_CATEGORIES.decision.triggers;
    const text = 'We decided to go with Postgres because of query flexibility.';
    const fired = dec.some((rx) => rx.test(text));
    assert.equal(fired, true);
  });

  it('incident triggers fire on canonical phrases', () => {
    const inc = EPISODIC_CATEGORIES.incident.triggers;
    const text = 'Production outage at 14:02 — auth service crashed.';
    const fired = inc.some((rx) => rx.test(text));
    assert.equal(fired, true);
  });

  it('artifact triggers fire on a URL', () => {
    const art = EPISODIC_CATEGORIES.artifact.triggers;
    const text = 'Saving https://example.com/post for later.';
    const fired = art.some((rx) => rx.test(text));
    assert.equal(fired, true);
  });

  it('categoryColor falls back to grey for unknown ids', () => {
    assert.equal(categoryColor('does-not-exist'), '#7c8aa1');
  });

  it('clusterFor returns the right cluster for each category', () => {
    assert.equal(clusterFor('decision').label, 'From you');
    assert.equal(clusterFor('insight').label, 'From you');
    assert.equal(clusterFor('artifact').label, 'From the world');
    assert.equal(clusterFor('person').label, 'About people');
    assert.equal(clusterFor('incident').label, 'Pivots & shocks');
  });

  it('clusterFor falls back to external for unknown ids', () => {
    assert.equal(clusterFor('nope').label, 'From the world');
  });

  it('DEFAULT_REGIONS sums to a reasonable diffuse activation', () => {
    const sum = Object.values(DEFAULT_REGIONS).reduce((s, v) => s + v, 0);
    assert.ok(sum > 0.5 && sum < 1.5, `default regions sum is ${sum}`);
  });

  it('every category cluster id is a known cluster', () => {
    const clusterIds = new Set(Object.keys(EPISODIC_CLUSTERS));
    for (const id of EPISODIC_IDS) {
      const cat = EPISODIC_CATEGORIES[id];
      assert.ok(clusterIds.has(cat.cluster), `${id} cluster ${cat.cluster} is known`);
    }
  });
});

describe('episodicPII', () => {
  it('detects an email', () => {
    const pii = detectPII('Reach me at alice@example.com please');
    assert.equal(pii.total >= 1, true);
    assert.equal(pii.first, 'email');
    assert.deepEqual(pii.kinds.email, ['alice@example.com']);
  });

  it('detects an OpenAI-style API key', () => {
    const pii = detectPII('export OPENAI_KEY=sk-abcd1234efgh5678ijkl9012mnop3456qrst');
    assert.equal(pii.total >= 1, true);
    assert.equal(pii.first, 'apiKey');
  });

  it('detects an SSN-shaped string', () => {
    const pii = detectPII('His SSN is 123-45-6789, do not share');
    const ssn = pii.kinds.ssn || [];
    assert.equal(ssn.length, 1);
  });

  it('detects an IPv4', () => {
    const pii = detectPII('Server is at 192.168.1.42 right now');
    assert.equal((pii.kinds.ipv4 || []).length, 1);
  });

  it('does not crash on empty input', () => {
    const pii = detectPII('');
    assert.equal(pii.total, 0);
    assert.equal(pii.first, null);
  });

  it('does not crash on non-string input', () => {
    const pii = detectPII(undefined);
    assert.equal(pii.total, 0);
  });

  it('caps hits per kind at 5', () => {
    const text = 'a@a.com b@b.com c@c.com d@d.com e@e.com f@f.com g@g.com';
    const pii = detectPII(text);
    assert.equal((pii.kinds.email || []).length, 5);
  });

  it('strips URLs before long-secret scan', () => {
    const pii = detectPII('see https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa for details');
    // The path looks like a long token but should be excluded due to URL strip.
    assert.equal((pii.kinds.longSecret || []).length, 0);
  });

  it('redactPII replaces detected values with typed placeholders', () => {
    const out = redactPII('email me at bob@example.com or call 555-123-4567');
    assert.equal(/<EMAIL_REDACTED>/.test(out), true);
    assert.equal(/<PHONE_REDACTED>/.test(out), true);
    assert.equal(out.includes('bob@example.com'), false);
  });

  it('piiLabel returns a known label', () => {
    assert.equal(piiLabel('email'), 'email');
    assert.equal(piiLabel('apiKey'), 'API key');
  });

  it('detects a GitHub PAT', () => {
    const pii = detectPII('GIT_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa rest');
    assert.equal((pii.kinds.apiKey || []).length, 1);
  });

  it('detects an AWS access key', () => {
    const pii = detectPII('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE for testing');
    assert.equal((pii.kinds.apiKey || []).length, 1);
  });

  it('detects a Stripe live-prefixed secret shape', () => {
    // Synthetic — high-entropy real Stripe keys are flagged by the
    // remote secret scanner; this string is a flat repeat that still
    // matches the 20+ alnum body of the prefix regex.
    const fake = 'sk_live_' + 'X'.repeat(28);
    const pii = detectPII(`use ${fake} now`);
    assert.equal((pii.kinds.apiKey || []).length, 1);
  });

  it('phone hits include common North American formats', () => {
    const pii = detectPII('Call me at (555) 123-4567 or 555-987-6543');
    assert.equal((pii.kinds.phone || []).length >= 1, true);
  });

  it('total counts across multiple kinds', () => {
    const pii = detectPII('email a@b.com and SSN 111-22-3333 in one note');
    assert.ok(pii.total >= 2);
    assert.ok(Object.keys(pii.kinds).length >= 2);
  });
});
