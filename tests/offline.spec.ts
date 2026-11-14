import { once } from 'node:events';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure';
import { nsecEncode, npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { WebSocket } from 'ws';
import { postIdFromPath } from '../src/lib/post-url';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const relayUrl = 'ws://127.0.0.1:43164';
const profilePath = (key: string) => '/u/' + npubEncode(key);
const freshKey = () => getPublicKey(generateSecretKey());
const now = () => Math.floor(Date.now()/1000);
function sign(key: Uint8Array, kind: number, content: string, tags: string[][], created_at: number) {
  return finalizeEvent({kind, content, tags, created_at},key);
}

async function supply(events: Event[]) {
  const socket = new WebSocket(relayUrl);
  try {
    await once(socket,'open');
    for (const event of events) {
      const ack = once(socket,'message');
      socket.send(JSON.stringify(['EVENT',event]));
      const [raw] = await ack;
      expect(JSON.parse(raw.toString()).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally { socket.close(); }
}

// Read the durable public result through an independent client without the writer's cache.
async function authoredBy(pubkey: string): Promise<Event[]> {
  const socket = new WebSocket(relayUrl);
  try {
    await once(socket,'open');
    return await new Promise<Event[]>((resolve,reject) => {
      const events: Event[] = [];
      socket.once('error',reject);
      socket.on('message',raw => {
        const [type,id,event] = JSON.parse(raw.toString());
        if (id !== 'read') return;
        if (type === 'EOSE') return resolve(events);
        if (type !== 'EVENT') return;
        if (!verifyEvent(event) || event.pubkey !== pubkey) return reject(new Error('Invalid signed relay record'));
        events.push(event);
      });
      socket.send(JSON.stringify(['REQ','read',{authors:[pubkey]}]));
    });
  } finally { socket.close(); }
}

function latest(events: Event[], kind: number) {
  return events.filter(e=>e.kind===kind).sort((a,b)=>b.created_at-a.created_at || a.id.localeCompare(b.id))[0];
}

async function signIn(page: Page, secret: Uint8Array) {
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Use an existing profile'}).click();
  await page.getByLabel('Secret key',{exact:true}).fill(nsecEncode(secret));
  await page.getByRole('button',{name:'Sign in with secret key'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller),undefined,{timeout:20_000});
}

async function disconnect(context: BrowserContext, page: Page) {
  await context.addCookies([{name:'nostreddit_offline_fixture',value:'1',url:'http://127.0.0.1:43164'}]);
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  expect(await page.evaluate(()=>navigator.onLine)).toBe(false);
}
async function reconnect(context: BrowserContext) {
  await context.addCookies([{name:'nostreddit_offline_fixture',value:'0',url:'http://127.0.0.1:43164'}]);
  await context.setOffline(false);
}

test.beforeEach(async ({context}) => { await allowFixtureAuthors(context); });

test('offline posts, replies and reaction changes survive reload and reach the relay on reconnect', async ({page,context,browser}) => {
  const owner = generateSecretKey(), pubkey = getPublicKey(owner);
  await supply([sign(owner,0,JSON.stringify({name:'Inlet Reader'}),[],now()-90)]);
  await signIn(page, owner);
  await expect(page.getByRole('button',{name:'Inlet Reader',exact:true})).toBeVisible();
  await disconnect(context,page);

  const title = 'Hiking notes from a disconnected inlet';
  const reply = 'The tide turned before the ferry arrived.';
  await page.getByRole('button',{name:'Create post',exact:true}).first().click();
  await page.getByLabel('Topic',{exact:true}).fill('nostr');
  await page.getByLabel('Post',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Publish post',exact:true}).click();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  const permalink = page.url();
  const identifier = new URL(permalink).pathname.split('/').at(-1)!;
  expect(identifier).toMatch(/^note1[023456789acdefghjklmnpqrstuvwxyz]{58}$/);
  const id = postIdFromPath(identifier)!;
  expect(id).toMatch(/^[0-9a-f]{64}$/);
  await page.getByLabel('Your reply',{exact:true}).fill(reply);
  await page.getByRole('button',{name:'Post reply',exact:true}).click();
  await expect(page.locator('[data-route-active=\"true\"] li[data-comment-id]').filter({hasText:reply})).toBeVisible();
  const root = page.locator('[data-route-active=\"true\"] article').first();
  await root.getByRole('button',{name:'Like',exact:true}).click();
  await expect(root.getByRole('button',{name:'Liked',exact:true})).toHaveText('1');
  await root.getByRole('button',{name:'Liked',exact:true}).click();
  await expect(root.getByRole('button',{name:'Like',exact:true})).toHaveText('0');
  await page.reload();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(page.locator('[data-route-active=\"true\"] li[data-comment-id]').filter({hasText:reply})).toBeVisible();
  await root.getByRole('button',{name:'Like',exact:true}).click();
  await expect(root.getByRole('button',{name:'Liked',exact:true})).toHaveText('1');
  await page.reload();
  await expect(root.getByRole('button',{name:'Liked',exact:true})).toHaveText('1');
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.getByRole('link',{name:'Backup & sync',exact:true}).click();
  await expect(page.getByRole('region',{name:'Outbox',exact:true})).toContainText(/pending|queued|waiting/i);
  expect((await authoredBy(pubkey)).filter(e=>e.kind!==0)).toHaveLength(0);

  await reconnect(context);
  await expect.poll(async () => {
    const events = await authoredBy(pubkey);
    return events.some(e=>e.kind===1 && e.id===id)
      && events.some(e=>e.kind===1 && e.content===reply && e.tags.some(t=>t[0]==='e' && t[1]===id))
      && events.some(e=>e.kind===7 && e.tags.some(t=>t[0]==='e' && t[1]===id));
  },{timeout:25_000}).toBe(true);
  await expect(page.getByRole('region',{name:'Outbox',exact:true})).toContainText('All changes synced.',{timeout:25_000});
  const guest = await browser.newContext();
  try {
    await allowFixtureAuthors(guest);
    const fresh = await guest.newPage();
    await fresh.goto(permalink);
    await expect(fresh.getByRole('heading',{name:title,exact:true})).toBeVisible();
    await expect(fresh.locator('[data-route-active=\"true\"] li[data-comment-id]').filter({hasText:reply})).toBeVisible();
    await expect(fresh.locator('[data-route-active=\"true\"] article').first().getByRole('button',{name:'Like',exact:true})).toHaveText('1');
  } finally {await guest.close();}
  const events = await authoredBy(pubkey);
  const deletions = new Set(events.filter(e=>e.kind===5).flatMap(e=>e.tags.filter(t=>t[0]==='e').map(t=>t[1])));
  const activeLikes = events.filter(e=>e.kind===7 && !deletions.has(e.id) && e.tags.some(t=>t[0]==='e' && t[1]===id));
  expect(activeLikes).toHaveLength(1);
  expect(events.filter(e=>e.kind===1 && e.content===reply)).toHaveLength(1);
});

test('offline follow, mute and profile edits rebase onto concurrently signed lists without losing unrelated fields', async ({page,context}) => {
  const owner = generateSecretKey(), pubkey = getPublicKey(owner), start = now()-90;
  const keep = freshKey(), follow = freshKey(), unfollow = freshKey(), mute = freshKey(), unmute = freshKey(), concurrent = freshKey();
  const contactTags = [['p',keep,'wss://old.example','nickname'],['p',unfollow],['client','field guide']];
  const muteTags = [['p',keep],['p',unmute],['word','dust']];
  const encryptionKey = nip44.utils.getConversationKey(owner,pubkey);
  const opaque = nip44.encrypt(JSON.stringify([['p',freshKey()]]), encryptionKey);
  const remoteOpaque = nip44.encrypt(JSON.stringify([['p',freshKey()]]), encryptionKey);
  const oldMeta = {name:'Field Reporter',display_name:'Field Reporter',about:'Earlier profile',lud16:'reader@wallet.example'};
  await supply([
    sign(owner,0,JSON.stringify(oldMeta),[['alt','profile']],start),
    sign(owner,3,'{"wss://old.example":{"read":true}}',contactTags,start),
    sign(owner,10000,opaque,muteTags,start),
  ]);
  await signIn(page,owner);
  await expect(page.getByRole('button',{name:'Field Reporter',exact:true})).toBeVisible();
  await page.goto(profilePath(unfollow));
  await expect(page.getByRole('button',{name:'Following',exact:true})).toBeVisible();
  await page.goto(profilePath(unmute));
  await expect(page.getByRole('button',{name:'Unmute',exact:true})).toBeVisible();
  await disconnect(context,page);

  async function action(key: string, before: string, after: string) {
    await page.goto(profilePath(key));
    await page.getByRole('button',{name:before,exact:true}).click();
    await expect(page.getByRole('button',{name:after,exact:true})).toBeVisible();
  }
  await action(follow,'Follow','Following');
  await action(unfollow,'Following','Follow');
  await action(mute,'Mute','Unmute');
  await action(unmute,'Unmute','Mute');
  await page.goto(profilePath(pubkey));
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  await page.getByLabel('Display name',{exact:true}).fill('Marsh Archivist');
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Marsh Archivist',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Marsh Archivist',exact:true})).toBeVisible();
  for (const [key, state] of [[follow,'Following'],[unfollow,'Follow'],[mute,'Unmute'],[unmute,'Mute']]) {
    await page.goto(profilePath(key));
    await expect(page.getByRole('button',{name:state,exact:true})).toBeVisible();
  }
  expect(await authoredBy(pubkey)).toHaveLength(3);

  const remoteContent = '{"wss://updated.example":{"write":true}}';
  const remoteMeta = {...oldMeta, about:'Revised on another device', custom:{source:'external edits'}};
  const remoteProfileTags = [['alt','profile'],['client','other signer']];
  const remoteContactTag = ['p',concurrent,'wss://new.example','concurrent friend'];
  const remoteMuteTag = ['p',concurrent,'wss://new.example'];
  await supply([
    sign(owner,0,JSON.stringify(remoteMeta),remoteProfileTags,start+20),
    sign(owner,3,remoteContent,[...contactTags,remoteContactTag],start+20),
    sign(owner,10000,remoteOpaque,[...muteTags,remoteMuteTag],start+20),
  ]);
  await page.goto('/settings/account');
  await reconnect(context);
  await expect(page.getByRole('region',{name:'Outbox',exact:true})).toContainText('All changes synced.',{timeout:30_000});
  await expect.poll(async () => {
    const rows = await authoredBy(pubkey), people = latest(rows,3), muted = latest(rows,10000);
    return JSON.parse(latest(rows,0).content).display_name==='Marsh Archivist'
      && people.tags.some(t=>t[0]==='p' && t[1]===follow) && !people.tags.some(t=>t[0]==='p' && t[1]===unfollow)
      && muted.tags.some(t=>t[0]==='p' && t[1]===mute) && !muted.tags.some(t=>t[0]==='p' && t[1]===unmute);
  },{timeout:30_000}).toBe(true);
  const rows = await authoredBy(pubkey), people = latest(rows,3), muted = latest(rows,10000), meta = latest(rows,0);
  expect(people.tags).toEqual(expect.arrayContaining([contactTags[0],contactTags[2], remoteContactTag]));
  expect(people.content).toBe(remoteContent);
  expect(muted.tags).toEqual(expect.arrayContaining([muteTags[0],muteTags[2], remoteMuteTag]));
  expect(muted.content).toBe(remoteOpaque);
  expect(meta.tags).toEqual(remoteProfileTags);
  expect(JSON.parse(meta.content)).toEqual({...remoteMeta,name:'Marsh Archivist',display_name:'Marsh Archivist'});
});

test('changing a follow offline immediately changes which cached discussions pass the distance filter', async ({page,context}) => {
  const owner=generateSecretKey(), author=generateSecretKey(), target=getPublicKey(author), time=now()-30;
  const post=sign(author,1,'Notes from the direct graph',[['t','nostr']],time);
  await supply([sign(owner,3,'',[['p',target],['p',freshKey()]],time),post]);
  await signIn(page,owner);
  await page.goto('/settings/network');
  await page.getByLabel('Maximum follow distance').selectOption('1');
  await page.goto('/post/'+post.id);
  await expect(page.getByRole('heading',{name:post.content})).toBeVisible();
  await disconnect(context,page);
  await expect(page.getByRole('heading',{name:post.content})).toBeVisible();
  await page.goto(profilePath(target));
  await page.getByRole('button',{name:'Following',exact:true}).click();
  await expect(page.getByRole('button',{name:'Follow',exact:true})).toBeVisible();
  await page.goto('/post/'+post.id);
  await expect(page.getByRole('heading',{name:'Outside your graph settings'})).toBeVisible();
  await page.goto(profilePath(target));
  await page.getByRole('button',{name:'Follow',exact:true}).click();
  await expect(page.getByRole('button',{name:'Following',exact:true})).toBeVisible();
  await page.goto('/post/'+post.id);
  await expect(page.getByRole('heading',{name:post.content})).toBeVisible();
});
