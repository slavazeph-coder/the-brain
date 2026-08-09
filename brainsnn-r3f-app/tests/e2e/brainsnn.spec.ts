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
  // Scan + history + compare + pricing + a full axe pass in one test lands at
  // ~30s alone, which is exactly the default timeout, so it tipped over
  // whenever a second worker competed for CPU. Its heavy neighbours all set
  // this explicitly; this one had been relying on the margin.
  test.setTimeout(90_000);
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
  // Was "$9/mo" — a tier whose per-month limits no code enforced. The page now
  // states what is true: free during beta, pilots are the paid thing.
  await expect(page.getByText('$0')).toBeVisible();
  await expect(page.getByTestId('pricing-workspace')).toContainText(/not open yet/i);

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

test('a shared challenge link restores the level it was played on', async ({ page }) => {
  // braingame used to write ?state= and never read it back, so every shared
  // link opened the default level. Both halves of the round trip are covered.
  await page.goto('/?lab=braingame&state=challenge~outrage-bait-post#playground');
  await expect(page.getByTestId('brain-game-lab')).toBeVisible();
  await expect(page.getByTestId('brain-game-level')).toHaveValue('outrage-bait-post');
  await expect(page.locator('.gg-deep-toggle button.active')).toHaveText('Challenge');

  // A pasted passage travels with the link and rebuilds the same attack.
  const shared = 'mission~custom~Doors close tonight, and everyone else has already joined.';
  await page.goto(`/?lab=braingame&state=${encodeURIComponent(shared)}#playground`);
  await expect(page.getByTestId('brain-game-level')).toHaveValue('custom');
  await expect(page.getByTestId('brain-game-custom-text')).toHaveValue(/Doors close tonight/);
  await expect(page.getByTestId('brain-game-breakdown').locator('li').first()).toBeVisible();
});

test('the neuro powder lab runs a live simulation at /lab', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/lab');
  await expect(page.getByTestId('powder-lab')).toBeVisible();
  await expect(page.getByTestId('powder-canvas')).toBeVisible();

  // The full 14-material palette, and the four brain materials among them.
  await expect(page.locator('.powder-swatch')).toHaveCount(14);
  await expect(page.getByTestId('powder-palette')).toContainText('Neuro');
  await expect(page.getByTestId('powder-palette')).toContainText('Synapse');

  // The opening scene is seeded, so the HUD reports a real circuit rather than
  // an empty grid, and the loop is actually running.
  const hud = page.getByTestId('powder-hud');
  await expect(hud).toContainText(/Neurons/);
  await expect(hud).toContainText(/Synapses/);
  await expect(async () => {
    const text = (await hud.textContent()) || '';
    const fps = Number(/FPS\s*(\d+)/.exec(text)?.[1] ?? 0);
    expect(fps).toBeGreaterThan(20);
  }).toPass({ timeout: 15_000 });

  // The model toggle swaps in the Brunel-derived parameters and says so.
  await page.getByTestId('powder-model-real').click();
  await expect(page.locator('.powder-model-note')).toContainText(/Threshold 20 mV/);

  expect(errors).toEqual([]);
});

test('the powder lab lede does not overclaim the model it loads with', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/lab');
  await expect(page.getByTestId('powder-lab')).toBeVisible();

  const lede = page.locator('.powder-lede');
  // The page loads on the tuned constants, whose own note calls them
  // arbitrary. The lede used to end "not numbers invented for a game", which
  // contradicted that note three panels away.
  await expect(lede).not.toContainText(/not numbers invented for a game/i);
  await expect(lede).toContainText(/start tuned/i);
  await expect(lede).toContainText(/Brunel/);

  // And the note it must stay consistent with is the one on screen by default.
  await expect(page.locator('.powder-model-note')).toContainText(/[Aa]rbitrary constants/);
});

test('the powder lab is reachable from the homepage, not just by typing the URL', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');

  // The featured card is how most people will actually find it, and it is the
  // only one of the two routes that exists on a narrow viewport — .gg-nav-links
  // is display:none there.
  const card = page.locator('.gg-lab-card', { hasText: 'Neuro Powder Lab' });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: /Open the sandbox/ }).click();
  await expect(page.getByTestId('powder-lab')).toBeVisible();
  await expect(page).toHaveURL(/\/lab$/);
});

test('the powder lab has a link in the desktop navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '.gg-nav-links is display:none below 900px');
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('nav-powder-lab').click();
  await expect(page.getByTestId('powder-lab')).toBeVisible();
  await expect(page).toHaveURL(/\/lab$/);
});

test('powder lab objectives are earned by building, not handed out', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/lab');
  await expect(page.getByTestId('powder-canvas')).toBeVisible();

  const panel = page.getByTestId('powder-missions');
  await expect(panel).toBeVisible();

  // Clear first: nothing on the grid means nothing can have been earned.
  await page.getByTestId('powder-clear').click();
  const spark = panel.locator('[data-mission="first-spark"]');
  const dopamine = panel.locator('[data-mission="dopamine"]');
  await expect(spark).toHaveAttribute('data-complete', 'false');

  // Draw a neuron and stimulate it. That, and only that, should complete it.
  await page.locator('.powder-swatch[data-material="10"]').click(); // Neuro
  const canvas = page.getByTestId('powder-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.getByTestId('powder-stimulate').click();

  await expect(spark).toHaveAttribute('data-complete', 'true', { timeout: 20_000 });
  // Nothing was drawn for this one, so it must still be outstanding.
  await expect(dopamine).toHaveAttribute('data-complete', 'false');

  // Progress is progress, not a drawing: it survives Clear and a reload.
  await page.getByTestId('powder-clear').click();
  await expect(spark).toHaveAttribute('data-complete', 'true');
  await page.goto('/lab');
  await expect(
    page.getByTestId('powder-missions').locator('[data-mission="first-spark"]'),
  ).toHaveAttribute('data-complete', 'true');
});

test('the powder lab measures its own firing regime, and says when it will not', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/lab');
  await expect(page.getByTestId('powder-canvas')).toBeVisible();
  const readout = page.getByTestId('powder-regime-label');

  // Game feel: the dimensionless statistics are measured, but a rate in hertz
  // and a calibrated regime label are both withheld, and the page says why.
  await expect(readout).toContainText(/no duration/, { timeout: 30_000 });
  await expect(page.getByTestId('powder-regime')).toContainText('—'); // rate, withheld

  // Real model: the opening scene has enough neurons firing to classify.
  await page.getByTestId('powder-model-real').click();
  await expect(readout).toContainText(
    /Asynchronous|Synchronous|Silent/,
    { timeout: 45_000 },
  );

  // Whatever it landed on, the numbers behind it have to be real numbers.
  const panel = (await page.getByTestId('powder-regime').textContent()) || '';
  expect(panel).toMatch(/CV of ISI/);
  expect(panel).not.toMatch(/NaN|undefined/);
});

test('drawing in the powder lab puts material on the grid', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/lab');
  await expect(page.getByTestId('powder-canvas')).toBeVisible();

  // Clear first so the count reflects only what this test drew.
  await page.getByTestId('powder-clear').click();
  await page.getByTestId('powder-pause').click(); // freeze so nothing falls away

  const canvas = page.getByTestId('powder-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.35, { steps: 8 });
  await page.mouse.up();

  await page.getByTestId('powder-pause').click(); // resume so stats publish
  await expect(async () => {
    const text = (await page.getByTestId('powder-hud').textContent()) || '';
    const particles = Number(/Particles\s*(\d+)/.exec(text)?.[1] ?? 0);
    expect(particles).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });
});

test('a powder lab link carries the whole grid, with no server involved', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/lab');
  await expect(page.getByTestId('powder-canvas')).toBeVisible();

  await page.getByTestId('powder-clear').click();
  await page.getByTestId('powder-pause').click(); // freeze, so the shared grid is exactly what was drawn

  // Wall does not fall, so the grid is stable enough to compare across a reload.
  await page.locator('.powder-swatch[data-material="3"]').click();
  const canvas = page.getByTestId('powder-canvas');
  // On the narrow viewport the palette pushes the canvas below the fold, and
  // page.mouse works in viewport coordinates — without this the drag lands on
  // nothing and the test fails two steps later for the wrong reason.
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();

  await expect(async () => {
    const text = (await page.getByTestId('powder-hud').textContent()) || '';
    expect(Number(/Particles\s*(\d+)/.exec(text)?.[1] ?? 0)).toBeGreaterThan(50);
  }).toPass({ timeout: 10_000 });

  await page.getByTestId('powder-share').click();
  await expect(page).toHaveURL(/[?&]grid=p1%3A240x160%3A/);
  const shared = page.url();

  // A fresh load of that URL restores the drawing rather than the demo scene.
  await page.goto(shared);
  await expect(page.getByTestId('powder-lab')).toContainText('Loaded a shared grid.');
  await page.getByTestId('powder-pause').click();
  await expect(async () => {
    const text = (await page.getByTestId('powder-hud').textContent()) || '';
    expect(Number(/Particles\s*(\d+)/.exec(text)?.[1] ?? 0)).toBeGreaterThan(50);
    // The demo scene is full of synapses; a wall line has none.
    expect(Number(/Synapses\s*(\d+)/.exec(text)?.[1] ?? 999)).toBe(0);
  }).toPass({ timeout: 15_000 });
});

test('a powder lab drawing survives a reload through the local save slot', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/lab');
  await expect(page.getByTestId('powder-canvas')).toBeVisible();

  await page.getByTestId('powder-clear').click();
  await page.getByTestId('powder-pause').click();
  await page.locator('.powder-swatch[data-material="3"]').click();
  await page.getByTestId('powder-canvas').scrollIntoViewIfNeeded();
  const box = (await page.getByTestId('powder-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 10 });
  await page.mouse.up();

  await page.getByTestId('powder-save').click();
  await expect(page.getByTestId('powder-lab')).toContainText('Saved to this browser.');

  await page.goto('/lab');
  await page.getByTestId('powder-load').click();
  await expect(page.getByTestId('powder-lab')).toContainText('Restored your saved grid.');
  await expect(async () => {
    const text = (await page.getByTestId('powder-hud').textContent()) || '';
    expect(Number(/Synapses\s*(\d+)/.exec(text)?.[1] ?? 999)).toBe(0);
  }).toPass({ timeout: 15_000 });
});

test('a visitor who wants to buy can find pricing from the landing page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '.gg-nav-links is display:none below 900px');
  test.setTimeout(60_000);
  await page.goto('/');

  // Pricing used to live two clicks deep inside the /app shell and was linked
  // from nowhere on the marketing site.
  await page.getByTestId('nav-pricing').click();
  await expect(page.getByTestId('pricing-workspace')).toBeVisible();
  await expect(page).toHaveURL(/\/app/);
});

test('the pricing page does not promise limits the code does not enforce', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/app');
  // Desktop keeps Pricing in the sidebar; mobile puts it behind "More".
  if (testInfo.project.name === 'mobile') {
    const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await mobileNav.getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog', { name: 'More navigation' }).getByRole('button', { name: 'Pricing' }).click();
  } else {
    await page.getByRole('button', { name: 'Pricing' }).first().click();
  }
  const pricing = page.getByTestId('pricing-workspace');
  await expect(pricing).toBeVisible();

  const copy = (await pricing.textContent()) || '';
  // Each of these described a capability that does not exist in src/.
  expect(copy).not.toMatch(/analyses\s*\/\s*month/i);
  expect(copy).not.toMatch(/watermark/i);
  expect(copy).not.toMatch(/synced history/i);
  expect(copy).not.toMatch(/waitlist/i);
  // And it says so rather than leaving a greyed-out tier to imply it.
  expect(copy).toMatch(/not open yet/i);
});

test('the lead form never confirms a lead the server did not take', async ({ page }) => {
  test.setTimeout(90_000);

  // Unconfigured is the default: LEADS_WEBHOOK_URL is unset, so /api/leads
  // returns 501. The UI must show the mailto fallback, never a success state.
  await page.route('**/api/leads', (route) => route.fulfill({
    status: 501,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Lead capture is not configured.', status: 'not_configured', fallbackEmail: 'hello@brainsnn.com' }),
  }));

  await page.goto('/');
  const form = page.getByTestId('lead-form');
  await form.scrollIntoViewIfNeeded();
  await page.getByTestId('lead-email').fill('buyer@example.com');
  await form.getByRole('button', { name: /Send the brief/ }).click();

  await expect(page.getByTestId('lead-form-failure')).toBeVisible();
  await expect(page.getByTestId('lead-form-failure')).toContainText(/Nothing was saved/i);
  await expect(page.getByTestId('lead-form-sent')).toHaveCount(0);
});

test('the lead form confirms only when the server accepts the lead', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/api/leads', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'received' }),
  }));

  await page.goto('/');
  const form = page.getByTestId('lead-form');
  await form.scrollIntoViewIfNeeded();
  await page.getByTestId('lead-email').fill('buyer@example.com');
  await form.getByRole('button', { name: /Send the brief/ }).click();

  await expect(page.getByTestId('lead-form-sent')).toBeVisible();
  await expect(page.getByTestId('lead-form-sent')).toContainText('buyer@example.com');
});

test('real interaction reaches the analytics sink, and carries no pasted text', async ({ page }) => {
  test.setTimeout(90_000);

  // track() forwarded to VITE_ANALYTICS_URL, which was unset, so every call site
  // in the app fed a function that sent nothing anywhere. It now defaults to
  // this app's own /api/events. This asserts the wire end to end — a real click
  // in a real browser producing a real request — because the previous failure
  // was invisible from inside the app.
  const posted: any[] = [];
  await page.route('**/api/events', async (route) => {
    try {
      posted.push(JSON.parse(route.request().postData() || '{}'));
    } catch {
      posted.push({ unparseable: true });
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/');
  await expect.poll(() => posted.map((event) => event.event)).toContain('gaugegap_landing_viewed');

  // A lab click is one of the sixteen names the allowlist used to drop on the
  // floor, so this is the specific regression under test.
  const labButton = page.locator('.gg-lab-card button').first();
  await labButton.scrollIntoViewIfNeeded();
  await labButton.click();
  await expect.poll(() => posted.map((event) => event.event)).toContain('gaugegap_lab_clicked');

  // Every event carries a path and a timestamp, and none of them carries the
  // content fields the product exists to analyse.
  for (const event of posted) {
    expect(typeof event.path).toBe('string');
    expect(event.at).toBeTruthy();
    for (const field of ['content', 'rawContent', 'text']) {
      expect(event.properties?.[field]).toBeUndefined();
    }
  }
});

test('the evidence page publishes the engine\'s own worst number, computed live', async ({ page }) => {
  test.setTimeout(90_000);

  // STRANGER_CLIENT_PASS.md carried "publish one real case study" as an open
  // item and none existed. This is it, and the property that makes it worth
  // anything is that every figure is computed in the browser from the same
  // modules the product runs on — so it cannot drift from the code.
  await page.goto('/evidence');
  await expect(page.getByTestId('evidence-page')).toBeVisible();

  // All 17 held-out passages are shown, not a flattering subset.
  const passages = page.getByTestId('evidence-passage');
  await expect(passages).toHaveCount(17);

  // The headline is the generalisation gap, and it must run the unflattering
  // way: worse on text the detector never saw. If these two were ever equal the
  // holdout would have been contaminated.
  const figures = page.getByTestId('evidence-headline').locator('.evidence-figure strong');
  const inSample = Number(await figures.nth(0).innerText());
  const heldOut = Number(await figures.nth(1).innerText());
  expect(Number.isFinite(inSample)).toBe(true);
  expect(heldOut).toBeLessThan(inSample);

  // The verdict sentence quotes the same figures rather than restating them.
  await expect(page.getByTestId('evidence-verdict')).toContainText(String(heldOut));

  // Misses and false alarms are on the page, not just the wins.
  await expect(page.getByTestId('evidence-missed').first()).toBeVisible();
  await expect(page.getByTestId('evidence-falsealarm').first()).toBeVisible();

  // Every detection names the phrase that triggered it, so a reader can check
  // it against the passage instead of trusting a score.
  const firstDetection = page.locator('.evidence-matches').first();
  await expect(firstDetection).toContainText(/triggered by/);

  // This is the page meant to be forwarded to someone else's accessibility
  // team, so it does not get to be the one page that fails.
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations).toEqual([]);
});

test('the evidence page is reachable from the landing page and has its own social card', async ({ page, request }) => {
  test.setTimeout(90_000);

  await page.goto('/');
  const card = page.locator('.gg-lab-card', { hasText: 'never seen' });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button').click();
  await expect(page.getByTestId('evidence-page')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/evidence');

  // Scrapers do not run JavaScript, so the card has to be in the served HTML.
  const html = await (await request.get('/evidence')).text();
  expect(html).toContain('never seen');
  const og = html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] || '';
  // The description quotes the measured figures, so it must carry decimals
  // rather than an adjective.
  expect(og).toMatch(/0\.\d+/);
});
