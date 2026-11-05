import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import WebSocket from 'ws';
import { once } from 'node:events';
import { allowFixtureAuthors } from './helpers/graphPreferences';
import type { CatalogSnapshot } from '../src/lib/topic-catalog';

const savedAuthors=(page:Page,slug:string)=>page.evaluate(slug=>{
  const saved=JSON.parse(localStorage.getItem('nostreddit.ui.seenTopics.v1') || 'null') as CatalogSnapshot | null;
  return saved?.tags.find(([tag])=>tag===slug)?.[1].map(([id])=>saved.authors[id]).sort() ?? [];
},slug);

test('closing and reopening restores seen tags and authors without relay or feed history',async({page,context,baseURL},testInfo)=>{
  await allowFixtureAuthors(context);
  const socket=new WebSocket(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  const a=generateSecretKey(),b=generateSecretKey(),now=Math.floor(Date.now()/1000);
  const root=finalizeEvent({kind:1,created_at:now,content:'Remember this topic',tags:[['t','catalog-reopen'],['t','nostr']]},a);
  const reply=finalizeEvent({kind:1,created_at:now,content:'Remember this reply too',
    tags:[['t','catalog-reopen'],['t','catalog-reply'],['t','nostr'],['e',root.id,'','root']]},b);
  try {
    await once(socket,'open');
    for(const event of [root,reply]) {
      const ack=once(socket,'message');socket.send(JSON.stringify(['EVENT',event]));await ack;
    }
  }finally{socket.close();}
  await page.goto('/topics');
  const row=(tab:typeof page,slug:string)=>tab.locator('.directory-row').filter({has:tab.locator(`a[href="/t/${slug}"]`)});
  await expect(row(page,'catalog-reopen')).toBeVisible();
  await expect(row(page,'catalog-reply')).toBeVisible();
  // Closing flushes the batched write. Keep browser storage, but remove the
  // feed snapshot with no app running and refuse any subsequent relay data.
  await page.close();
  await context.addCookies([{name:'nostreddit_offline_fixture',value:'1',url:baseURL!}]);
  const reopened=await context.newPage();
  await reopened.goto('/manifest.webmanifest');
  await reopened.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.deleteDatabase('nostreddit-feed-v1');
    request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Feed cache is still open'));
  }));
  expect(await savedAuthors(reopened,'catalog-reopen')).toEqual([getPublicKey(a),getPublicKey(b)].sort());
  expect(await savedAuthors(reopened,'catalog-reply')).toEqual([getPublicKey(b)]);
  await reopened.goto('/topics');
  await expect(row(reopened,'catalog-reopen')).toBeVisible();
  await expect(row(reopened,'catalog-reply')).toBeVisible();
  await reopened.reload();
  await expect(row(reopened,'catalog-reopen')).toBeVisible();
  expect(await savedAuthors(reopened,'catalog-reopen')).toEqual([getPublicKey(a),getPublicKey(b)].sort());
  await reopened.screenshot({path:testInfo.outputPath('restored-topics.png')});
});

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
  await expect(row('catalog-gardens')).toBeVisible();
  await expect(row('catalog-music')).toBeVisible();
  await expect.poll(()=>savedAuthors(page,'catalog-gardens')).toEqual([getPublicKey(a)]);
  await expect.poll(()=>savedAuthors(page,'catalog-music')).toEqual([getPublicKey(a),getPublicKey(b)].sort());
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
    await expect(restored.locator('.directory-row').filter({hasText:'catalog-music'})).toBeVisible();
    expect(await savedAuthors(restored,'catalog-music')).toEqual([getPublicKey(a),getPublicKey(b)].sort());
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
    await expect(restored.locator('.directory-row').filter({hasText:'catalog-music'})).toBeVisible();
    await restored.getByRole('button',{name:'Create post',exact:true}).click();
    await restored.getByRole('button',{name:'Create profile',exact:true}).click();
    const editor=restored.getByRole('dialog',{name:'Create post',exact:true});
    await expect(editor.locator('datalist option[value="catalog-music"]')).toHaveCount(1);
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  }finally{await fresh.close();}
});
