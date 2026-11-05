import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

async function publish(events: Event[]) {
  const socket = new WebSocket('ws://127.0.0.1:43164');
  try {
    await once(socket,'open');
    for (const event of events) {
      const acknowledgement = once(socket,'message');
      socket.send(JSON.stringify(['EVENT',event]));
      const [frame] = await acknowledgement;
      expect(JSON.parse(frame.toString()).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally { socket.close(); }
}

test('opening a post reads only its activity and keeps newer activity unread after leaving', async ({page}) => {
  const owner = generateSecretKey(), pubkey = getPublicKey(owner), sender = generateSecretKey();
  const now = Math.floor(Date.now()/1000)-10;
  const sign = (key:Uint8Array, kind:number, content:string, tags:string[][]) =>
    finalizeEvent({kind,content,tags,created_at:now}, key);
  const post = sign(owner,1,'Rooftop observations',[['t','photography']]);
  const reaction = sign(sender,7,'+',[['e',post.id],['p',pubkey]]);
  const reply = sign(sender,1,'A gull on the roof',[['e',post.id,'','reply'],['p',pubkey]]);
  const mention = sign(sender,1,'Completely separate sighting',[['p',pubkey]]);
  await publish([post,reaction,reply,mention]);
  await allowFixtureAuthors(page.context());
  await page.addInitScript((key) => localStorage.setItem('nostreddit.account.v1',JSON.stringify({pubkey:key, method:'extension'})),pubkey);
  await page.goto('/notifications');
  const badge = page.locator('[data-route-active="true"] .nav-row[href="/notifications"] .unread-count');
  const activity = page.locator('[data-route-active=\"true\"] article.activity');
  await expect(badge).toHaveText('3');
  await expect(activity.filter({hasText:'Unread'})).toHaveCount(3);

  await activity.filter({hasText:'reacted to your post'}).getByRole('link',{name:'Open discussion'}).click();
  await expect(page.getByRole('heading',{name:post.content})).toBeVisible();
  await expect(badge).toHaveText('1');
  await page.getByRole('link',{name:/Notifications/}).click();
  await expect(activity).toHaveCount(3);
  await expect(activity.filter({hasText:'Unread'})).toHaveCount(1);
  await expect(activity.filter({hasText:mention.content})).toContainText('Unread');
  await page.reload();
  await expect(badge).toHaveText('1');
  await publish([sign(generateSecretKey(),7,'+',[['e',post.id],['p',pubkey]])]);
  await expect(badge).toHaveText('2');

  await page.evaluate(() => {
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await activity.filter({hasText:mention.content}).getByRole('link',{name:'Open discussion'}).click();
  await expect(page.getByRole('heading',{name:mention.content})).toBeVisible();
  await expect(badge).toHaveText('2');
  await page.evaluate(() => {
    Reflect.deleteProperty(document,"visibilityState");
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(badge).toHaveText('1');
});
