import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { noteEncode, neventEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test('a shared hashtagged reply reopens at its canonical note URL and legacy links preserve context', async ({page,context,baseURL}) => {
  await allowFixtureAuthors(context);
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:baseURL!});
  const sk=generateSecretKey(), created_at=Math.floor(Date.now()/1000);
  const original=finalizeEvent({kind:1,created_at,content:'Camera notes from the trail.',tags:[['subject','Camera notes from the trail.'],['t','permalinks']]},sk);
  const text='The rain cleared on the ridge. #permalinks';
  const reply=finalizeEvent({kind:1,created_at,content:text,tags:[['e',original.id,'','root',original.pubkey],['p',original.pubkey],['t','permalinks']]},sk);
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
  const card=page.locator('article').filter({hasText:text});
  await expect(card).toBeVisible();
  await expect(card.getByRole('link',{name:'Reply to discussion'})).toHaveAttribute('href',postPath);
  await expect(card.getByRole('time').locator('..')).toHaveAttribute('href',path+'?t=permalinks');
  await card.getByRole('button',{name:'Copy post link'}).click();
  const expected=new URL(path+'?t=permalinks',baseURL).href;
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(expected);
  const reopened=await context.newPage();
  try {
    await reopened.goto(await page.evaluate(()=>navigator.clipboard.readText()));
    await expect(reopened.locator('article').first()).toContainText(text);
    await expect(reopened.locator('.back-link').first()).toHaveAttribute('href','/t/permalinks');
    await expect(reopened.getByRole('link',{name:'View original discussion'})).toHaveAttribute('href',postPath);
    const suffix='?r=permalinks&view=compact#context';
    for(const old of [reply.id.toUpperCase(),neventEncode({id:reply.id,relays:['wss://example.org']})]) {
      await reopened.goto('/post/'+old+suffix);
      await expect(reopened).toHaveURL(new URL(path+suffix,baseURL).href);
      await expect(reopened.locator('.back-link').first()).toHaveAttribute('href','/t/permalinks');
      await expect(reopened.locator('article').first()).toContainText(text);
    }
    await reopened.goto('/post/'+noteEncode(original.id)+'/unexpected');
    await expect(reopened.getByRole('heading',{name:'Page not found'})).toBeVisible();
  } finally {await reopened.close();}
});
