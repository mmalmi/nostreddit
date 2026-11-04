import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { finalizeEvent } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const query = 'naturepaginationfixture';
test.beforeAll(async ({baseURL}) => {
  const ws = new WebSocket('ws://127.0.0.1:'+(Number(new URL(baseURL!).port)+1));
  try {
    await once(ws,'open');
    const key = createHash('sha256').update('search pagination fixture').digest();
    const now = Math.floor(Date.now()/1000);
    for (let i=0; i<65; i++) {
      const title = `${query} ${i}`;
      const event = finalizeEvent({kind:1,content:title,created_at:now-i,
        tags:[['subject',title],['t',i<5 ? 'photography' : 'pagination-archive']]},key);
      const ack = once(ws,'message'); ws.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse((await ack)[0].toString()).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally { ws.close(); }
});

test('five cached matches can load multiple relay pages and reach a clear end', async ({page,context},testInfo) => {
  await allowFixtureAuthors(context);
  await context.addInitScript(()=>localStorage.setItem('nostreddit.ui.relatedSearch','false'));
  await page.goto('/search?q='+query);
  await page.getByLabel('Match related meanings').uncheck();
  await expect(page.locator('[data-route-active=\"true\"] article')).toHaveCount(5);
  await expect(page.getByRole('button',{name:'Search more discussions',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Search more discussions',exact:true}).click();
  await expect(page.locator('.relay-search small')).toContainText('Found 40 matching discussions');
  await expect(page.locator('[data-route-active=\"true\"] article')).toHaveCount(24);
  await page.getByRole('button',{name:'Load more discussions',exact:true}).click();
  await expect(page.locator('[data-route-active=\"true\"] article')).toHaveCount(40);
  await page.getByRole('button',{name:'Load more results',exact:true}).click();
  await expect(page.locator('.relay-search small')).toContainText('Found 65 matching discussions');
  await page.getByRole('button',{name:'Load more discussions',exact:true}).click();
  await expect(page.locator('[data-route-active=\"true\"] article')).toHaveCount(65);
  await expect(page.locator('[data-route-active=\"true\"] article h2').first()).toHaveText(query+' 0');
  await expect(page.locator('[data-route-active=\"true\"] article h2').last()).toHaveText(query+' 64');
  await page.getByRole('button',{name:'Load more results',exact:true}).click();
  await expect(page.getByText('No more results returned by connected relays.')).toBeVisible();
  await expect(page.locator('[data-route-active=\"true\"] article')).toHaveCount(65);
  await page.screenshot({path:testInfo.outputPath('search-pagination-end.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByText('No more results returned by connected relays.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('search-pagination-mobile.png')});
  const input = page.getByLabel('Search Nostreddit');
  await input.fill('different search'); await input.press('Enter');
  await expect(page.getByRole('button',{name:'Search more discussions',exact:true})).toBeVisible();
  await expect(page.getByText('No more results returned by connected relays.')).toHaveCount(0);
});
