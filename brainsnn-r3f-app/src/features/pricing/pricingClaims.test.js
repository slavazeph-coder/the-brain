// The pricing page is a set of claims made to someone about to pay.
//
// Before this test the page listed "5 / 30 / 200 analyses per month",
// "watermarked exports" and "synced history when Supabase is configured". None
// of it existed — no quota code, no watermarking, no Supabase client, no
// account state — and the Stripe webhook only console.logs, so a completed
// purchase granted nothing. It also told people "You're on the Pro list" while
// storing the email precisely nowhere.
//
// This is the same discipline the engine's palette and stamp blurbs are held
// to, pointed at commercial copy, where being wrong costs someone money.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from '../../test/tinyVitest.js';
import { BETA_NOTE, PRICING_PLANS, planCopy } from './pricingPlans.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../..');

const pricingSource = readFileSync(path.join(here, 'PricingWorkspace.jsx'), 'utf8');

/** Capability names that only belong on the page once code implements them. */
const UNIMPLEMENTED_CAPABILITIES = [
  { claim: /\banalyses\s*\/\s*month\b/i, needs: 'per-month quota enforcement' },
  { claim: /\bwatermark/i, needs: 'export watermarking' },
  { claim: /\bsynced history\b/i, needs: 'a Supabase client and session handling' },
];

describe('pricing copy only claims what the code does', () => {
  const copy = planCopy();

  for (const { claim, needs } of UNIMPLEMENTED_CAPABILITIES) {
    // Checked against the plan data a visitor actually reads, not the file
    // text — the source also carries a comment naming the removed claims.
    it(`does not advertise ${needs}`, () => {
      expect(claim.test(copy)).toBe(false);
    });
  }

  // The specific lie: a confirmation for a list that did not exist.
  it('never tells anyone they are on a list', () => {
    expect(/on the \$\{|You're on the/i.test(pricingSource)).toBe(false);
    expect(/waitlist/i.test(pricingSource)).toBe(false);
  });

  it('says plainly that subscriptions are not open', () => {
    expect(/not open yet/i.test(BETA_NOTE)).toBe(true);
  });

  // Guards the fall-through at server.ts: an unknown plan used to resolve to
  // the Basic price id, so a "Team Pilot" click could have charged Basic.
  it('offers no plan that would resolve to the wrong Stripe price', () => {
    // server.ts maps any plan that is not "pro" onto STRIPE_PRICE_BASIC, so a
    // tier that reached checkout under another id could charge the wrong price.
    expect(PRICING_PLANS.length).toBeGreaterThan(0);
    for (const plan of PRICING_PLANS) {
      expect(['free', 'team'].includes(plan.id)).toBe(true);
    }
  });
});

describe('analytics never leaks the text being analysed', () => {
  // The whole product analyses pasted text. None of it may leave the browser
  // through the event pipeline, whatever a caller passes.
  it('strips content fields from every event', async () => {
    const { sanitizeProperties } = await import('../../lib/analytics.js');
    const safe = sanitizeProperties({
      content: 'secret campaign copy',
      rawContent: 'secret',
      text: 'secret',
      plan: 'team',
    });
    expect(safe.content).toBe(undefined);
    expect(safe.rawContent).toBe(undefined);
    expect(safe.text).toBe(undefined);
    expect(safe.plan).toBe('team');
  });

  it('fires the commerce events that were previously declared and never called', () => {
    // upgrade_clicked / pilot_clicked / pricing_viewed existed in the allowlist
    // with zero call sites, so the funnel reported nothing even once a sink
    // was connected.
    expect(/track\('pricing_viewed'/.test(pricingSource)).toBe(true);
    expect(/track\('pilot_clicked'/.test(pricingSource)).toBe(true);

    const leadForm = readFileSync(path.join(src, 'features/leads/LeadForm.jsx'), 'utf8');
    expect(/track\('lead_captured'/.test(leadForm)).toBe(true);
  });
});

describe('the lead form never claims a lead it did not capture', () => {
  const leadForm = readFileSync(path.join(src, 'features/leads/LeadForm.jsx'), 'utf8');

  it('shows the sent state only when the server confirms it', () => {
    // setState('sent') must be reachable only from an ok response.
    expect(/response\.ok && body\.ok[\s\S]{0,120}setState\('sent'\)/.test(leadForm)).toBe(true);
  });

  it('offers a mailto fallback whenever delivery fails', () => {
    expect(/setState\('failed'\)/.test(leadForm)).toBe(true);
    expect(/composeBriefMailto\(lead, failure\.email\)/.test(leadForm)).toBe(true);
  });
});
