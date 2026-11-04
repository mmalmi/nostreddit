import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import WebSocket from 'ws';
import { once } from 'node:events';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test('topic popularity counts authors, persists without feed history and follows visibility settings',async({page,context,browser,baseURL},testInfo)=>{
  await allowFixtureAuthors(context);
  const socket=new WebSocket(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  const a=generateSecretKey(),b=generateSecretKey();
  try {
    await once(socket,'open');
    for(const [key,tag,body] of [[a,'catalog-gardens','One'],[a,'catalog-gardens','Two'],[a,'catalog-gardens','Three'],[a,'catalog-music','Four'],[b,'catalog-music','Five']] as const) {
      const event=finalizeEvent({kind:1,created_at:Math.floor(Date.now()/1000),content:body,tags:[['t',tag],['t','nostr']]},key);
      const ack=once(socket,'message');socket.send(JSON.stringify(['EVENT',event]));await ack;
    }
  }finally{socket.close();}
  await page.goto('/topics');
  const row=(slug:string)=>page.locator('.directory-row').filter({has:page.locator(`a[href="/t/${slug}"]`)});
  await expect(row('catalog-gardens')).toContainText('1 author seen');
  await expect(row('catalog-music')).toContainText('2 authors seen');
  const order=await page.locator('.directory-row strong').allTextContents();
  expect(order.indexOf('catalog-music')).toBeLessThan(order.indexOf('catalog-gardens'));
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('nostreddit.ui.seenTopics.v1'))).not.toBeNull();
  const saved=await page.evaluate(()=>localStorage.getItem('nostreddit.ui.seenTopics.v1')!);
  await page.screenshot({path:testInfo.outputPath('topics-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(row('catalog-music')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('topics-mobile.png')});

  // New context has no cached posts, account, IndexedDB or relay events.
  const fresh=await browser.newContext({baseURL});
  try {
    await allowFixtureAuthors(fresh);
    await fresh.addInitScript(value=>localStorage.setItem('nostreddit.ui.seenTopics.v1',value),saved);
    await fresh.routeWebSocket('**',socket=>socket.close());
    const restored=await fresh.newPage();await restored.goto('/topics');
    await expect(restored.locator('.directory-row').filter({hasText:'catalog-music'})).toContainText('2 authors seen');
    await restored.evaluate(()=>{
      const key='nostreddit.ui.graphVisibility';
      localStorage.setItem(key,JSON.stringify({maxDistance:1,hideOvermuted:true}));
      window.dispatchEvent(new StorageEvent('storage',{key}));
    });
    await expect(restored.locator('.directory-row').filter({hasText:'catalog-music'})).toHaveCount(0);
    await restored.evaluate(()=>{
      const key='nostreddit.ui.graphVisibility';
      localStorage.setItem(key,JSON.stringify({maxDistance:null,hideOvermuted:false}));
      window.dispatchEvent(new StorageEvent('storage',{key}));
    });
    await expect(restored.locator('.directory-row').filter({hasText:'catalog-music'})).toContainText('2 authors seen');
    await restored.getByRole('button',{name:'Create post',exact:true}).click();
    await restored.getByRole('button',{name:'Create profile',exact:true}).click();
    const editor=restored.getByRole('dialog',{name:'Create post',exact:true});
    await expect(editor.locator('datalist option[value="catalog-music"]')).toHaveCount(1);
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  }finally{await fresh.close();}
});
