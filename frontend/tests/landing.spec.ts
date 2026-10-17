import { test, expect } from '@playwright/test';
import { join } from 'node:path';

test('landing has a galaxy, motion controls and a working path to the real terminal', async ({ page }) => {
  const errors: string[] = [], sessionRequests: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (req.url().includes('/api/v1/session')) sessionRequests.push(req.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A market of your own.' })).toBeVisible();
  await expect(page.locator('.galaxy-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.getByRole('button', { name: 'Resume motion' })).toHaveAttribute('aria-pressed', 'true');
  expect(sessionRequests).toHaveLength(0);
  await expect(page.locator('.hero-actions')).toHaveCSS('opacity', '1');
  const artifacts = process.env.TEST_ARTIFACT_DIR || 'test-results';
  await page.screenshot({ path: join(artifacts, 'landing-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'landing-mobile.png'), fullPage: true });
  await page.getByRole('link', { name: 'Enter the exchange' }).click();
  await expect(page).toHaveURL(/\/trade$/);
  await expect(page.getByText('Live connection', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open second trader' })).toHaveAttribute('href', '/trade');
  await page.getByRole('link', { name: 'Arcturus home' }).click();
  await expect(page.getByRole('heading', { name: 'A market of your own.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('reduced motion keeps landing readable and disables background animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reduced motion' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'A market of your own.' })).toBeVisible();
  await expect(page.locator('.galaxy-canvas')).toHaveCSS('transform', 'none');
});

test('Lenis scrolls landing anchors and cleans up for native scrolling', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/lenis/);
  await page.getByRole('link', { name: 'The experience', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
  await page.getByRole('button', { name: 'Resume motion' }).click();
  await expect(page.locator('html')).toHaveClass(/lenis/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
  await page.getByRole('link', { name: 'Launch terminal' }).click();
  await expect(page.getByText('Live connection', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Solana', exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
});
