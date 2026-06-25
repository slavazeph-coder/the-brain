import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const sampleContent = 'Most ads ask for attention before earning trust. Show proof first, then invite the buyer to decide.';

function mockAnalysis(content = sampleContent) {
  return {
    id: 'scan-e2e',
    timestamp: '2026-06-24T12:00:00.000Z',
    title: 'E2E Brain Scan',
    rawContent: content,
    contentType: 'text',
    metrics: {
      trust: 48,
      urgency: 70,
      empathy: 56,
      fear: 44,
      anger: 18,
      excitement: 82,
      firingRate: 63,
      plasticity: 58,
      wavesDamping: 0.32,
      wavesFrequency: 1.2,
    },
    attentionCurve: [
      { label: 'Opening', value: 82, reason: 'Strong attention signal' },
      { label: 'Close', value: 54, reason: 'Trust builder' },
    ],
    riskRating: 'Medium',
    riskDescription: 'Unsupported urgency may weaken credibility.',
    viralScore: 74,
    gaugeGapScore: 66,
    summary: 'Strong hook. Trust risk.',
    insights: [
      { label: 'What works', text: 'Specific promise and immediate tension.' },
      { label: 'What hurts', text: 'Scarcity language feels forced.' },
      { label: 'Best next move', text: 'Keep the opening. Replace the final command with proof.' },
    ],
    recommendations: [
      { id: 'trust', title: 'Build trust earlier', goal: 'Build trust', rationale: 'Proof before pressure improves credibility.', rewriteHint: 'Add a concrete proof point.' },
      { id: 'risk', title: 'Reduce manipulation', goal: 'Reduce manipulation', rationale: 'Urgency works better with evidence.', rewriteHint: 'Replace forced scarcity with a calm reason.' },
    ],
    payloadType: 'content_response_estimate',
    confidence: 76,
    crumbModelStats: {
      model: 'brainsnn-local-demo-v1',
      latencyMs: 12,
      tokensEstimated: 18,
      note: 'AI-estimated content response signals.',
      layersEvaluated: 13,
      totalLayersAvailable: 102,
    },
    isFallback: true,
    heatmap: [
      { id: 'segment-1', text: 'Most ads ask for attention before earning trust.', score: 82, category: 'Strong attention signal', reason: 'Likely to stop the scroll.' },
      { id: 'segment-2', text: 'Show proof first, then invite the buyer to decide.', score: 64, category: 'Trust builder', reason: 'Proof language supports credibility.' },
    ],
    firewallSignals: {
      emotionalActivation: 0.62,
      cognitiveSuppression: 0.36,
      manipulationPressure: 0.66,
      trustErosion: 0.52,
      density: 0.2,
      evidence: [{ label: 'proof', match: 'proof' }],
      templates: [{ id: 'forced-urgency', label: 'Forced urgency', risk: 'Pressure appears before proof.' }],
      source: 'deterministic-firewall-fallback',
    },
    affectProfile: {
      dominantAffect: 'curiosity',
      valence: 58,
      arousal: 72,
      clusters: [
        { id: 'threat', label: 'Threat', value: 44 },
        { id: 'reward', label: 'Reward', value: 82 },
        { id: 'social', label: 'Social trust', value: 48 },
        { id: 'cognitive', label: 'Curiosity / clarity', value: 72 },
      ],
    },
    contextTriggers: {
      genre: 'paid_ad',
      entityCandidates: ['BrainSNN'],
      recurringSignals: ['Forced urgency'],
      memoryPrompt: 'Track future scans for trust and proof.',
    },
    tribeProjection: {
      source: 'TRIBE-informed local projection',
      status: 'not_configured',
      scenario: 'Emotional Salience & Trust',
      regions: { CTX: 72, HPC: 64, THL: 48, AMY: 62, BG: 74, PFC: 55, CBL: 50 },
      note: 'TRIBE v2 service is not configured, so BrainSNN used the local projection layer.',
    },
    layersUsed: [
      { id: 3, name: 'TRIBE v2 Frames', group: 'backend', blurb: 'TRIBE v2 projection layer.' },
      { id: 4, name: 'Cognitive Firewall', group: 'firewall', blurb: 'Deterministic pressure scoring.' },
      { id: 29, name: 'Affective Decoder', group: 'firewall', blurb: 'Affect trigger decoding.' },
      { id: 40, name: 'Sentence Heatmap', group: 'firewall', blurb: 'Sentence-level annotation.' },
      { id: 46, name: 'Firewall Receipts', group: 'share', blurb: 'Deterministic scan receipt.' },
    ],
    engineTrace: [
      { stage: 'L102 Lobster Trap', status: 'local_preflight', note: 'Safety preflight represented.' },
      { stage: 'L4 Cognitive Firewall', status: 'completed', note: 'Template signals evaluated.' },
      { stage: 'L3 TRIBE v2 Projection', status: 'not_configured', note: 'Local 7-region projection layer used.' },
    ],
    receipt: {
      id: 'bsnn-e2e',
      contentHash: 'e2e',
      resultHash: 'result',
      generatedAt: '2026-06-24T12:00:00.000Z',
      disclaimer: 'AI-estimated content response.',
    },
    researchNotes: ['TRIBE v2 is used as a projection layer unless configured.'],
  };
}

async function mockBackend(page) {
  await page.route('**/api/analyze', async (route) => {
    const body = route.request().postDataJSON() as { content?: string } | undefined;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockAnalysis(body?.content || sampleContent)) });
  });
  await page.route('**/api/engines/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      totalLayers: 102,
      engines: {
        stripe: { configured: false, status: 'not_configured' },
        supabase: { configured: false, status: 'not_configured' },
        openai: { configured: false, status: 'not_configured' },
        gemini: { configured: false, status: 'not_configured' },
        gemma: { configured: false, status: 'not_configured' },
        tribe: { configured: false, status: 'not_configured' },
      },
    }),
  }));
  await page.route('**/api/billing/checkout', (route) => route.fulfill({
    status: 501,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Stripe Checkout is not configured.', status: 'not_configured' }),
  }));
}

async function runScan(page) {
  await page.getByRole('button', { name: 'Paid ad' }).click();
  await page.getByRole('button', { name: /Run Brain Scan/ }).click();
  await expect(page.getByRole('status').getByText('Reading the message').first()).toBeVisible();
  await expect(page.getByTestId('results-workspace')).toBeVisible();
  await expect(page.getByText('Demo model result').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('interactive landing routes into the scanner with a prefilled sample', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /See response signals in any content/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Launch Active Demo/ })).toBeVisible();
  await page.getByRole('button', { name: /Launch Active Demo/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Know how it lands before you publish.' })).toBeVisible();
  await expect(page.locator('#brain-scan-input')).not.toHaveValue('');
});

test('core analyze to export workflow works with deterministic fallback data', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Know how it lands before you publish.' })).toBeVisible();

  await runScan(page);
  await expect(page.getByRole('heading', { name: 'Layers used in this scan' })).toBeVisible();

  await page.getByRole('button', { name: /Improve This/ }).click();
  await expect(page.getByTestId('synapse-workspace')).toBeVisible();
  await page.getByRole('button', { name: /Run comparison/ }).click();
  await expect(page.getByText('Version 1 vs Version 2')).toBeVisible();

  await page.getByRole('button', { name: /Save as version/ }).click();
  await page.getByRole('button', { name: /Mark for approval/ }).click();
  await expect(page.getByTestId('queue-workspace')).toBeVisible();
  await page.getByRole('button', { name: /^Export$/ }).first().click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByText('Copy public result link')).toBeVisible();
});

test('memory, autopsy, pricing and accessibility surfaces render', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'Desktop nav owns direct History/Pricing access; mobile shell is covered separately.');
  await page.goto('/app');
  await runScan(page);
  await page.getByRole('button', { name: /Save to Memory/ }).click();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByTestId('memory-workspace')).toBeVisible();

  await page.getByRole('button', { name: 'Autopsy' }).click();
  await expect(page.getByTestId('autopsy-workspace')).toBeVisible();
  await page.getByRole('button', { name: /Run Autopsy/ }).click();
  await expect(page.getByText(/Variant [AB] wins|Tie/)).toBeVisible();

  await page.getByRole('button', { name: 'Pricing' }).click();
  await expect(page.getByTestId('pricing-workspace')).toBeVisible();
  await expect(page.getByText('$9/mo')).toBeVisible();

  const accessibilityScanResults = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  const serious = accessibilityScanResults.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
  expect(serious).toEqual([]);
});

test('mobile navigation has no horizontal overflow at 390px', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'Mobile navigation is hidden in the desktop shell.');
  await page.goto('/app');
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole('button', { name: 'Autopsy' }).click();
  await expect(page.getByTestId('autopsy-workspace')).toBeVisible();
  await mobileNav.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog', { name: 'More navigation' })).toBeVisible();
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('button', { name: 'Pricing' }).click();
  await expect(page.getByTestId('pricing-workspace')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
