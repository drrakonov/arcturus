import { test, expect } from '@playwright/test';

test('terminal smooth scrolling and pointer/keyboard feedback work with reduced-motion fallback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/trade');
  await expect(page.locator('html')).toHaveClass(/lenis/);
  const sell = page.getByRole('button', { name: 'Sell', exact: true });
  await sell.click();
  await expect(sell).toHaveAttribute('aria-pressed', 'true');
  await expect(sell).toHaveAttribute('data-clicked', 'true');
  await expect(sell).not.toHaveAttribute('data-clicked', 'true');
  const buy = page.getByRole('button', { name: 'Buy', exact: true });
  await buy.focus(); await page.keyboard.press('Enter');
  await expect(buy).toHaveAttribute('data-clicked', 'true');
  await expect(buy).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.chart-canvas')).toHaveAttribute('data-native-scroll', 'true');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(15, 150); await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
  await expect(buy).toHaveAttribute('aria-pressed', 'true');
});
