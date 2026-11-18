import { npubEncode } from 'nostr-tools/nip19';
import { test, expect } from '@playwright/test';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test.beforeEach(async ({context}) => { await allowFixtureAuthors(context); });

test('Backup & sync lists the signed-in profile, copies its local key, and confirms sign-out', async ({page}, testInfo) => {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { nsecEncode } = await import('nostr-tools/nip19');
  const secret = generateSecretKey();
  const nsec = nsecEncode(secret);
  await page.addInitScript((expected) => {
    Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async (value: string) => sessionStorage.setItem('profile-copy-matches', String(value === expected)),
    } });
  }, nsec);
  await page.goto('/');
  await page.getByRole('button', {name:'Sign in', exact:true}).first().click();
  await page.getByRole('button', {name:'Use an existing profile'}).click();
  await page.getByLabel('Secret key', {exact:true}).fill(nsec);
  await page.getByRole('button', {name:'Sign in with secret key'}).click();
  await expect(page.getByRole('dialog', {name:'Nostr profile'})).toBeHidden();

  await page.goto('/settings/account');
  const profiles = page.getByLabel('Profiles on this device');
  await expect(profiles.getByText(npubEncode(getPublicKey(secret)))).toBeVisible();
  await expect(profiles.getByText('Signed in', {exact:true})).toBeVisible();
  await expect(page.getByLabel('Your secret key')).toHaveCount(0);
  await profiles.getByRole('button', {name:'Copy secret key'}).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('profile-copy-matches'))).toBe('true');
  await profiles.screenshot({path:testInfo.outputPath('profile-settings.png')});

  const confirmation = page.getByRole('dialog', {name:'Nostr profile'});
  const signOut = profiles.getByRole('button', {name:'Sign out'});
  await signOut.click();
  await expect(confirmation.getByRole('heading', {name:'Sign out?'})).toBeVisible();
  await expect(confirmation).toContainText('You’ll need your secret key to sign in again.');
  await confirmation.getByRole('button', {name:'Cancel'}).click();
  await expect(signOut).toBeFocused();
  await signOut.click();
  await confirmation.getByRole('button', {name:'Sign out', exact:true}).click();
  await expect(page.getByText('Sign in to back up your profile.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Sign in to back up your profile.')).toBeVisible();
});

test('a guest can browse and save posts; a new profile can publish, reply, like and follow across sessions', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const seed = page.getByRole('link', {name:'Notes from the coast',exact:true}).first();
  await expect(seed).toBeVisible();
  await seed.click();
  const seedUrl = page.url();
  const root = page.locator('[data-route-active=\"true\"] article').first();
  await root.getByRole('button',{name:'Post options',exact:true}).click();
  await root.getByRole('menuitem',{name:'Save post', exact:true}).click();
  await page.goto('/saved');
  await expect(page.getByRole('link',{name:'Notes from the coast',exact:true})).toBeVisible();
  await page.goto('/t/photography');
  await expect(page.getByRole('heading',{name:'t/photography',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Create post',exact:true}).first().click();
  const displayName = page.getByLabel('Display name', {exact:true});
  const suggested = await displayName.inputValue();
  expect(suggested.trim()).not.toBe('');
  await page.getByRole('button',{name:'Suggest another name'}).click();
  await expect(displayName).not.toHaveValue(suggested);
  await displayName.fill('Rain Reader');
  await page.getByRole('button',{name:'Create profile',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Create a post',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reveal secret key'})).toHaveCount(0);
  await page.getByLabel('Post', {exact:true}).fill('Where do shorebirds shelter?\n\nI saw a flock just before the storm.');
  await page.getByRole('button',{name:'Publish post'}).click();
  await expect(page.getByRole('heading',{name:'Where do shorebirds shelter?'})).toBeVisible();
  await expect(page).toHaveURL(/\/post\/note1[023456789acdefghjklmnpqrstuvwxyz]{58}$/);
  const publishedUrl = page.url();
  await page.getByLabel('Your reply').fill('Under the pier this morning.');
  await page.getByRole('button',{name:'Post reply',exact:true}).click();
  await expect(page.locator('[data-route-active=\"true\"] article').filter({hasText:'Under the pier this morning.'}).last()).toBeVisible();
  await root.getByRole('button',{name:'Like',exact:true}).click();
  await expect(root.getByRole('button',{name:'Liked',exact:true})).toHaveAttribute('aria-pressed','true');

  const reader = await browser.newContext();
  try {
    await allowFixtureAuthors(reader);
    const second = await reader.newPage();
    await second.goto(publishedUrl);
    await expect(second.getByRole('heading',{name:'Where do shorebirds shelter?'})).toBeVisible();
    await expect(second.locator('[data-route-active=\"true\"] article').filter({hasText:'Under the pier this morning.'}).last()).toBeVisible();
    await expect(second.locator('[data-route-active=\"true\"] article').first().getByRole('button',{name:'Like',exact:true})).toHaveText('1');
    const upvote=second.locator('[data-route-active=\"true\"] article').first().getByRole('button',{name:'Like',exact:true});
    const upvotes=second.getByRole('dialog',{name:'Reactions',exact:true});
    await upvote.hover(); await second.mouse.down(); await second.waitForTimeout(600); await second.mouse.up();
    await expect(upvotes).toBeVisible();
    await expect(upvotes.getByRole('link',{name:'Rain Reader'})).toBeVisible();
    await expect(upvote).toHaveText('1');
    await expect(upvote).toHaveAttribute('aria-pressed','false');
    await second.keyboard.press('Escape');
    await expect(upvotes).toBeHidden();
    await upvote.click({button:'right'});
    await expect(upvotes).toBeVisible();
    await upvotes.getByRole('link',{name:'Rain Reader'}).click();
    await expect(second).toHaveURL(/\/u\/npub1/);
  } finally { await reader.close(); }

  await page.goto(seedUrl);
  await page.getByRole('link',{name:'Field Observer',exact:true}).first().click();
  await page.getByRole('button',{name:'Follow',exact:true}).click();
  await expect(page.getByRole('button',{name:'Following',exact:true})).toBeVisible();
  await page.goto('/following');
  await expect(page.getByRole('link',{name:'Notes from the coast',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'Rain Reader',exact:true})).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading',{name:'Settings',level:1})).toBeVisible();
  expect(errors).toEqual([]);
});

test('a relay-rejected post stays local and its delivery can be retried from Settings', async ({page}) => {
  const title = 'Relay rejection /reject-for-test/';
  await page.goto('/');
  await page.getByRole('button',{name:'Create post',exact:true}).first().click();
  await page.getByRole('button',{name:'Create profile',exact:true}).click();
  await page.getByLabel('Topic',{exact:true}).fill('nostr');
  await page.getByLabel('Post',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Publish post'}).click();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  const permalink = page.url();
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.getByRole('link',{name:'Backup & sync',exact:true}).click();
  const outbox = page.getByRole('region',{name:'Outbox',exact:true});
  await expect(outbox).toContainText(/block|reject|failed|not accepted|no relay accepted/i,{timeout:15_000});
  await outbox.getByRole('button',{name:'Retry sync',exact:true}).click();
  await expect(outbox).toContainText(/block|reject|failed|not accepted|no relay accepted/i,{timeout:15_000});
  await page.goto(permalink);
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
});

test('extension sign-in, notifications and profile updates work for the active identity', async ({page}, testInfo) => {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { WebSocket } = await import('ws');
  const owner = generateSecretKey(), pubkey = getPublicKey(owner);
  await page.exposeFunction('testPublicKey', () => pubkey);
  const profiles: ReturnType<typeof finalizeEvent>[] = [];
  await page.exposeFunction('testSign', (draft: Parameters<typeof finalizeEvent>[0]) => {
    const signed = finalizeEvent(draft,owner);
    if (signed.kind===0) profiles.push(signed);
    return signed;
  });
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
  await page.getByRole('button',{name:'Use an existing profile'}).click();
  await page.getByRole('button',{name:'Sign in with extension'}).click();
  await expect(page.getByText(mention.content,{exact:true})).toBeVisible();
  await page.goto('/u/'+pubkey);
  await page.getByRole('button',{name:'Edit profile'}).click();
  await page.getByRole('textbox',{name:'Display name'}).fill('Field Guide');
  const precise='[9007199254740995,{"fine":1.000000000000000000009,"tiny":1e-800}]';
  await page.getByText(/^Custom fields \(/).click();
  await page.getByRole('button',{name:'Add field'}).click();
  await page.getByLabel('Field name',{exact:true}).last().fill('custom_counter');
  await page.getByRole('combobox',{name:/Value type/}).last().selectOption('JSON');
  await page.getByLabel('Value',{exact:true}).last().fill(precise);
  await page.getByRole('button',{name:'Review changes'}).click();
  await expect(page.getByText(precise,{exact:true})).toBeVisible();
  await testInfo.attach('profile-review', {body: await page.screenshot(), contentType:'image/png'});
  await page.getByRole('button',{name:'Publish profile'}).click();
  await expect(page.getByRole('heading',{name:'Field Guide',exact:true})).toBeVisible();
  await expect.poll(()=>profiles.some(e=>e.content.includes(precise))).toBe(true);
  await page.goto('/settings/account');
  await expect(page.getByText('Your signing extension manages this profile’s secret key.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Reveal secret key'})).toHaveCount(0);
  await expect(page.getByLabel('Profiles on this device').getByRole('button',{name:'Copy secret key'})).toHaveCount(0);
});

test('a guest can search relay posts and open a Nostr event identifier', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link',{name:'Notes from the coast',exact:true})).toBeVisible();
  const search = page.getByRole('textbox',{name:'Search Nostreddit'});
  await search.fill('ephemeris');
  await search.press('Enter');
  const result = page.getByRole('link',{name:'An ephemeris on the archive shelf',exact:true});
  await expect(result).toBeVisible({timeout:15_000});
  const href = await result.getAttribute('href');
  const note = href!.split('/').at(-1)!;
  expect(note).toMatch(/^note1/);
  await search.fill('nostr:'+note);
  await search.press('Enter');
  await expect(page).toHaveURL(url => url.pathname === href);
  await expect(page.getByRole('heading',{name:'An ephemeris on the archive shelf',exact:true})).toBeVisible();
  await search.fill('t/observatory');
  await search.press('Enter');
  await expect(page.getByRole('heading',{name:'t/observatory',exact:true})).toBeVisible();
});


test('mobile guests can open Settings and persist their feed preferences', async ({page}, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Home feed',level:1})).toBeAttached();
  await expect(page).toHaveTitle('Home · Nostreddit');
  const previews = page.getByRole('button',{name:'Show media previews',exact:true});
  await expect(previews).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('feed-toolbar-mobile.png')});
  await expect(page.getByRole('heading',{name:'About Nostreddit'})).toHaveCount(0);
  await page.getByRole('button',{name:'Toggle navigation'}).click();
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading',{name:'Profile backup'})).toHaveCount(0);
  await page.getByRole('link',{name:'Feeds',exact:true}).click();
  await page.getByLabel('Feed order').selectOption('New');
  await page.getByLabel('Show media previews in feeds').uncheck();
  await page.reload();
  await expect(page.getByLabel('Feed order')).toHaveValue('New');
  await expect(page.getByLabel('Show media previews in feeds')).not.toBeChecked();
  await page.goto('/');
  await expect(page.getByRole('button',{name:'New',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(previews).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('[data-route-active=\"true\"] article').first()).toBeVisible();
  await expect(page.locator('.post-photo')).toHaveCount(0);
  await previews.focus();
  await page.keyboard.press('Space');
  await expect(previews).toHaveAttribute('aria-pressed','true');
  await page.reload();
  await expect(previews).toHaveAttribute('aria-pressed','true');
});

test('pasting an existing secret key into the name prompt opens private sign-in', async ({page}) => {
  const {generateSecretKey,getPublicKey} = await import('nostr-tools/pure');
  const {nsecEncode} = await import('nostr-tools/nip19');
  const key = generateSecretKey();
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Display name').evaluate((el, secret) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text',secret);
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,cancelable:true,bubbles:true}));
  }, nsecEncode(key));
  await expect(page.getByRole('heading',{name:'Sign in to your profile'})).toBeVisible();
  await expect(page.getByLabel('Secret key',{exact:true})).toHaveAttribute('type','password');
  await page.getByRole('button',{name:'Sign in with secret key'}).click();
  await page.locator('header .account-button').click();
  await expect(page.getByRole('link',{name:'View profile',exact:true})).toHaveAttribute('href','/u/'+npubEncode(getPublicKey(key)));
  await expect(page.getByRole('button',{name:/back up|reveal secret key/i})).toHaveCount(0);
  await page.goto('/settings/account');
  await expect(page.getByRole('heading',{name:'Profile backup'})).toBeVisible();
  const field = page.getByLabel('Your secret key',{exact:true});
  await expect(field).toHaveCount(0);
  await page.getByRole('button',{name:'Reveal secret key'}).click();
  await expect(field).toBeVisible();
  expect((await field.inputValue()) === nsecEncode(key)).toBe(true);
  await page.getByRole('button',{name:'Hide secret key'}).click();
  await expect(field).toHaveCount(0);
  await page.getByRole('button',{name:'Reveal secret key'}).click();
  await page.getByRole('link',{name:'Nostreddit home',exact:true}).click();
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await expect(field).toHaveCount(0);
});


test('a refused display name can be changed on the same local profile', async ({page,browser}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Display name',{exact:true}).fill('/reject-for-test/');
  await page.getByRole('button',{name:'Create profile',exact:true}).click();
  await page.getByRole('button',{name:'/reject-for-test/',exact:true}).click();
  await page.getByRole('link',{name:'View profile',exact:true}).click();
  const profileUrl = page.url();
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  // The new-account form initially set both fields. This relay rejects either occurrence.
  await page.getByLabel('Username',{exact:true}).fill('retry-reader');
  await page.getByLabel('Display name',{exact:true}).fill('Retry Reader');
  await page.getByRole('button',{name:'Review changes'}).click();
  await page.getByRole('button',{name:'Publish profile'}).click();
  await expect(page.getByRole('heading',{name:'Retry Reader',exact:true})).toBeVisible();
  const fresh = await browser.newContext();
  try {
    await allowFixtureAuthors(fresh);
    const reader = await fresh.newPage();
    await reader.goto(profileUrl);
    await expect(reader.getByRole('heading',{name:'Retry Reader',exact:true})).toBeVisible({timeout:15_000});
  } finally { await fresh.close(); }
});
