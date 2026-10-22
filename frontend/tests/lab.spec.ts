import { test, expect } from '@playwright/test';
import { join } from 'node:path';

test('protected orders, execution inspector and real service observations work on desktop and mobile',async({browser})=>{
  const a=await browser.newContext(),b=await browser.newContext();
  const seller=await a.newPage(),buyer=await b.newPage();
  await Promise.all([seller.goto('/trade'),buyer.goto('/trade')]);
  await expect(seller.getByText('Live connection',{exact:true})).toBeVisible();
  await expect(buyer.getByText('Live connection',{exact:true})).toBeVisible();
  await seller.getByRole('button',{name:'Sell',exact:true}).click();
  await seller.getByLabel('Limit price').fill('9');await seller.getByLabel('Amount').fill('1');
  await seller.getByRole('button',{name:'Sell SOL',exact:true}).click();
  await expect(seller.getByRole('button',{name:'Cancel',exact:true})).toHaveCount(1);
  await buyer.getByLabel('Order type',{exact:true}).selectOption('market');
  await buyer.getByLabel('Maximum buy price').fill('10');await buyer.getByLabel('Amount').fill('3');
  await buyer.getByRole('button',{name:'Buy SOL',exact:true}).click();
  await expect(buyer.locator('.action-feedback')).toContainText('2 cancelled');
  await expect(buyer.getByRole('button',{name:'Cancel',exact:true})).toHaveCount(0);
  const lab=buyer.getByRole('region',{name:'Engineering lab'});
  await expect(lab.locator('.service-flow .observed')).toHaveCount(6);
  await buyer.getByRole('tab',{name:'History',exact:true}).click();
  await expect(buyer.getByRole('table',{name:'Order history'}).getByRole('button',{name:'Inspect',exact:true})).toBeVisible();
  await buyer.getByRole('table',{name:'Order history'}).getByRole('button',{name:'Inspect',exact:true}).click();
  const inspector=buyer.getByRole('region',{name:'Execution inspector'});
  await expect(inspector).toContainText('cancelled');await expect(inspector.getByRole('table',{name:'Execution fills'})).toContainText('taker');
  await buyer.getByText('Controlled demonstrations',{exact:true}).click();
  await buyer.getByLabel('Operator key').fill(process.env.TEST_DEMO_CONTROL_TOKEN!);
  await buyer.getByLabel('Scenario',{exact:true}).selectOption('fifo');
  await buyer.getByRole('button',{name:'Run scenario',exact:true}).click();
  await expect(buyer.locator('.scenario-result')).toContainText('2 real fills');
  await buyer.getByRole('button',{name:'Inspect scenario execution'}).click();
  // A scenario may be returned before its asynchronous writes land.
  if(await buyer.getByRole('button',{name:'Retry inspector'}).isVisible())await buyer.getByRole('button',{name:'Retry inspector'}).click();
  await expect(inspector).toContainText('DEMO_INR');
  await expect(inspector.getByRole('table',{name:'Execution fills'}).locator('tbody tr')).toHaveCount(2);
  const artifacts=process.env.TEST_ARTIFACT_DIR || 'test-results';
  await lab.scrollIntoViewIfNeeded();await buyer.screenshot({path:join(artifacts,'lab-desktop.png'),fullPage:true});
  await buyer.setViewportSize({width:390,height:844});
  await expect.poll(()=>buyer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await buyer.screenshot({path:join(artifacts,'lab-mobile.png'),fullPage:true});
  // A reload restores service events via REST, without inventing historical browser receipts.
  await buyer.reload();await expect(buyer.getByText('Live connection',{exact:true})).toBeVisible();
  await expect(buyer.locator('.trace-events')).toContainText('Database committed');
  await expect(buyer.locator('.service-flow .observed')).toHaveCount(4);
  await a.close();await b.close();
});
