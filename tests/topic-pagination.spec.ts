import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { matchFilter } from 'nostr-tools/filter';
import type { NostrFilter } from 'nostr-pubsub';
import { WebSocketServer } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test('a short visible topic can load older discussions across a tied timestamp', async ({page, context}, info) => {
  const topic = 'topic-history-fixture', key = generateSecretKey(), now = Math.floor(Date.now()/1000);
  const records = Array.from({length:19}, (_, i) => {
    // Three discussions and nine replies in the first batch. Tagged replies
    // only appear on the topic page if they mention the topic themselves.
    const tags = [['t',topic]];
    if (i >= 3 && i < 12) tags.push(['e','a'.repeat(64),'','reply']);
    return finalizeEvent({kind:1, tags, content:'Discussion ' + i,
      created_at:now - Math.floor(i/5)}, key);
  });
  const server = new WebSocketServer({host:'127.0.0.1', port:0});
  await once(server,'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing relay address');
  const requested: number[] = [];
  server.on('connection', socket => socket.on('message', raw => {
    const [command, id, ...filters] = JSON.parse(String(raw)) as [string, string, ...NostrFilter[]];
    if (command !== 'REQ') return;
    for (const filter of filters) {
      if (filter['#t']?.includes(topic) && filter.until !== undefined) requested.push(filter.until);
      for (const event of records.filter(event => matchFilter(filter,event)).slice(0,12)) {
        socket.send(JSON.stringify(['EVENT',id,event]));
      }
    }
    socket.send(JSON.stringify(['EOSE',id]));
  }));
  try {
    await allowFixtureAuthors(context);
    await context.addInitScript(url => localStorage.setItem('nostreddit.relays.v1',url), 'ws://127.0.0.1:'+address.port);
    await page.goto('/t/'+topic);
    const cards = page.locator('.feed-list article'), more = page.getByRole('button',{name:'Load more discussions'});
    await expect(cards).toHaveCount(3);
    await expect(more).toBeVisible();
    await more.click();
    await expect(cards).toHaveCount(10);
    expect(requested[0]).toBe(records[11].created_at);
    await more.click();
    await expect(page.getByText('No more discussions.')).toBeVisible();
    await expect(cards).toHaveCount(10);
    await page.screenshot({path:info.outputPath('topic-history.png')});
    await page.setViewportSize({width:390,height:844});
    await page.goto('/settings');
    await page.getByRole('link',{name:'Content filters',exact:true}).click();
    await expect(page.getByLabel('Maximum follow distance')).toHaveValue('unlimited');
    await page.getByLabel('Maximum follow distance').selectOption('2');
    await page.reload();
    await expect(page.getByLabel('Maximum follow distance')).toHaveValue('2');
    await page.screenshot({path:info.outputPath('content-filters-mobile.png')});
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
