import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { noteEncode, neventEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test('a shared hashtagged reply reopens at its canonical note URL and legacy links preserve context', async ({page,context,baseURL},testInfo) => {
  await allowFixtureAuthors(context);
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:baseURL!});
  const sk=generateSecretKey(), created_at=Math.floor(Date.now()/1000);
  const original=finalizeEvent({kind:1,created_at,content:'Camera notes from the trail.',tags:[['subject','Camera notes from the trail.'],['t','permalinks']]},sk);
  const text='The rain cleared on the ridge. #permalinks';
  const body='Clouds rolled away from the valley.';
  const reply=finalizeEvent({kind:1,created_at,content:text+'\n\n'+body,tags:[['e',original.id,'','root',original.pubkey],['p',original.pubkey],['t','permalinks']]},sk);
  const relay=new WebSocket('ws://127.0.0.1:'+(Number(new URL(baseURL!).port)+1));
  try {
    await once(relay,'open');
    for(const event of [original,reply]) {
      const ack=once(relay,'message'); relay.send(JSON.stringify(['EVENT',event]));
      const [body]=await ack; expect(JSON.parse(String(body)).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally {relay.close();}
  const path='/post/'+noteEncode(reply.id);
  const postPath='/post/'+noteEncode(original.id);
  await page.goto('/t/permalinks');
  const card=page.locator('[data-route-active=\"true\"] article').filter({hasText:text});
  await expect(card).toBeVisible();
  await expect(card.getByRole('link',{name:'Reply to discussion'})).toHaveAttribute('href',postPath);
  await expect(card.getByRole('time').locator('..')).toHaveAttribute('href',path+'?t=permalinks');
  const expected=new URL(path+'?t=permalinks',baseURL).href;
  const share=card.getByRole('button',{name:'Share',exact:true});
  await card.screenshot({path:testInfo.outputPath('feed-post.png')});
  await page.evaluate(() => Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));
  await share.click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(expected);
  await page.evaluate(() => Object.defineProperty(navigator,'share',{configurable:true,value:async ({url}:ShareData) => {
    document.documentElement.dataset.sharedUrl = url;
    throw new DOMException('Cancelled','AbortError');
  }}));
  await page.evaluate(()=>navigator.clipboard.writeText('untouched'));
  await share.click();
  const shareMenu=page.getByRole('menu',{name:'Share post'});
  await expect(shareMenu.getByRole('menuitem',{name:'Copy link'})).toBeFocused();
  await expect(page.locator('html')).not.toHaveAttribute('data-shared-url',expected);
  await page.screenshot({path:testInfo.outputPath('share-menu.png')});
  await page.keyboard.press('Escape');
  await expect(share).toBeFocused();
  await share.click();
  await shareMenu.getByRole('menuitem',{name:'Share via…'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-shared-url',expected);
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('untouched');
  await expect(page).toHaveURL(new URL('/t/permalinks',baseURL).href);
  await card.getByRole('button',{name:'Post options',exact:true}).click();
  await card.getByRole('menuitem',{name:'Copy post link'}).click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(expected);
  const bounds=await card.locator('.note-text').filter({hasText:body}).boundingBox();
  await page.mouse.move(bounds!.x+2,bounds!.y+9);
  await page.mouse.down();
  await page.mouse.move(bounds!.x+80,bounds!.y+9,{steps:8});
  await page.mouse.up();
  expect(await page.evaluate(()=>window.getSelection()?.toString())).toBeTruthy();
  await expect(page).toHaveURL(new URL('/t/permalinks',baseURL).href);
  await card.click({position:{x:8,y:8}});
  await expect(page).toHaveURL(expected);
  await page.getByRole('button',{name:'Share',exact:true}).click();
  await page.goBack();
  await expect(card).toBeVisible();
  const reopened=await context.newPage();
  try {
    await reopened.goto(await page.evaluate(()=>navigator.clipboard.readText()));
    await expect(reopened.locator('[data-route-active=\"true\"] article').first()).toContainText(text);
    await expect(reopened.locator('.back-link').first()).toHaveAttribute('href','/t/permalinks');
    await expect(reopened.getByRole('link',{name:'View original discussion'})).toHaveAttribute('href',postPath);
    const suffix='?r=permalinks&view=compact#context';
    for(const old of [reply.id.toUpperCase(),neventEncode({id:reply.id,relays:['wss://example.org']})]) {
      await reopened.goto('/post/'+old+suffix);
      await expect(reopened).toHaveURL(new URL(path+suffix,baseURL).href);
      await expect(reopened.locator('.back-link').first()).toHaveAttribute('href','/t/permalinks');
      await expect(reopened.locator('[data-route-active=\"true\"] article').first()).toContainText(text);
    }
    await reopened.goto('/post/'+noteEncode(original.id)+'/unexpected');
    await expect(reopened.getByRole('heading',{name:'Page not found'})).toBeVisible();
  } finally {await reopened.close();}
});
