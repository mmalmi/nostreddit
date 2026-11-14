import { once } from 'node:events';
import type { Locator, Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools/pure';
import { matchFilters } from 'nostr-tools/filter';
import { WebSocket, WebSocketServer } from 'ws';
import { postUrl } from '../src/lib/post-url';
import { profileUrl } from '../src/lib/profile-url';
import { allowFixtureAuthors } from './helpers/graphPreferences';
import { expect, test } from './helpers/isolatedBrowser';
import { bolt11, metadata, providerKey } from './helpers/zapInvoice';

const author = generateSecretKey(), tipper = generateSecretKey(), voter = generateSecretKey();
const anonymous = generateSecretKey(), outsider = generateSecretKey();
const created = Math.floor(Date.now() / 1000) - 30;
function sign(key: Uint8Array, kind: number, content: string, tags: string[][], offset = 0) {
  return finalizeEvent({ kind, tags, content, created_at: created + offset }, key);
}
const post = sign(author, 1, 'An early walk by the water', [['t', 'photography']]);
const comment = sign(author, 1, 'The footbridge at sunrise', [['e', post.id, '', 'root', post.pubkey], ['p', post.pubkey]]);
const lightning = 'author@reactions.example';
const poll = sign(author, 1, 'Who saw the kingfisher?', []);
const reader = generateSecretKey(), bridge = generateSecretKey(), neighbor = generateSecretKey();
const [quiet, familiar] = [generateSecretKey(), generateSecretKey()].sort((a,b) => getPublicKey(a).localeCompare(getPublicKey(b)));

function paid(target: NostrEvent, sender: Uint8Array, sats: number, offset: number, isAnonymous = false) {
  const tags = [['p', target.pubkey], ['e', target.id], ['relays', 'wss://relay.example'], ['amount', String(sats * 1000)]];
  if (isAnonymous) tags.push(['anon']);
  const request = sign(sender, 9734, '', tags, offset);
  const description = JSON.stringify(request);
  return [
    ['e', target.id], ['p', target.pubkey], ['P', request.pubkey], ['description', description],
    ['bolt11', bolt11(description, { sats, proof: generateSecretKey() })],
  ];
}

test.beforeAll(async () => {
  const first = paid(post, tipper, 200, 1);
  const profile = (key: Uint8Array, name: string, fields = {}) =>
    sign(key, 0, JSON.stringify({ name, ...fields }), []);
  const events = [
    profile(author, 'River Journal', { lud16: lightning }), profile(tipper, 'June Park'),
    profile(voter, 'Robin Vale'), profile(anonymous, 'Private tip signer'), profile(outsider, 'Wrong issuer'),
    post, comment, sign(voter, 7, '+', [['e', post.id], ['p', post.pubkey]]),
    sign(providerKey, 9735, '', first, 1), sign(providerKey, 9735, '', first, 2),
    sign(providerKey, 9735, '', paid(post, tipper, 400, 3), 3),
    sign(providerKey, 9735, '', paid(post, anonymous, 100, 4, true), 4),
    sign(outsider, 9735, '', paid(post, outsider, 9000, 5), 5),
    sign(providerKey, 9735, '', paid(comment, voter, 1000, 6), 6),
    poll, profile(reader,'You'), profile(quiet,'Ada'), profile(familiar,'Bea'), profile(neighbor,'Cora'),
    sign(reader,3,'',[quiet,familiar,bridge].map(key=>['p',getPublicKey(key)])),
    sign(bridge,3,'',[familiar,neighbor].map(key=>['p',getPublicKey(key)])),
    ...[outsider,neighbor,quiet,familiar,reader].map(key=>sign(key,7,'+',[['e',poll.id],['p',poll.pubkey]])),
  ];
  const socket = new WebSocket('ws://127.0.0.1:' + (process.env.TEST_RELAY_PORT || '43164'));
  try {
    await once(socket, 'open');
    for (const event of events) {
      const ack = once(socket, 'message');
      socket.send(JSON.stringify(['EVENT', event]));
      const [raw] = await ack;
      expect(JSON.parse(raw.toString()).slice(0, 3)).toEqual(['OK', event.id, true]);
    }
  } finally { socket.close(); }
});

test.beforeEach(async ({ context, page }) => {
  await allowFixtureAuthors(context);
  await context.addInitScript(() => localStorage.setItem('nostreddit.ui.tipCurrency', JSON.stringify('EUR')));
  await page.route('https://reactions.example/.well-known/lnurlp/author', route => route.fulfill({ json: metadata }));
  await page.route('https://api.coinbase.com/v2/exchange-rates?currency=BTC', route => route.fulfill({
    json: { data: { currency: 'BTC', rates: { BTC: '1', EUR: '50000' } } },
  }));
});

async function openThread(page: Page, target: NostrEvent) {
  await page.goto(postUrl(target.id));
  await expect(page.getByRole('heading', { name: target.content })).toBeVisible();
}

const reactions = (page: Page) => page.getByRole('dialog', { name: 'Reactions', exact: true });
const rootCard = (page: Page) => page.locator('[data-route-active="true"] article.detail');
const tab = (dialog: Locator, name: 'Upvotes' | 'Tips') => dialog.getByRole('tab', { name: new RegExp(name, 'i') });
const person = (panel: Locator, key: Uint8Array) => panel.locator(`a[href="${profileUrl(getPublicKey(key))}"]`);

async function openMenu(card: Locator) {
  await card.getByRole('button', { name: 'Post options' }).click();
  const action = card.getByRole('menuitem', { name: 'View reactions', exact: true });
  await expect(action).toHaveCount(1);
  await action.click();
}

test('upvotes put familiar follows ahead of other follows, then neighbors and strangers', async ({ page, context }, info) => {
  await context.addInitScript(key => localStorage.setItem('nostreddit.account.v1',JSON.stringify({method:'extension',pubkey:key})),getPublicKey(reader));
  await openThread(page, poll);
  await openMenu(rootCard(page));
  const links = reactions(page).getByRole('listitem').getByRole('link');
  await expect(links).toHaveText(['You','Bea','Ada','Cora','Wrong issuer'], {timeout:15000});
  await page.screenshot({path:info.outputPath('upvotes-by-connection.png')});
});

test('post and comment menus list their own upvotes and verified tips', async ({ page }, testInfo) => {
  await openThread(page, post);
  const card = rootCard(page), dialog = reactions(page);
  await expect(card.getByRole('button', { name: 'Tip with Lightning' })).toHaveText('€0.35');
  await openMenu(card);
  await expect(tab(dialog, 'Upvotes')).toHaveAttribute('aria-selected', 'true');
  await expect(person(dialog, voter)).toContainText('Robin Vale');
  await expect(person(dialog, tipper)).toHaveCount(0);

  await tab(dialog, 'Upvotes').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(dialog, 'Tips')).toBeFocused();
  await expect(tab(dialog, 'Tips')).toHaveAttribute('aria-selected', 'true');
  const panel = dialog.getByRole('tabpanel');
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  const repeat = panel.getByRole('listitem').filter({ hasText: 'June Park' });
  await expect(repeat).toContainText('€0.30');
  await expect(repeat).toContainText(/2 tips/i);
  await expect(person(repeat, tipper)).toBeVisible();
  const privateRow = panel.getByRole('listitem').filter({ hasText: /anonymous/i });
  await expect(privateRow).toContainText('€0.05');
  await expect(privateRow.getByRole('link')).toHaveCount(0);
  await expect(person(panel, outsider)).toHaveCount(0);
  await expect(person(panel, anonymous)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('post-reactions-tips.png') });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const reply = page.locator(`[data-route-active="true"] li[data-comment-id="${comment.id}"] article`);
  await openMenu(reply);
  await expect(tab(dialog, 'Upvotes')).toHaveAttribute('aria-selected', 'true');
  await expect(person(dialog, voter)).toHaveCount(0);
  await tab(dialog, 'Tips').click();
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await expect(panel).toContainText('€0.50');
  await expect(person(panel, voter)).toContainText('Robin Vale');
  await person(panel, voter).click();
  await expect(page).toHaveURL(new RegExp(profileUrl(getPublicKey(voter)) + '$'));
  await expect(page.getByRole('heading', { name: 'Robin Vale', exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test.describe('mobile reaction shortcuts', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('holding a vote or tip opens its list and a normal tip tap opens the payment form', async ({ page }, testInfo) => {
    await openThread(page, post);
    const card = rootCard(page), dialog = reactions(page);
    const like = card.getByRole('button', { name: 'Like', exact: true });
    const tip = card.getByRole('button', { name: 'Tip with Lightning' });
    const cdp = await page.context().newCDPSession(page);
    for (const [button, name] of [[like, 'Upvotes'], [tip, 'Tips']] as const) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      if (!box) throw new Error('Reaction button is outside the visible post.');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{
        x: box.x + box.width / 2, y: box.y + box.height / 2,
      }] });
      try {
        await expect(tab(dialog, name)).toHaveAttribute('aria-selected', 'true');
      } finally {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await expect(dialog).toBeVisible();
      if (name === 'Tips') {
        await expect(person(dialog, tipper)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('mobile-reactions-tips.png') });
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await tip.click({ button: 'right' });
    await expect(tab(dialog, 'Tips')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await tip.tap();
    await expect(page.getByLabel('Amount in EUR')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Get Lightning invoice' })).toBeVisible();
    await expect(dialog).toBeHidden();
  });
});

test('a busy post lists 1,000 upvoters and combines 1,000 payments from one tipper', async ({ page, context }) => {
  test.setTimeout(120_000);
  const popular = sign(author, 1, 'Summer at the footbridge', []);
  const notes = [
    popular,
    sign(author, 0, JSON.stringify({name:'River Journal', lud16:lightning}), []),
    sign(tipper, 0, JSON.stringify({name:'June Park'}), []),
  ];
  const events = [...notes];
  for (let i = 0; i < 1000; i++) {
    events.push(sign(generateSecretKey(), 7, '+', [['e',popular.id], ['p',popular.pubkey]], -i));
    events.push(sign(providerKey, 9735, '', paid(popular, tipper, 1, -i), -i));
  }
  // Keep the large history private to this test and respect each query's limit.
  const detailKinds = new Set<number>();
  const relay = new WebSocketServer({host:'127.0.0.1', port:0});
  await once(relay, 'listening');
  relay.on('connection', socket => socket.on('message', raw => {
    const [command, id, ...filters] = JSON.parse(raw.toString());
    if (command !== 'REQ') return;
    const sent = new Set<string>();
    for (const filter of filters) {
      if (filter.limit === 1000 && filter['#e']?.includes(popular.id)) {
        for (const kind of filter.kinds ?? []) detailKinds.add(kind);
      }
      const source = filter['#e']?.includes(popular.id) ? events : notes;
      const hits = source.filter(e => matchFilters([filter], e)).slice(0, filter.limit ?? 1000);
      for (const event of hits) {
        if (sent.has(event.id)) continue;
        socket.send(JSON.stringify(['EVENT',id,event]));
        sent.add(event.id);
      }
    }
    socket.send(JSON.stringify(['EOSE',id]));
  }));
  try {
    const address = relay.address();
    if (!address || typeof address === 'string') throw new Error('The fixture relay must have a port.');
    await context.addInitScript(url => localStorage.setItem('nostreddit.relays.v1',url), 'ws://127.0.0.1:'+address.port);
    await openThread(page, popular);
    await openMenu(rootCard(page));
    const dialog = reactions(page);
    await expect(dialog.getByText('1000 upvotes', {exact:true})).toBeVisible({timeout:60_000});
    expect([...detailKinds]).toEqual([7]);
    await expect(dialog.getByRole('listitem')).toHaveCount(24);
    await dialog.getByRole('button', {name:'Show more'}).click();
    await expect(dialog.getByRole('listitem')).toHaveCount(48);
    await tab(dialog, 'Tips').click();
    const row = dialog.getByRole('listitem');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('1000 tips', {timeout:60_000});
    expect(detailKinds.has(9735)).toBe(true);
    await expect(row).toContainText('€0.50');
    await expect(person(row, tipper)).toContainText('June Park');
    await page.keyboard.press('Escape');
    await expect(rootCard(page).getByRole('button', {name:'Tip with Lightning'})).toHaveText('€0.50');
  } finally {
    for (const client of relay.clients) client.terminate();
    await new Promise<void>(resolve => relay.close(() => resolve()));
  }
});
