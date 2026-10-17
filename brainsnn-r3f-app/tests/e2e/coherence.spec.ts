import { expect, test } from '@playwright/test';

test('video research retains the real fixture without a paid offer or capture form', async ({ page }) => {
  await page.goto('/coherence');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inspect the correction pass.');
  await expect(page.locator('video')).toBeVisible();
  await expect(page.locator('video source').first()).toHaveAttribute('src', '/videos/coherence-demo-scrub.mp4');
  await expect(page.locator('input, form')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('US$99');
});

test('evidence link serves methods and the failed native gate instead of the SPA fallback', async ({ page, request }) => {
  await page.goto('/coherence');
  await page.getByText('Evidence and current limits', { exact: true }).click();
  await page.getByRole('link', { name: 'Read the baselines, hardware and failed gates.' }).click();
  await expect(page).toHaveTitle('Video research evidence | BrainSNN');
  await expect(page.getByRole('heading', { name: 'Video research evidence', exact: true })).toBeVisible();
  await expect(page.getByText('Native-resolution quality gates failed.', { exact: true })).toBeVisible();
  await expect(page.getByText(/rendered math reels, not natural or client footage/)).toHaveCount(1);
  await expect(page.getByText(/Pre-encoding operator measures/)).toHaveCount(1);
  const response = await request.get('/research/video/native-720-house-20261013.json');
  expect(response.ok()).toBe(true);
  const receipt = await response.json();
  expect(receipt.status).toBe('FAIL');
  expect(receipt.checks.motion).toBe(false);
  expect(receipt.motion_ratio).toBeLessThan(.90);
  expect(receipt.trained_weights).toBe(false);
  expect(receipt.independent_stranger_clips_received).toBe(0);
  const delivery = await request.get('/research/video/native-720-house-delivery-verification-20261013.json');
  expect(delivery.ok()).toBe(true);
  const verified = await delivery.json();
  expect(verified.native_decoding_complete).toBe(true);
  expect(verified.frames_per_asset).toBe(121);
  expect(verified.encoded_motion_gate_fails_regardless_of_private_role_mapping).toBe(true);
  expect(verified.encoded_motion_ratio_possible_role_orders_unlabeled[0]).toBeLessThan(.90);
  expect(verified.encoded_motion_ratio_possible_role_orders_unlabeled[1]).toBeGreaterThan(1.10);
});
