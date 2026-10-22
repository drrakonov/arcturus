import { test, expect } from '@playwright/test';
import { join } from 'node:path';
const artifacts = process.env.TEST_ARTIFACT_DIR || 'test-results';

test('galaxy camera follows scroll through three chapters; pause restores a readable static page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('.hero-actions')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: join(artifacts, 'journey-departure.png') });
  await page.evaluate(() => window.scrollTo(0, (document.querySelector('.journey')!.clientHeight - innerHeight) * .52));
  await expect(page.locator('.journey-middle')).toHaveCSS('opacity', '1');
  await expect.poll(async () => Number(await page.locator('.galaxy-renderer').getAttribute('data-travel'))).toBeGreaterThan(.45);
  await page.screenshot({ path: join(artifacts, 'journey-middle.png') });
  await page.evaluate(() => window.scrollTo(0, (document.querySelector('.journey')!.clientHeight - innerHeight) * .98));
  await expect(page.getByRole('link', { name: 'Start trading', exact: true })).toBeVisible();
  await expect(page.locator('.journey-arrival')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: join(artifacts, 'journey-arrival.png') });
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-renderer', 'static');
  await expect(page.locator('.galaxy-webgl')).toHaveCount(0);
  await expect(page.locator('.journey-middle')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
  await page.getByRole('button', { name: 'Resume motion' }).click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-renderer', 'webgl');
  expect(errors).toEqual([]);
});

test('mobile reduced-motion experience is readable without loading the 3D renderer', async ({ page }) => {
  const loads: string[] = [];
  page.on('request', r => loads.push(r.url()));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-renderer', 'static');
  await expect(page.getByRole('heading', { name: 'A market of your own.' })).toBeVisible();
  await expect(page.locator('.journey-arrival')).toHaveCSS('visibility', 'visible');
  expect(loads.some(url => url.includes('three'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'journey-mobile-static.png'), fullPage: true });
});

test('unavailable WebGL retains galaxy artwork and usable navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.includes('webgl')) return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A market of your own.' })).toBeVisible();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-renderer', 'static');
  await expect(page.locator('.galaxy-fallback')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('link', { name: 'Launch terminal' })).toHaveAttribute('href', '/trade');
});

test('mobile animated journey keeps its final action on screen without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-renderer', 'webgl');
  await page.evaluate(() => window.scrollTo(0, (document.querySelector('.journey')!.clientHeight - innerHeight) * .98));
  await expect(page.locator('.journey-arrival')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('link', { name: 'Start trading', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'journey-mobile-arrival.png') });
});
