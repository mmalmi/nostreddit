import { postUrl } from '../src/lib/post-url';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test('multi-tag posts appear in each topic regardless of community addresses and retain navigation context', async ({page,context},info) => {
  await allowFixtureAuthors(context);
  const author=generateSecretKey(), now=Math.floor(Date.now()/1000);
  const tags=[['t','bitcoin'],['t','mostro']];
  const sign=(title:string, extra:string[][]=[])=>finalizeEvent({kind:1,content:title,tags:[...tags,...extra],created_at:now},author);
  const mixed=sign('Mostro order routing'), scoped=sign('Bitcoin and Mostro announcement',[['a','34550:'+getPublicKey(author)+':bitcoin']]);
  const addressOnly=finalizeEvent({kind:1,content:'Address without a topic tag',created_at:now,tags:[['a','34550:'+getPublicKey(author)+':mostro']]},author);
  const relay=new WebSocket('ws://127.0.0.1:43164');
  try {
    await once(relay,'open');
    for(const post of [mixed,scoped,addressOnly]){
      const ack=once(relay,'message'); relay.send(JSON.stringify(['EVENT',post]));
      expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',post.id,true]);
    }
  } finally {relay.close();}
  await page.goto('/t/bitcoin');
  await expect(page.getByRole('link',{name:scoped.content,exact:true})).toBeVisible();
  await page.goto('/t/mostro');
  const card=page.locator('[data-route-active=\"true\"] article').filter({has:page.getByRole('heading',{name:mixed.content})});
  await expect(card.getByRole('link',{name:'t/mostro',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:scoped.content,exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:addressOnly.content,exact:true})).toHaveCount(0);
  await expect(page.locator('[data-route-active=\"true\"] article .topic-link').filter({hasText:'t/bitcoin'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('topic.png')});
  await card.getByRole('link',{name:mixed.content}).click();
  await expect(page).toHaveURL(url => url.pathname + url.search === postUrl(mixed.id,'mostro'));
  await expect(page.locator('a.back-link').first()).toHaveAttribute('href','/t/mostro');
  await expect(page.locator('[data-route-active=\"true\"] article .topic-link').first()).toHaveText('t/mostro');
});
