import { postUrl } from '../src/lib/post-url';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event, type EventTemplate } from 'nostr-tools/pure';
import { WebSocket } from 'ws';

// These signed public notes belong to authors one and two hops from the bundled guest graph root.
const seed: Event[] = JSON.parse(readFileSync('public/starter-feed.json', 'utf8'));
const oneHop = seed.find(e => e.id === 'c6b253ccbfc699f0f458bb7336dcf99ca907b70e4ca4ec6d0e36902f4749c992')!;
const twoHops = seed.find(e => e.id === '7ddf995cdc443cd3268ca8fee03b021f60a23236cb27d0ff98a52728bf126f5b')!;
const viewer = generateSecretKey(), friend = generateSecretKey(), outsider = generateSecretKey();
const viewerId = getPublicKey(viewer), friendId = getPublicKey(friend), outsiderId = getPublicKey(outsider);
const outsiderName = 'Ephemera field archivist', outsiderBio = 'Outside-graph observatory description';
const mineTitle = 'My private test relay field log', friendTitle = 'A field log from a direct follow';
const outsideTitle = 'An ephemera from the unknown observatory';
const replyText = 'An unknown reader annotated this trusted observation.';
const friendMention = 'I promised you a copy of our field guide.';
const at = Math.floor(Date.now()/1000) - 60;
function record(key: Uint8Array, kind: number, content: string, tags: string[][] = [], timestamp = at) {
  return finalizeEvent({kind, content, tags, created_at: timestamp}, key);
}
const outsidePost = record(outsider, 1, outsideTitle, [['t','unmapped-ephemera'], ['t','photography'], ['subject',outsideTitle]]);
const mine = record(viewer, 1, mineTitle, [['t','nostr'], ['subject',mineTitle]]);
const fromFriend = record(friend, 1, friendTitle, [['t','nostr'], ['subject',friendTitle]]);
const outsideReply = record(outsider, 1, replyText, [['e',oneHop.id,'','root',oneHop.pubkey], ['p',oneHop.pubkey], ['p',viewerId]]);

async function publish(events: Event[]) {
  const socket = new WebSocket('ws://127.0.0.1:43164');
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

test.beforeAll(async () => {
  await publish([
    oneHop, twoHops, outsidePost, mine, fromFriend,
    record(viewer,0,JSON.stringify({name:'Graph test viewer'})),
    record(friend,0,JSON.stringify({name:'Graph test friend'})),
    record(outsider,0,JSON.stringify({name:outsiderName, about:outsiderBio})),
    record(viewer,3,'',[['p',friendId]]),
    record(friend,1,friendMention,[['p',viewerId]]),
    record(outsider,7,'+',[['e',oneHop.id],['p',oneHop.pubkey],['k','1']]),
    outsideReply,
  ]);
});
test.beforeEach(async ({page}) => {
  // Public bootstrap records can contain external media; only the loopback relay matters here.
  await page.route('https://**/*', route => route.abort());
});

async function setDistance(page: Page, value: string) {
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.getByLabel('Maximum follow distance').selectOption(value);
}
async function expectFiltered(page: Page, path: string, content: string) {
  await page.goto(path);
  await expect(page.locator('main a[href="/settings"]').first()).toBeVisible();
  await expect(page.locator('main')).not.toContainText(content);
  expect(await page.title()).not.toContain(content);
}

test('guests can widen and restore the same graph limit across home, topic, saved, search and direct links', async ({page}) => {
  await page.goto('/settings');
  await expect(page.getByLabel('Maximum follow distance')).toHaveValue('5');
  await expect(page.getByLabel('Hide overmuted profiles')).toBeChecked();
  await page.getByRole('link',{name:'Home feed',exact:true}).click();
  await expect(page.locator('article h2 a[href="'+postUrl(oneHop.id)+'"]')).toBeVisible();
  const twoHopLink = page.locator('article h2 a[href="'+postUrl(twoHops.id)+'"]');
  await expect(twoHopLink).toBeVisible();
  await expect(page.getByRole('heading',{name:outsideTitle,exact:true})).toHaveCount(0);

  await setDistance(page,'1');
  await page.getByRole('link',{name:'Home feed',exact:true}).click();
  await expect(page.locator('article h2 a[href="'+postUrl(oneHop.id)+'"]')).toBeVisible();
  await expect(twoHopLink).toHaveCount(0);
  await expectFiltered(page,'/post/'+outsidePost.id,outsideTitle);
  await expectFiltered(page,'/u/'+outsiderId,outsiderName);
  await expect(page.locator('main')).not.toContainText(outsiderBio);
  await expectFiltered(page,'/post/'+outsideReply.id,replyText);

  await page.goto('/post/'+oneHop.id);
  const story = page.locator('article').first();
  await expect(story.getByRole('button',{name:'Like',exact:true})).toHaveText('0');
  await expect(story.getByRole('link',{name:'0 comments',exact:true})).toBeVisible();
  await expect(page.locator('main')).not.toContainText(replyText);

  await setDistance(page,'unlimited');
  await page.getByLabel('Hide overmuted profiles').uncheck();
  await page.reload();
  await expect(page.getByLabel('Maximum follow distance')).toHaveValue('unlimited');
  await expect(page.getByLabel('Hide overmuted profiles')).not.toBeChecked();
  await page.getByRole('link',{name:'Home feed',exact:true}).click();
  await page.getByRole('link',{name:outsideTitle,exact:true}).click();
  await page.locator('article').first().getByRole('button',{name:'Save post',exact:true}).click();
  await page.getByRole('link',{name:'Saved posts',exact:true}).click();
  await expect(page.getByRole('heading',{name:outsideTitle,exact:true})).toBeVisible();
  await page.goto('/u/'+outsiderId);
  await expect(page.getByRole('heading',{name:outsiderName,exact:true})).toBeVisible();
  await expect(page.locator('main')).toContainText(outsiderBio);
  await page.goto('/post/'+oneHop.id);
  await expect(story.getByRole('button',{name:'Like',exact:true})).toHaveText('1');
  await expect(story.getByRole('link',{name:/^1 comments?$/})).toBeVisible();
  await expect(page.locator('li[data-comment-id="'+outsideReply.id+'"]')).toContainText(replyText);

  await setDistance(page,'5');
  await page.getByRole('link',{name:'Saved posts',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Saved posts',exact:true})).toBeVisible();
  await expect(page.locator('main article')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(outsideTitle);
  await page.goto('/topics');
  await expect(page.getByRole('heading',{name:'Communities',exact:true})).toBeVisible();
  await expect(page.locator('main a[href="/r/unmapped-ephemera"]')).toHaveCount(0);
  await page.goto('/r/unmapped-ephemera');
  await expect(page.getByRole('heading',{name:'r/unmapped-ephemera',exact:true})).toBeVisible();
  await expect(page.locator('main')).not.toContainText(outsideTitle);
  await page.goto('/search?q=ephemera');
  await page.getByRole('button',{name:'Search relays',exact:true}).click();
  await expect(page.locator('.relay-search small')).toContainText('No matches in this batch. Load more to search older discussions.');
  await expect(page.getByRole('button',{name:'Load more results',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:outsideTitle,exact:true})).toHaveCount(0);
});

test('signed-in readers see their own and followed identities; other notifications and explicitly muted identities stay hidden', async ({page}) => {
  await page.exposeFunction('fixtureViewerKey', () => viewerId);
  await page.exposeFunction('fixtureViewerSign', (draft: EventTemplate) => finalizeEvent(draft,viewer));
  await page.addInitScript(() => {
    const w = window as Window & {nostr?:object;fixtureViewerKey?:Function;fixtureViewerSign?:Function};
    w.nostr = {getPublicKey:w.fixtureViewerKey,signEvent:w.fixtureViewerSign};
  });
  await page.goto('/notifications');
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('button',{name:'Use an existing profile'}).click();
  await page.getByRole('button',{name:'Sign in with extension'}).click();
  await expect(page.getByText(friendMention,{exact:true})).toBeVisible();
  await expect(page.locator('main')).not.toContainText(replyText);
  await page.goto('/post/'+mine.id);
  await expect(page.getByRole('heading',{name:mineTitle,exact:true})).toBeVisible();
  await page.goto('/post/'+fromFriend.id);
  await expect(page.getByRole('heading',{name:friendTitle,exact:true})).toBeVisible();
  await expectFiltered(page,'/u/'+outsiderId,outsiderName);
  await page.getByRole('button',{name:'Follow',exact:true}).click();
  await expect(page.getByRole('heading',{name:outsiderName,exact:true})).toBeVisible();
  await page.goto('/notifications');
  await expect(page.getByText(replyText,{exact:true})).toBeVisible();

  await setDistance(page,'unlimited');
  await page.getByLabel('Hide overmuted profiles').uncheck();
  await publish([record(viewer,10000,'',[['p',outsiderId]],at+1)]);
  await expectFiltered(page,'/u/'+outsiderId,outsiderName);
  await expectFiltered(page,'/post/'+outsidePost.id,outsideTitle);
  await page.goto('/notifications');
  await expect(page.getByText(friendMention,{exact:true})).toBeVisible();
  await expect(page.locator('main')).not.toContainText(replyText);
});
