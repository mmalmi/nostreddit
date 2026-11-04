import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test('profile context links the viewer’s mutuals and uses Iris Kit names for unnamed profiles', async ({ page, context }) => {
  await allowFixtureAuthors(context);
  const [viewer, subject, friend, unnamed, unrelated] = Array.from({length:5}, () => generateSecretKey());
  const [v, t, f, u] = [viewer, subject, friend, unnamed].map(getPublicKey);
  const timestamp = Math.floor(Date.now()/1000);
  const list = (key: Uint8Array, ...follows: string[]) => finalizeEvent({
    kind:3, tags:follows.map(id => ['p',id]), content:'', created_at:timestamp,
  },key);
  const metadata = (key: Uint8Array, name:string) => finalizeEvent({
    kind:0, tags:[], content:JSON.stringify({display_name:name}), created_at:timestamp,
  },key);
  const events: Event[] = [metadata(subject,'Harbor Watch'), metadata(friend,'Coast Wren'), metadata(unrelated,'Far Shore'),
    list(viewer, t, f, u), list(subject,v), list(friend,t), list(unnamed,t), list(unrelated,t)];
  const relay = new WebSocket('ws://127.0.0.1:43164');
  try {
    await once(relay,'open');
    for (const event of events) {
      const response = once(relay,'message');
      relay.send(JSON.stringify(['EVENT',event]));
      const [kind, id, accepted] = JSON.parse(String((await response)[0]));
      expect([kind,id,accepted]).toEqual(['OK',event.id,true]);
    }
  } finally { relay.close(); }
  await page.goto('/u/'+t);
  await expect(page.getByRole('heading',{name:'Harbor Watch',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Use an existing profile'}).click();
  await page.getByRole('textbox',{name:'Secret key',exact:true}).fill(nsecEncode(viewer));
  await page.getByRole('button',{name:'Sign in with secret key'}).click();
  const header = page.getByRole('region',{name:'Profile',exact:true});
  await expect(header.getByText('Follows you',{exact:true})).toBeVisible();
  await expect(header.getByRole('link',{name:'Coast Wren',exact:true})).toBeVisible({timeout:20000});
  const unnamedLink = header.locator('a[href="/u/'+u+'"]');
  await expect(unnamedLink).toBeVisible();
  await expect(unnamedLink).toHaveText(/[a-z]{3}/i);
  await expect(unnamedLink).not.toHaveText(/npub1|[0-9a-f]{6,}/i);
  await expect(header.getByText('Far Shore',{exact:true})).toHaveCount(0);
  await expect(header.getByRole('button',{name:'Copy public key'})).toBeVisible();
  await expect(header.getByText(/\bnpub1[a-z0-9]+/)).toHaveCount(0);
  await header.getByRole('link',{name:'Coast Wren'}).click();
  await expect(page).toHaveURL(new RegExp('/u/'+f+'$'));
  await expect(page.getByRole('heading',{name:'Coast Wren',exact:true})).toBeVisible();
});
