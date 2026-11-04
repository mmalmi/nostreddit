import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { HashTree, MemoryStore, nhashEncode, fromHex } from '@hashtree/core';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test.beforeEach(async ({context}) => { await allowFixtureAuthors(context); });

test('Hashtree photos load on demand, expand, and reopen from ciphertext in the device cache', async ({page}) => {
  const store = new MemoryStore(), tree = new HashTree({store});
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNY6ywKAAKmAQa4FRofAAAAAElFTkSuQmCC','base64');
  const {cid} = await tree.putFile(new Uint8Array(png));
  const nhash = nhashEncode(cid);
  const event = finalizeEvent({
    kind:1, created_at:Math.floor(Date.now()/1000), tags:[['t','photography'],['subject','An encrypted photo']],
    content:'An encrypted photo\n\nhtree://'+nhash+'/field.png',
  },generateSecretKey());
  const relay = new WebSocket('ws://127.0.0.1:43164');
  try {
    await once(relay,'open');
    const ack = once(relay,'message');
    relay.send(JSON.stringify(['EVENT',event]));
    const [raw] = await ack;
    expect(JSON.parse(String(raw)).slice(0,3)).toEqual(['OK',event.id,true]);
  } finally {relay.close();}

  let offline = false, requests = 0;
  await page.route(/^https:\/\/(?:cdn|upload)\.iris\.to\/.*$/, async route => {
    requests++;
    if (offline) return route.abort();
    const url = new URL(route.request().url());
    expect(url.pathname).toMatch(/^\/[a-f0-9]{64}\.bin$/);
    expect(url.search).toBe('');
    expect(route.request().headers()['referer']).toBeUndefined();
    const data = await store.get(fromHex(url.pathname.slice(1,65)));
    if (!data) return route.fulfill({status:404});
    return route.fulfill({body:Buffer.from(data),'contentType':'application/octet-stream'});
  });

  await page.goto('/post/'+event.id);
  const load = page.getByRole('button',{name:'Load image',exact:true});
  await expect(load).toBeVisible();
  expect(requests).toBe(0);
  await expect(page.getByRole('link',{name:'Open in Iris Drive'})).toHaveAttribute('href','https://drive.iris.to/#/'+nhash+'/field.png');
  await load.click();
  const expand = page.getByRole('button',{name:'Expand field.png',exact:true});
  await expect(expand).toBeVisible();
  await expect.poll(async () => expand.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await expand.click();
  await expect(page.getByRole('dialog',{name:'field.png'})).toBeVisible();
  await page.getByRole('button',{name:'Close image'}).click();
  await expect(page.getByRole('link',{name:'Download file'})).toHaveAttribute('download','field.png');
  expect(requests).toBeGreaterThan(0);
  const initialRequests = requests;
  offline = true;
  await page.reload();
  await load.click();
  await expect(expand).toBeVisible();
  expect(requests).toBe(initialRequests);
});
