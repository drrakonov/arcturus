import { test, expect, type WebSocketRoute } from '@playwright/test';
import { join } from 'node:path';

test('two real traders: private orders, execution, balances, cancellation, reconnect and safe retry', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const seller = await a.newPage(), buyer = await b.newPage();
  let buyerSocket: WebSocketRoute;
  await buyer.routeWebSocket(/.*/, socket => {
    socket.connectToServer(); // Forward every message to the actual server unchanged.
    buyerSocket = socket;
  });
  const errors: string[] = [];
  for (const page of [seller, buyer]) page.on('pageerror', error => errors.push(error.message));
  await Promise.all([seller.goto('/'), buyer.goto('/')]);
  await expect(seller.getByText('Live connection', { exact: true })).toBeVisible();
  await expect(buyer.getByText('Live connection', { exact: true })).toBeVisible();
  await seller.getByRole('button', { name: 'Sell', exact: true }).click();
  await seller.getByLabel('Limit price').fill('9');
  await seller.getByLabel('Amount').fill('3');
  await seller.getByRole('button', { name: 'Sell TATA', exact: true }).click();
  await expect(seller.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
  await expect(buyer.locator('.book-row.sell')).toHaveCount(1, { timeout: 5000 });
  await expect(buyer.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await buyer.getByLabel('Limit price').fill('10');
  await buyer.getByRole('button', { name: 'Buy TATA', exact: true }).click();
  await expect(buyer.locator('.trade-row').first()).toContainText('9.00');
  await expect(seller.locator('tbody tr')).toContainText('1.0000');
  await buyer.getByRole('button', { name: 'Balances', exact: true }).click();
  await expect(buyer.getByTestId('balance-INR')).toHaveText('99,991.00');
  await expect(buyer.getByTestId('balance-TATA')).toHaveText('101.0000');
  await seller.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(seller.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await expect(buyer.locator('.book-row.sell')).toHaveCount(0, { timeout: 5000 });
  // Close a real WebSocket, then change the book during the reconnect interval.
  buyerSocket!.close({ code: 1012, reason: 'Test connection interruption' });
  await expect(buyer.getByText('Reconnecting', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(buyer.getByRole('button', { name: 'Buy TATA', exact: true })).toBeDisabled();
  await seller.getByLabel('Limit price').fill('12');
  await seller.getByLabel('Amount').fill('2');
  await seller.getByRole('button', { name: 'Sell TATA', exact: true }).click();
  await expect(seller.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);

  await expect(buyer.getByText('Live connection', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(buyer.locator('.book-row.sell')).toContainText('12.00');
  // Lose only the response AFTER the real API has executed the request.
  let lost = false;
  await buyer.route('**/api/v1/order', async route => {
    if (route.request().method() === 'POST' && !lost) {
      lost = true;
      await route.fetch();
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await buyer.getByLabel('Limit price').fill('8');
  await buyer.getByRole('button', { name: 'Buy TATA', exact: true }).click();
  await expect(buyer.getByRole('button', { name: 'Retry same request', exact: true })).toBeVisible();
  await buyer.getByRole('button', { name: 'Retry same request', exact: true }).click();
  await expect(buyer.getByRole('button', { name: 'Retry same request', exact: true })).toHaveCount(0);
  await buyer.getByRole('button', { name: /^Open orders/ }).click();
  await expect(buyer.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
  const artifacts = process.env.TEST_ARTIFACT_DIR || 'test-results';
  await buyer.screenshot({ path: join(artifacts, 'trading-desktop.png'), fullPage: true });
  await buyer.setViewportSize({ width: 390, height: 844 });
  await buyer.screenshot({ path: join(artifacts, 'trading-mobile.png'), fullPage: true });
  expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await a.close(); await b.close();
});


test('failed bootstrap can retry; an invalid saved session can start fresh', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/session', route => fail ? route.abort('connectionrefused') : route.continue());
  await page.goto('/');
  await expect(page.getByText('Connection failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy TATA', exact: true })).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByText('Live connection', { exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('arcturus-token', 'invalid-token'));
  await page.reload();
  await expect(page.getByText('Session expired', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start new session' }).click();
  await expect(page.getByText('Live connection', { exact: true })).toBeVisible();
});
