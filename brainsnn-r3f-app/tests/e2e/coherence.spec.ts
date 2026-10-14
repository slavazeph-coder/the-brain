import { expect, test } from '@playwright/test';

test('clip request produces a reviewable mail draft instead of a false receipt', async ({ page }) => {
  await page.goto('/coherence');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@example.com');
  await page.getByRole('textbox', { name: /Clip link/ }).fill('https://example.com/clip?part=1&quality=1080');
  await page.getByRole('textbox', { name: /Notes/ }).fill('Color jumps at 00:12; keep camera movement.');
  await page.getByRole('button', { name: 'Prepare clip request' }).click();
  await expect(page.getByText('Your email draft is ready. Nothing has been sent from this page.')).toBeVisible();
  await expect(page.getByText(/Received\. We will reply/)).toHaveCount(0);
  const draft = page.getByRole('link', { name: 'Open email draft' });
  await expect(draft).toBeVisible();
  const url = new URL((await draft.getAttribute('href'))!);
  expect(url.protocol).toBe('mailto:');
  expect(url.pathname).toBe('slavazeph@gmail.com');
  expect(url.searchParams.get('body')).toContain('https://example.com/clip?part=1&quality=1080');
  expect(url.searchParams.get('body')).toContain('Color jumps at 00:12; keep camera movement.');
  expect(url.searchParams.get('body')).toContain('only if the result is useful and I accept it');
  // Deliberately do not click mailto: browser QA must not open/send external mail.
});

test('evidence link serves methods and the failed native gate instead of the SPA fallback', async ({ page, request }) => {
  await page.goto('/coherence');
  await page.getByText('Evidence and current limits', { exact: true }).click();
  await page.getByRole('link', { name: 'Read the baselines, hardware and failed gates.' }).click();
  await expect(page).toHaveTitle('Video research evidence | BrainSNN');
  await expect(page.getByRole('heading', { name: 'Video research evidence', exact: true })).toBeVisible();
  await expect(page.getByText('Native-resolution quality gates failed.', { exact: true })).toBeVisible();
  const response = await request.get('/research/video/native-720-house-20261013.json');
  expect(response.ok()).toBe(true);
  const receipt = await response.json();
  expect(receipt.status).toBe('FAIL');
  expect(receipt.checks.motion).toBe(false);
  expect(receipt.motion_ratio).toBeLessThan(.90);
  expect(receipt.trained_weights).toBe(false);
  expect(receipt.independent_stranger_clips_received).toBe(0);
});
