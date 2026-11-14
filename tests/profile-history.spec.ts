import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { matchFilter } from 'nostr-tools/filter';
import type { NostrFilter } from 'nostr-pubsub';
import { WebSocketServer } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';
import { profileUrl } from '../src/lib/profile-url';

test('a profile with mostly replies fills its first page and lets the reader continue into older posts', async ({page,context,baseURL},info) => {
  const key = generateSecretKey(), author = getPublicKey(key), now = Math.floor(Date.now()/1000);
  const records = Array.from({length:205}, (_, i) => finalizeEvent({
    kind:1, created_at:now - Math.floor(i/2), content: i%5 ? 'A reply '+i : 'Field journal '+i,
    tags:i%5 ? [['e','a'.repeat(64),'','reply']] : [],
  },key));
  records.push(finalizeEvent({kind:0,created_at:now,content:JSON.stringify({name:'Field Observer'}),tags:[]},key));
  const server = new WebSocketServer({host:'127.0.0.1',port:0});
  await once(server,'listening');
  const address = server.address();
  if (!address || typeof address==='string') throw Error('Missing fixture address');
  const boundaries = new Set<number>();
  server.on('connection',socket=>socket.on('message',raw=>{
    const [command,id,...filters] = JSON.parse(raw.toString()) as [string,string,...NostrFilter[]];
    if (command!=='REQ') return;
    for (const filter of filters) {
      if (filter.authors?.includes(author) && filter.kinds?.includes(1) && filter.until!==undefined) boundaries.add(filter.until);
      for (const event of records.filter(event=>matchFilter(filter,event)).slice(0,40)) socket.send(JSON.stringify(['EVENT',id,event]));
    }
    socket.send(JSON.stringify(['EOSE',id]));
  }));
  try {
    await allowFixtureAuthors(context);
    if (baseURL?.startsWith('https:')) await context.grantPermissions(['local-network-access'],{origin:baseURL});
    await context.addInitScript(url=>{
      localStorage.setItem('nostreddit.relays.v1',url);
      localStorage.setItem('nostreddit.ui.sort',JSON.stringify('New'));
    },'ws://127.0.0.1:'+address.port);
    await page.goto(profileUrl(author));
    const cards=page.locator('.feed-list article h2');
    await expect(cards).toHaveCount(24,{timeout:12000});
    expect(await cards.allTextContents()).toEqual(Array.from({length:24},(_,i)=>'Field journal '+i*5));
    expect(boundaries.size).toBeGreaterThan(0);
    const more=page.getByRole('button',{name:'Load more discussions'});
    await expect(async()=>{
      if (await more.isVisible() && await more.isEnabled()) await more.click();
      await expect(cards).toHaveCount(41,{timeout:500});
    }).toPass({timeout:10000,intervals:[250]});
    await expect(cards.last()).toHaveText('Field journal 200');
    await expect(page.getByRole('heading',{name:/^A reply/})).toHaveCount(0);
    if (await more.isVisible()) await more.click();
    await expect(page.getByText('No more discussions.')).toBeVisible();
    await cards.last().scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('profile-older-posts.png')});
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
