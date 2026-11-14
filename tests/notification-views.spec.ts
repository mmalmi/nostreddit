import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { postUrl } from '../src/lib/post-url';
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
  await page.goto('/settings');
  const badge = page.locator('[data-route-active="true"] .nav-row[href="/notifications"] .unread-count');
  await expect(badge).toHaveText('3');
  await page.goto(postUrl(post.id));
  await expect(page.getByRole('heading',{name:post.content})).toBeVisible();
  await expect(badge).toHaveText('1');
  await page.goto('/settings');
  await publish([sign(generateSecretKey(),7,'+',[['e',post.id],['p',pubkey]])]);
  await expect(badge).toHaveText('2');
  await page.reload();
  await expect(badge).toHaveText('2');

  await page.evaluate(() => {
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
    document.querySelector<HTMLAnchorElement>('[data-route-active="true"] .nav-row[href="/notifications"]')!.click();
  });
  const activity = page.locator('[data-route-active="true"] article.activity');
  await expect(activity).toHaveCount(3);
  await expect(activity.filter({hasText:'Unread'})).toHaveCount(2);
  await page.waitForTimeout(800);
  await expect(badge).toHaveText('2');
  await page.evaluate(() => {
    Reflect.deleteProperty(document,"visibilityState");
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(badge).toHaveCount(0);
  await expect(activity.filter({hasText:'Unread'})).toHaveCount(0);
  await page.reload();
  await expect(activity).toHaveCount(3);
  await expect(badge).toHaveCount(0);
});

test('ten reactions count as one unseen row and scrolling reads only the visible groups', async ({page,context}, info) => {
  const owner = generateSecretKey(), pubkey = getPublicKey(owner), sender = generateSecretKey();
  const noon = Math.floor(Date.now()/86400000)*86400 - 43200;
  const sign = (key:Uint8Array, kind:number, content:string, tags:string[][], time=noon) =>
    finalizeEvent({kind,content,tags,created_at:time},key);
  const titles = ['Morning walk','Shorebirds','Tide pools','Blue hour','Along the seawall','Gull tracks','Rock formations','The cove','Evening light','Back at the pier'];
  const posts = titles.map(title => sign(owner,1,title,[['t','photography']]));
  const reactions = posts.map((post,i) => sign(sender,7,i%2 ? '🌊' : '+',[['e',post.id],['p',pubkey]],noon+i));
  const mentions = Array.from({length:12},(_,i) => sign(sender,1,'Coastal field note ' + (i+1),[['p',pubkey]],noon-1-i));
  const avatarUrl = 'https://photos.example/seabird.svg';
  const profile = (key:Uint8Array, name:string, picture='') => sign(key,0,JSON.stringify({name,picture}),[]);
  await publish([...posts,...reactions,...mentions,profile(owner,'Sandpiper',avatarUrl),profile(sender,'Harbor Heron')]);
  await allowFixtureAuthors(context);
  await context.addInitScript(key => {
    localStorage.setItem('nostreddit.account.v1',JSON.stringify({pubkey:key,method:'extension'}));
    localStorage.setItem('nostreddit.ui.imageProxy',JSON.stringify({enabled:false}));
  }, pubkey);
  await context.route(avatarUrl,route => route.fulfill({contentType:'image/svg+xml',
    body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#458597"/><circle cx="20" cy="15" r="7" fill="#ffdfb5"/><path d="M5 40a15 15 0 0 1 30 0" fill="#28515e"/></svg>'}));
  await page.goto('/settings');
  const badge = (tab:typeof page) => tab.locator('[data-route-active="true"] .nav-row[href="/notifications"] .unread-count');
  await expect(badge(page)).toHaveText('13');
  const observerTab = await context.newPage();
  await observerTab.goto('/settings');
  await expect(badge(observerTab)).toHaveText('13');
  await page.bringToFront();
  await page.setViewportSize({width:1210,height:650});
  await page.goto('/notifications');
  const burst = page.locator('article.activity').filter({hasText:'reacted to 10 posts'});
  await expect(burst.getByText('Harbor Heron')).toBeVisible();
  await expect(burst.getByRole('link', {name:'Harbor Heron'}).locator('.iris-minidenticon')).toBeVisible();
  const headerButton = page.locator('.topbar').getByRole('button',{name:'Sandpiper',exact:true});
  await expect(headerButton.locator('img')).toBeVisible();
  await expect.poll(() => headerButton.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(headerButton.getByText('Sandpiper')).toBeVisible();
  await expect.poll(() => badge(observerTab).innerText().then(Number)).toBeLessThan(13);
  await expect(page.getByText('Coastal field note 12').locator('..')).toContainText('Unread');
  await burst.locator('summary').focus();
  await page.keyboard.press('Enter');
  const links = burst.locator('li a');
  await expect(links).toHaveCount(10);
  await expect(links.first()).toHaveText(titles[9]);
  await expect(links.last()).toHaveAttribute('href',postUrl(posts[0].id));
  await page.screenshot({path:info.outputPath('grouped-notifications-desktop.png')});
  await page.setViewportSize({width:390,height:760});
  await expect(headerButton.getByText('Sandpiper')).toBeHidden();
  await expect(page.locator('.menu-unread')).toHaveText(await badge(observerTab).innerText());
  await expect(headerButton.locator('img')).toBeVisible();
  await page.screenshot({path:info.outputPath('grouped-notifications-mobile.png')});
  await headerButton.click();
  await expect(page.getByRole('dialog',{name:'Nostr profile'})).toBeVisible();
  await page.keyboard.press('Escape');
  await publish([sign(owner,0,JSON.stringify({name:'Sandpiper'}),[],noon+20)]);
  await expect(headerButton.locator('.iris-minidenticon')).toBeVisible();
  await links.last().click();
  await expect(page.getByRole('heading',{name:titles[0],exact:true})).toBeVisible();
  const before = Number(await badge(observerTab).innerText());
  await publish([sign(sender,7,'👍',[['e',posts[0].id],['p',pubkey]],noon+12)]);
  // An arrival on the open post is immediately seen. An arrival in the same
  // group for another post makes just that one group unseen again.
  await publish([sign(sender,7,'👍',[['e',posts[1].id],['p',pubkey]],noon+13)]);
  await expect(badge(observerTab)).toHaveText(String(before+1));
  await page.goBack();
  await expect(burst).toBeVisible();
  await expect.poll(() => badge(observerTab).innerText().then(Number)).toBeLessThan(before+1);
  await page.getByText('Coastal field note 12',{exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByText('Coastal field note 12').locator('..')).not.toContainText('Unread');
  await observerTab.reload();
  await expect(badge(observerTab)).toHaveText(await badge(page).textContent() || '',{timeout:10000});
});

test('a cold inbox restores activity, avatars and exact read state with the relays disconnected', async ({page, context, browser, baseURL}, info) => {
  const owner = getPublicKey(generateSecretKey()), sender = generateSecretKey();
  const time = Math.floor(Date.now() / 1000) - 10;
  const mention = (content: string) => finalizeEvent({kind:1, created_at:time, tags:[['p',owner]], content}, sender);
  const first = mention('Saw a goldfinch today'), second = mention('Saw a kingfisher today');
  const legacy = mention('A heron from a previous visit');
  const picture = 'https://avatar.example/finch.jpg';
  const profile = finalizeEvent({kind:0, created_at:time, tags:[], content:JSON.stringify({name:'Birdwatcher', picture})}, sender);
  await allowFixtureAuthors(context);
  await page.addInitScript(({owner, seen}) => {
    localStorage.setItem('nostreddit.account.v1', JSON.stringify({pubkey:owner, method:'extension'}));
    const key = 'nostreddit.ui.readNotifications.' + owner;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([seen]));
  }, {owner, seen:legacy.id});
  await page.route('https://imgproxy.iris.to/**', route => route.fulfill({contentType:'image/svg+xml',
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="9" fill="green"/></svg>'}));
  await publish([first, profile]);
  await page.goto('/notifications');
  const author = page.getByRole('link', {name:'Birdwatcher', exact:true});
  await expect(author.locator('img.loaded')).toHaveAttribute('src', /^https:\/\/imgproxy\.iris\.to\//);
  await expect(page.locator('article.activity .unread')).toHaveCount(0);
  await page.goto('/saved');
  await publish([second, legacy]);
  const badge = '.nav-row[href="/notifications"] .unread-count';
  await expect(page.locator(badge)).toHaveText('1');

  // Start a fresh browser with this account's durable inbox. Simulate an
  // evicted general feed snapshot and a read ID outside the recent-ID window.
  const state = await context.storageState({indexedDB:true});
  for (const origin of state.origins) {
    if ('indexedDB' in origin && Array.isArray(origin.indexedDB))
      origin.indexedDB = origin.indexedDB.filter(db => db.name.startsWith('nostreddit-inbox:'));
    origin.localStorage = origin.localStorage.filter(item => !item.name.includes('readNotifications.'));
    origin.localStorage.push({name:'nostreddit.relays.v1', value:''});
  }
  const cold = await browser.newContext({baseURL, storageState:state, viewport:{width:390,height:780}});
  try {
    const reopened = await cold.newPage();
    await reopened.route('https://imgproxy.iris.to/**', route => route.abort());
    await reopened.goto('/saved');
    await expect(reopened.locator(badge)).toHaveText('1');
    // Inspect the restored flags before viewing a row can mark it seen.
    await reopened.evaluate(() => Object.defineProperty(document, 'visibilityState', {configurable:true, value:'hidden'}));
    await reopened.evaluate(() => document.querySelector<HTMLAnchorElement>('.nav-row[href="/notifications"]')!.click());
    const rows = reopened.locator('article.activity');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({hasText:first.content})).not.toContainText('Unread');
    await expect(rows.filter({hasText:legacy.content})).not.toContainText('Unread');
    await expect(rows.filter({hasText:second.content})).toContainText('Unread');
    await expect(rows.first().getByRole('link', {name:'Birdwatcher'}).locator('.iris-minidenticon')).toBeVisible();
    await reopened.screenshot({path:info.outputPath('restored-inbox-mobile.png')});
    await reopened.evaluate(key => localStorage.setItem('nostreddit.account.v1', JSON.stringify({pubkey:key, method:'extension'})), getPublicKey(generateSecretKey()));
    await reopened.reload();
    await expect(reopened.getByRole('heading', {name:'No notifications seen yet'})).toBeVisible();
    await expect(reopened.locator(badge)).toHaveCount(0);
  } finally { await cold.close(); }
});

test('bulk tags stay out of the badge while direct replies and followed authors get through', async ({page}) => {
  const owner = generateSecretKey(), pubkey = getPublicKey(owner), sender = generateSecretKey();
  const at = Math.floor(Date.now()/1000) - 30;
  const sign = (key:Uint8Array, kind:number, content:string, tags:string[][], time=at) =>
    finalizeEvent({kind, content, tags, created_at:time},key);
  const parent = sign(owner,1,'Reader’s field note',[]);
  const other = sign(sender,1,'A different thread',[]);
  const ten = [['p',pubkey], ...Array.from({length:9},()=>['p',getPublicKey(generateSecretKey())])];
  const eleven = [...ten, ['p',getPublicKey(generateSecretKey())]];
  const ordinary = sign(sender,1,'Ten people invited',ten);
  const broad = sign(sender,1,'Open invitation to eleven',eleven);
  const direct = sign(sender,1,'Direct reply with many tags',[...eleven,['e',parent.id,'','reply']]);
  const nested = sign(sender,1,'A reply addressed to another participant',[...eleven,['e',parent.id,'','root',pubkey],['e',other.id,'','reply',other.pubkey]]);
  const reaction = sign(sender,7,'+',[...eleven,['e',parent.id]]);
  await allowFixtureAuthors(page.context());
  await page.addInitScript(key => localStorage.setItem('nostreddit.account.v1',JSON.stringify({pubkey:key,method:'extension'})),pubkey);
  await publish([ordinary,broad,direct,nested,reaction]);
  await page.goto('/saved');
  const badge=page.locator('[data-route-active="true"] .nav-row[href="/notifications"] .unread-count');
  await expect(badge).toHaveText('2');
  // Its reply arrived before the signed parent. Recognition uses normal relay
  // traffic and does not require the reader to re-open the inbox.
  await publish([parent]);
  await expect(badge).toHaveText('3');
  await page.getByRole('link',{name:/Notifications/}).click();
  const rows=page.locator('[data-route-active="true"] article.activity');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({hasText:direct.content})).toBeVisible();
  await expect(rows.filter({hasText:broad.content})).toHaveCount(0);
  await expect(rows.filter({hasText:nested.content})).toHaveCount(0);
  await publish([sign(owner,3,'',[['p',getPublicKey(sender)]],at+1)]);
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({hasText:broad.content})).toBeVisible();
  await publish([sign(owner,3,'',[],at+2)]);
  await expect(rows).toHaveCount(3);
});
