import { test, expect } from '@playwright/test';

test('a guest can browse and save posts; a new account can publish, reply, like and follow across sessions', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const seed = page.getByRole('link', {name:'Notes from the coast',exact:true}).first();
  await expect(seed).toBeVisible();
  await seed.click();
  const seedUrl = page.url();
  const root = page.locator('article').first();
  await root.getByRole('button',{name:'Save post', exact:true}).click();
  await page.goto('/saved');
  await expect(page.getByRole('link',{name:'Notes from the coast',exact:true})).toBeVisible();
  await page.goto('/r/photography');
  await expect(page.getByRole('heading',{name:'r/photography',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Create post',exact:true}).first().click();
  await page.getByRole('button',{name:'Create an account'}).click();
  await page.getByLabel('Display name').fill('Rain Reader');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('button',{name:'Continue to Nostreddit'}).click();
  await page.getByLabel('Title', {exact:true}).fill('Where do shorebirds shelter?');
  await page.getByLabel(/Body/).fill('I saw a flock just before the storm.');
  await page.getByRole('button',{name:'Publish post'}).click();
  await expect(page.getByRole('heading',{name:'Where do shorebirds shelter?'})).toBeVisible();
  await expect(page).toHaveURL(/\/post\/[a-f0-9]{64}$/);
  const publishedUrl = page.url();
  await page.getByLabel('Your reply').fill('Under the pier this morning.');
  await page.getByRole('button',{name:'Post reply',exact:true}).click();
  await expect(page.locator('article').filter({hasText:'Under the pier this morning.'}).last()).toBeVisible();
  await root.getByRole('button',{name:'Like',exact:true}).click();
  await expect(root.getByRole('button',{name:'Liked',exact:true})).toHaveAttribute('aria-pressed','true');

  const reader = await browser.newContext();
  try {
    const second = await reader.newPage();
    await second.goto(publishedUrl);
    await expect(second.getByRole('heading',{name:'Where do shorebirds shelter?'})).toBeVisible();
    await expect(second.locator('article').filter({hasText:'Under the pier this morning.'}).last()).toBeVisible();
    await expect(second.locator('article').first().getByRole('button',{name:'Like',exact:true})).toHaveText('1');
  } finally { await reader.close(); }

  await page.goto(seedUrl);
  await page.getByRole('link',{name:'Field Observer',exact:true}).first().click();
  await page.getByRole('button',{name:'Follow',exact:true}).click();
  await expect(page.getByRole('button',{name:'Following',exact:true})).toBeVisible();
  await page.goto('/following');
  await expect(page.getByRole('link',{name:'Notes from the coast',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'Rain Reader',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('a rejected submission retains the draft and makes no claim of publication', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Create post',exact:true}).first().click();
  await page.getByRole('button',{name:'Create an account'}).click();
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('button',{name:'Continue to Nostreddit'}).click();
  await page.getByLabel('Title',{exact:true}).fill('Relay rejection /reject-for-test/');
  await page.getByRole('button',{name:'Publish post'}).click();
  await expect(page.getByRole('alert')).toBeVisible({timeout:15000});
  await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Relay rejection /reject-for-test/');
});

test('extension sign-in, notifications and profile updates work for the active identity', async ({page}) => {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { WebSocket } = await import('ws');
  const owner = generateSecretKey(), pubkey = getPublicKey(owner);
  await page.exposeFunction('testPublicKey', () => pubkey);
  await page.exposeFunction('testSign', (draft: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(draft,owner));
  await page.addInitScript(() => {
    const w = window as unknown as {testPublicKey: Function;testSign: Function;nostr: object};
    w.nostr = {getPublicKey:w.testPublicKey, signEvent:w.testSign};
  });
  const mention = finalizeEvent({ kind:1, content:'A field guide for our next walk.', tags:[['p',pubkey]], created_at:Math.floor(Date.now()/1000) }, generateSecretKey());
  const relay = new WebSocket('ws://127.0.0.1:43164');
  try {
    await new Promise<void>((resolve,reject) => {
      relay.once('error',reject);
      relay.once('open',() => relay.send(JSON.stringify(['EVENT',mention])));
      relay.once('message',bytes => {
        const [type,id,accepted] = JSON.parse(bytes.toString());
        if(type==='OK' && id===mention.id && accepted) resolve(); else reject(new Error('Relay rejected the mention'));
      });
    });
  } finally { relay.close(); }
  await page.goto('/notifications');
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('button',{name:'Sign in with extension'}).click();
  await expect(page.getByText(mention.content,{exact:true})).toBeVisible();
  await page.goto('/u/'+pubkey);
  await page.getByRole('button',{name:'Edit profile'}).click();
  await page.getByRole('textbox',{name:'Display name'}).fill('Field Guide');
  await page.getByRole('button',{name:/Save profile|Save changes/}).click();
  await expect(page.getByRole('heading',{name:'Field Guide',exact:true})).toBeVisible();
});

test('a guest can expand a local search to relays and open a Nostr event identifier', async ({ page }) => {
  const { noteEncode } = await import('nostr-tools/nip19');
  await page.goto('/');
  await expect(page.getByRole('link',{name:'Notes from the coast',exact:true})).toBeVisible();
  const search = page.getByRole('textbox',{name:'Search Nostreddit'});
  await search.fill('ephemeris');
  await search.press('Enter');
  const result = page.getByRole('link',{name:'An ephemeris on the archive shelf',exact:true});
  await expect(page.getByRole('heading',{name:'No matching posts'})).toBeVisible();
  await page.getByRole('button',{name:'Search relays',exact:true}).click();
  await expect(result).toBeVisible({timeout:15_000});
  const href = await result.getAttribute('href');
  const id = href!.split('/').at(-1)!;
  await search.fill('nostr:'+noteEncode(id));
  await search.press('Enter');
  await expect(page).toHaveURL(new RegExp('/post/'+id+'$'));
  await expect(page.getByRole('heading',{name:'An ephemeris on the archive shelf',exact:true})).toBeVisible();
  await search.fill('r/observatory');
  await search.press('Enter');
  await expect(page.getByRole('heading',{name:'r/observatory',exact:true})).toBeVisible();
});
