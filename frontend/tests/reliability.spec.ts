import { test, expect } from '@playwright/test';

test('keyboard entry, mobile layout and offline recovery preserve account state',async({page,context})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/trade');
  await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
  await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to trading'})).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator('#trading-content')).toBeFocused();
  const balances=page.getByRole('tab',{name:'Balances',exact:true});await balances.focus();await page.keyboard.press('Enter');
  await expect(page.getByTestId('balance-INR')).toHaveText('1,00,000.00');
  await balances.focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'History',exact:true})).toBeFocused();
  await page.keyboard.press('Home');await expect(page.getByRole('tab',{name:/Open orders/})).toBeFocused();
  await context.setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  await expect(page.getByRole('button',{name:'Buy SOL',exact:true})).toBeDisabled();
  await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Live connection',{exact:true})).toBeVisible({timeout:15000});
  await balances.click();await expect(page.getByTestId('balance-INR')).toHaveText('1,00,000.00');
  await page.setViewportSize({width:320,height:740});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'Buy SOL',exact:true})).toBeEnabled();
});
