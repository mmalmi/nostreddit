import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const active = '[data-route-active="true"]';
const now = Math.floor(Date.now()/1000);
async function publish(events: Event[]) {
  const socket = new WebSocket(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  try {
    await once(socket, 'open');
    for (const event of events) {
      const ack = once(socket, 'message'); socket.send(JSON.stringify(['EVENT', event]));
      expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK', event.id, true]);
    }
  } finally { socket.close(); }
}
async function manage(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'Customize feeds', exact: true }).click();
  return page.getByRole('dialog', { name: 'Customize feeds' });
}
test.beforeEach(async ({ context }) => {
  await allowFixtureAuthors(context);
  await context.addInitScript(() => localStorage.setItem('nostreddit.ui.hot', JSON.stringify({ connectionStrength: false })));
});

for (const width of [1440, 390]) {
  test(`custom feeds filter relay posts and support editing, ordering, removal and restoration at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const secret = generateSecretKey(), author = getPublicKey(secret), topic = 'custom-feed-' + width;
    const note = (title: string, key = secret, tag = topic) => finalizeEvent({ kind: 1, created_at: now, content: title, tags: [['t', tag], ['subject', title]] }, key);
    await publish([note('Moon over the coast'), note('Moon giveaway'), note('Afternoon walk'), note('Moon by another author', generateSecretKey()), note('Stars over the desert', secret, topic + '-new')]);
    await page.goto('/');
    const modal = await manage(page, width === 390);
    await expect(modal.getByRole('button', { name: 'Remove Home feed', exact: true })).toHaveCount(0);
    await expect(modal.getByRole('button', { name: 'Edit Home feed', exact: true })).toHaveCount(0);
    await modal.getByRole('button', { name: 'Add feed', exact: true }).click();
    await modal.getByLabel('Feed name', { exact: true }).fill('Night skies');
    await modal.getByLabel('Topics', { exact: true }).fill(topic);
    await modal.getByLabel('Include keywords').fill('moon, stars');
    await modal.getByLabel('Exclude keywords').fill('giveaway');
    await modal.getByLabel('Authors', { exact: true }).fill(npubEncode(author));
    await modal.getByLabel('Feed order').selectOption('New');
    await page.screenshot({ path: info.outputPath('feed-editor.png') });
    await modal.getByRole('button', { name: 'Save feed', exact: true }).click();
    await modal.getByRole('button', { name: 'Move Night skies up', exact: true }).click();
    await expect(modal.getByRole('listitem').nth(4)).toContainText('Night skies');
    await modal.getByRole('button', { name: 'Remove Following', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Edit Following', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('feed-manager.png') });
    await modal.getByRole('button', { name: 'Done', exact: true }).click();
    if (width === 390) await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('link', { name: 'Night skies', exact: true }).click();
    const url = page.url();
    await expect(page.locator(`${active} .feed-list article h2`)).toHaveText(['Moon over the coast']);
    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Night skies', exact: true })).toBeVisible();
    await expect(page.locator(`${active} .feed-list article h2`)).toHaveText(['Moon over the coast']);
    await page.locator(`${active} .hero`).getByRole('button', { name: 'Edit feed', exact: true }).click();
    await modal.getByLabel('Feed name', { exact: true }).fill('Desert skies');
    await modal.getByLabel('Topics', { exact: true }).fill(topic + '-new');
    await modal.getByRole('button', { name: 'Save feed', exact: true }).click();
    await modal.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator(`${active} .feed-list article h2`)).toHaveText(['Stars over the desert']);
    await expect(page.getByRole('heading', { name: 'Desert skies', exact: true })).toBeVisible();
    expect(page.url()).toBe(url);
    await page.screenshot({ path: info.outputPath('custom-feed.png') });
    await page.locator(`${active} .feed-list article h2 a`).click();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Desert skies', exact: true })).toBeVisible();
    await manage(page, width === 390);
    await modal.getByRole('button', { name: 'Restore defaults', exact: true }).click();
    await expect(modal.getByRole('listitem').first()).toContainText('Home feed');
    await expect(modal.getByRole('button', { name: 'Edit Following', exact: true })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Edit Desert skies', exact: true })).toBeVisible();
    await modal.getByRole('button', { name: 'Remove Desert skies', exact: true }).click();
    await modal.getByRole('button', { name: 'Undo removal', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Edit Desert skies', exact: true })).toBeVisible();
    await modal.getByRole('button', { name: 'Remove Desert skies', exact: true }).click();
    await modal.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator(`${active} .left-nav a[href="/"]`)).toHaveText('Home feed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('Following distinguishes no follows, follows without posts, and guests', async ({ page }, info) => {
  const empty = generateSecretKey(), withFollow = generateSecretKey(), followed = getPublicKey(generateSecretKey());
  await publish([
    finalizeEvent({ kind: 3, content: '', tags: [], created_at: now }, empty),
    finalizeEvent({ kind: 3, content: '', tags: [['p', followed]], created_at: now }, withFollow),
  ]);
  await page.goto('/following');
  await expect(page.getByText('Sign in to read posts from the people you follow.')).toBeVisible();
  await page.evaluate(pubkey => localStorage.setItem('nostreddit.account.v1', JSON.stringify({ pubkey, method: 'extension' })), getPublicKey(empty));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'You aren’t following anyone yet', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore the feed', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('following-empty.png') });
  await page.evaluate(pubkey => localStorage.setItem('nostreddit.account.v1', JSON.stringify({ pubkey, method: 'extension' })), getPublicKey(withFollow));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No posts from follows yet', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You aren’t following anyone yet', exact: true })).toHaveCount(0);
});

test('feed preferences synchronize across tabs and malformed storage still leaves Home usable', async ({ page, context }) => {
  await page.goto('/');
  const other = await context.newPage(); await other.goto('/');
  const modal = await manage(page, false);
  await modal.getByRole('button', { name: 'Add feed', exact: true }).click();
  await modal.getByLabel('Feed name', { exact: true }).fill('Across tabs');
  await modal.getByLabel('Authors').fill('not-a-public-key');
  await modal.getByRole('button', { name: 'Save feed', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('public');
  await modal.getByLabel('Authors').fill('');
  await modal.getByRole('button', { name: 'Save feed', exact: true }).click();
  await expect(other.getByRole('link', { name: 'Across tabs', exact: true })).toBeVisible();
  await other.evaluate(() => localStorage.setItem('nostreddit.ui.feeds', '{broken'));
  await other.reload();
  await expect(other.getByRole('link', { name: 'Home feed', exact: true })).toBeVisible();
  await other.close();
});
