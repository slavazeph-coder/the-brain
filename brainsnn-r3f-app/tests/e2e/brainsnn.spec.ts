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
  // Keep CI deterministic and off software WebGL: force the 2D brain fallback.
  await page.addInitScript(() => localStorage.setItem('brainsnn:force-brain-2d', '1'));
  await mockBackend(page);
});

test('content reaction lab runs a fully local simulation on the homepage', async ({ page }) => {
  const analyzeRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/analyze')) analyzeRequests.push(request.url());
  });

  await page.goto('/?lab=content#playground');
  await expect(page.getByRole('heading', { name: /Do not just explain the idea/i })).toBeVisible();
  await expect(page.getByTestId('content-reaction-lab')).toBeVisible();

  await page.getByLabel('Content to simulate').fill('Only forty were ever made. Private viewings close this week, and the small circle of people who understand why that matters is almost full.');
  await page.getByRole('button', { name: 'Run simulation' }).click();

  // Four headline tiles fill with numeric values from the in-browser engine.
  await expect(page.locator('.gg-content-score strong').first()).toHaveText(/^\d+$/, { timeout: 5_000 });
  await expect(page.locator('.gg-content-score')).toHaveCount(4);
  await expect(page).toHaveURL(/\/\?lab=content/);
  expect(analyzeRequests).toEqual([]);

  // Rewrite panel produces a scored alternative without leaving the page.
  await page.getByRole('button', { name: 'Reduce manipulation' }).click();
  await expect(page.getByTestId('content-rewrite')).toBeVisible();

  // The escape hatch into the full analyst app carries the content along.
  await page.getByRole('button', { name: /Open full analysis/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('#brain-scan-input')).not.toHaveValue('');
});

test('spiking network lab runs in a worker and shows the regimes', async ({ page }) => {
  await page.goto('/?lab=spiking#playground');
  await expect(page.getByTestId('spiking-network-lab')).toBeVisible();
  // The first run is kicked off on mount and executes off the main thread.
  await expect(page.getByTestId('snn-hud')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('snn-hud')).toContainText(/Hz/i);

  // Sub-threshold external drive must silence the network entirely.
  await page.getByRole('button', { name: 'Below threshold' }).click();
  await page.getByRole('button', { name: /Run network/ }).click();
  await expect(page.getByTestId('snn-hud')).toContainText('0 Hz', { timeout: 30_000 });
});

test('defend the brain mission is machine-checked and losable', async ({ page }) => {
  await page.goto('/?lab=braingame#playground');
  await expect(page.getByTestId('brain-game-lab')).toBeVisible();
  await expect(page.getByTestId('brain-game-hud')).toContainText(/Hijack/i);

  // Doing nothing must actually lose — the arcade's first real fail state.
  await expect(page.getByTestId('brain-game-banner')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('brain-game-banner')).toContainText('Judgment offline');

  // Replaying and intervening keeps the run alive past the point it just failed.
  await page.getByRole('button', { name: 'Play again' }).click();
  await page.getByRole('button', { name: /Silence threat/ }).click();
  await expect(page.getByTestId('brain-game-hud')).toContainText('5/6');
});

test('content lab shows per-sentence math with a jackknife band', async ({ page }) => {
  await page.goto('/?lab=content#playground');
  await page.getByLabel('Content to simulate').fill(
    'Our team shipped a small update to the billing page this week. '
    + 'URGENT: verify your account within 24 hours or it will be permanently deleted, click immediately!',
  );
  await page.getByRole('button', { name: 'Run simulation' }).click();

  const math = page.getByTestId('content-math');
  await expect(math).toBeVisible();
  // The pressure sentence, not the benign opener, should own the risk score.
  await expect(math.locator('.gg-content-drivers li').first()).toContainText('URGENT');
  await expect(math.locator('.gg-content-drivers li em').first()).toContainText('% of Manipulation Risk');

  // Every score states where it sits against the labelled corpus, rather than
  // implying the index is a percentage.
  await expect(page.locator('.gg-content-score small').first()).toContainText(/percentile|higher than|lower than/);
  await expect(page.getByTestId('calibration-card')).toContainText(/Ranks \d+% of \d+ labelled comparisons/);

  // Switching the explained score re-attributes.
  await math.getByRole('tab', { name: 'Attention' }).click();
  await expect(math.locator('.gg-content-drivers li em').first()).toContainText('% of Attention');
});

test('shared challenge link prefills and auto-runs the content lab', async ({ page }) => {
  const sample = 'Only forty were ever made. Private viewings close this week.';
  await page.goto(`/?lab=content&state=${encodeURIComponent(sample)}#playground`);
  await expect(page.getByLabel('Content to simulate')).toHaveValue(sample);
  await expect(page.locator('.gg-content-score strong').first()).toHaveText(/^\d+$/, { timeout: 5_000 });
});

test('arcade selector opens the content lab from the featured row', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Mind-Hack Autopsy/ }).click();
  await expect(page.getByTestId('content-reaction-lab')).toBeVisible();
  await expect(page).toHaveURL(/lab=content/);
});

test('reconstruct page renders from a direct route and links into the scanner', async ({ page }) => {
  await page.goto('/reconstruct');
  await expect(page.getByTestId('reconstruct-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Grab the site. Ship the proof.' })).toBeVisible();
  await expect(page.getByText('npm run reconstruct -- grab https://example.com')).toBeVisible();
  await expect(page.getByRole('link', { name: /Open GitHub/ })).toHaveAttribute('href', /github\.com\/XioAISolutions\/Reconstruct/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: /Scan this pitch/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page).toHaveTitle('BrainSNN | Decision Engine for Brand Content');
  await expect(page.locator('#brain-scan-input')).toHaveValue(/Reconstruct is the proof-first/);
});

test('landing deeper-tools card opens the Reconstruct page without a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Build a defensible claim/ }).click();
  await expect(page).toHaveURL(/\/reconstruct$/);
  await expect(page.getByTestId('reconstruct-page')).toBeVisible();
});

test('3D brain mounts or falls back cleanly without console errors', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'Mobile always uses the 2D fallback by design.');
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // No force-2d flag on this navigation: clear it before load. The 3D brain
  // now lives inside the arcade's content lab.
  await page.addInitScript(() => localStorage.removeItem('brainsnn:force-brain-2d'));
  await page.goto('/?lab=content#playground');
  await page.waitForTimeout(4000);
  const has3d = await page.locator('.brain3d canvas').count();
  const hasFallback = await page.locator('.brain-visualizer').count();
  expect(has3d + hasFallback).toBeGreaterThan(0);
  // Resource-load failures (fonts/CDN blocked in CI sandboxes) are not app
  // errors; this test guards against exceptions from the 3D mount itself.
  const fatal = errors.filter((text) => !/favicon|manifest|WebGL warning|Failed to load resource/i.test(text));
  expect(fatal).toEqual([]);
});

test('core analyze to export workflow works with deterministic fallback data', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Know how it lands before you publish.' })).toBeVisible();

  await runScan(page);
  await page.getByRole('tab', { name: /Advanced/ }).click();
  await expect(page.getByRole('heading', { name: 'Layers used in this scan' })).toBeVisible();

  await page.getByRole('button', { name: /Improve This/ }).click();
  await expect(page.getByTestId('synapse-workspace')).toBeVisible();
  await page.getByRole('button', { name: /Score both versions/ }).click();
  await expect(page.getByText('Version 1 vs Version 2')).toBeVisible();

  await page.getByRole('button', { name: /Save as version/ }).click();
  await page.getByRole('button', { name: /Mark for approval/ }).click();
  await expect(page.getByTestId('queue-workspace')).toBeVisible();
  await page.getByRole('button', { name: /^Export$/ }).first().click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByText('Share your score')).toBeVisible();
  await expect(page.getByText('Copy public result link')).toBeVisible();
});

test('memory, autopsy, pricing and accessibility surfaces render', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'Desktop nav owns direct History/Pricing access; mobile shell is covered separately.');
  await page.goto('/app');
  await runScan(page);
  await page.getByRole('button', { name: /Save to History/ }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toBeVisible();

  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByTestId('autopsy-workspace')).toBeVisible();
  await page.getByRole('button', { name: /Compare variants/ }).click();
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
  await mobileNav.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByTestId('autopsy-workspace')).toBeVisible();
  await mobileNav.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog', { name: 'More navigation' })).toBeVisible();
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('button', { name: 'Pricing' }).click();
  await expect(page.getByTestId('pricing-workspace')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('defend the brain renders a real 3D board driven by detected techniques', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // The suite-wide beforeEach forces the 2D fallback to keep CI off software
  // WebGL; this test is specifically about the 3D board, so clear it.
  await page.addInitScript(() => localStorage.removeItem('brainsnn:force-brain-2d'));
  await page.goto('/?lab=braingame#playground');
  await expect(page.getByTestId('brain-game-lab')).toBeVisible();
  await expect(page.locator('[data-testid="brain-game-3d"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-testid="brain-game-3d"] canvas')).toBeVisible({ timeout: 45_000 });

  // The attack is built from the persuasion detector, so the panel names real
  // taxonomy classes and quotes the phrases that triggered them.
  const breakdown = page.getByTestId('brain-game-breakdown');
  await expect(breakdown).toBeVisible();
  await expect(breakdown).toContainText(/Appeal to Time|Exaggeration|Bandwagon|Doubt/);

  // Switching levels rebuilds the attack from a different passage.
  await page.getByTestId('brain-game-level').selectOption('guru-urgency-pitch');
  await expect(breakdown.locator('li')).toHaveCount(5, { timeout: 20_000 });

  expect(errors).toEqual([]);
});

test('defend the brain falls back to the 2D board without WebGL', async ({ page }) => {
  // The 3D board is an upgrade, never a requirement: the game has to stay
  // playable when WebGL is unavailable.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(type: string, ...rest: unknown[]) {
      if (type === 'webgl' || type === 'webgl2') return null;
      return original.call(this, type, ...rest);
    };
  });

  await page.goto('/?lab=braingame#playground');
  await expect(page.getByTestId('brain-game-lab')).toBeVisible();
  await expect(page.locator('[data-testid="brain-game-3d"]')).toHaveCount(0);
  await expect(page.locator('canvas.gg-brain-game-canvas')).toBeVisible();
  await expect(page.getByTestId('brain-game-hud')).toContainText(/Hijack/i);
});

test('a run proof carries no text from the level it was played on', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?lab=braingame#playground');
  await expect(page.getByTestId('brain-game-lab')).toBeVisible();

  // Build a level from text with distinctive words, then export a proof and
  // assert none of those words made it in. A proof is meant to be shared.
  await page.getByTestId('brain-game-level').selectOption('custom');
  await page.getByTestId('brain-game-custom-text')
    .fill('URGENT: doors close tonight, zebra pineapple, and everyone else has already joined.');
  await page.getByRole('button', { name: 'Build the level' }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export run proof/ }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const proof = Buffer.concat(chunks).toString('utf8').toLowerCase();

  expect(proof).toContain('defend_the_brain_run');
  for (const secret of ['zebra', 'pineapple', 'doors close', 'urgent']) {
    expect(proof).not.toContain(secret);
  }
});
