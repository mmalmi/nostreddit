import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const active = '[data-route-active="true"]';
const now = Math.floor(Date.now() / 1000);
function note(title: string, topic: string, offset: number, extraTopics: string[] = []) {
  return finalizeEvent({ kind: 1, content: `${title}\n\nA longer field note to keep a useful reading position in the discussion list.`,
    tags: [['subject', title], ['t', topic], ...extraTopics.map(topic => ['t', topic])], created_at: now + offset }, generateSecretKey());
}
async function publish(events: Event[]) {
  const socket = new WebSocket(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  try {
    await once(socket, 'open');
    for (const event of events) {
      const ack = once(socket, 'message');
      socket.send(JSON.stringify(['EVENT', event]));
      expect(JSON.parse(String((await ack)[0])).slice(0, 3)).toEqual(['OK', event.id, true]);
    }
  } finally { socket.close(); }
}
test.beforeEach(async ({ context }) => {
  await allowFixtureAuthors(context);
  await context.addInitScript(() => localStorage.setItem('nostreddit.ui.hot', JSON.stringify({ connectionStrength: false })));
});

for (const order of ['Hot', 'New', 'Top']) {
  test(`${order} keeps painted cards in place at the top as posts and reactions arrive`, async ({ page }) => {
    const topic = `stable-${order.toLowerCase()}`;
    const rows = Array.from({ length: 8 }, (_, i) => note(`Stable ${order} ${i}`, topic, -3600 - i));
    await publish(rows);
    await page.addInitScript(order => localStorage.setItem('nostreddit.ui.sort', JSON.stringify(order)), order);
    await page.goto(`/t/${topic}`);
    await expect(page.getByRole('button', { name: order, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const titles = page.locator(`${active} .feed-list article h2`);
    await expect(titles).toHaveCount(rows.length);
    const before = await titles.evaluateAll(nodes => nodes
      .filter(node => node.closest('article')!.getBoundingClientRect().top < innerHeight)
      .map(node => node.textContent));
    const first = await titles.first().elementHandle();
    const incoming = note(`Incoming ${order}`, topic, -5);
    const likes = Array.from({ length: 5 }, () => finalizeEvent({ kind: 7, content: '+',
      tags: [['e', rows[7].id], ['p', rows[7].pubkey]], created_at: now }, generateSecretKey()));
    await publish([incoming, ...likes]);
    await expect(page.locator(`${active} .feed-list article`).filter({ has: page.getByRole('heading', { name: `Stable ${order} 7`, exact: true }) })
      .getByRole('button', { name: 'Like', exact: true })).toHaveText('5');
    const update = page.getByRole('button', { name: 'Show updated posts', exact: true });
    await expect(update).toBeVisible();
    expect((await titles.allTextContents()).slice(0, before.length)).toEqual(before);
    expect(await titles.first().evaluate((node, old) => node === old, first)).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await update.click();
    await expect(titles.first()).toHaveText(order === 'New' ? `Incoming ${order}` : `Stable ${order} 7`);
  });
}

for (const width of [390, 1440]) {
  test(`New applies below-viewport arrivals without prompting or moving the reader at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 });
    const topic = `viewport-${width}`;
    const rows = Array.from({ length: 28 }, (_, i) => note(`Field note ${i}`, topic, -1200 - i * 10));
    await publish(rows);
    await page.addInitScript(order => localStorage.setItem('nostreddit.ui.sort', JSON.stringify(order)), 'New');
    await page.goto(`/t/${topic}`);
    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const cards = page.locator(`${active} .feed-list article`);
    const titles = cards.locator('h2');
    const update = page.getByRole('button', { name: 'Show updated posts' });
    await expect(titles).toHaveCount(24);
    const anchor = cards.nth(8).locator('h2 a');
    await anchor.evaluate(node => scrollTo(0, scrollY + node.getBoundingClientRect().top - 120));
    const before = await anchor.boundingBox();
    expect((await cards.nth(17).boundingBox())!.y).toBeGreaterThan(800);
    const notices = await page.evaluateHandle(() => {
      const added: string[] = [];
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.textContent?.includes('Show updated posts')) added.push(node.textContent);
        }
      }).observe(document.querySelector('.hot-controls')!, { childList: true, subtree: true });
      return added;
    });
    await publish([note('Quiet insertion', topic, -1365)]);
    await expect(titles.nth(17)).toHaveText('Quiet insertion');
    expect(await notices.jsonValue()).toEqual([]);
    await expect(update).toHaveCount(0);
    expect((await anchor.boundingBox())!.y).toBe(before!.y);

    await publish([note('Before the reader', topic, -1275), note('Another quiet insertion', topic, -1395)]);
    await expect(update).toBeAttached();
    await expect(titles.nth(8)).toHaveText('Field note 8');
    await expect(cards.filter({ hasText: 'Another quiet insertion' }).locator('+ article h2')).toHaveText('Field note 20');
    expect((await anchor.boundingBox())!.y).toBe(before!.y);
    await page.screenshot({ path: info.outputPath('stable-viewport.png') });

    await page.evaluate(() => scrollTo(0, 0));
    await expect(update).toHaveCount(0);
    await expect(titles.nth(8)).toHaveText('Before the reader');
  });

  test(`the post Back link returns to the original home feed and scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await publish(Array.from({ length: 30 }, (_, i) => note(`Home return ${width} ${i}`, `home-return-${width}`, -1200 - i, ['photography'])));
    await page.addInitScript(order => localStorage.setItem('nostreddit.ui.sort', JSON.stringify(order)), 'New');
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const links = page.locator(`${active} .feed-list article h2 a`);
    await expect(links).toHaveCount(24);
    const link = links.nth(18);
    await link.evaluate(node => scrollTo(0, node.getBoundingClientRect().top + scrollY - 120));
    const before = await page.evaluate(() => scrollY);
    await link.click();
    await expect(page.getByRole('heading', { name: 'Comments', exact: true })).toBeVisible();
    await page.locator(`${active} main > a.back-link`).first().click();
    await expect(page).toHaveURL('/');
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  });

  test(`back restores the same card when an earlier photo finishes loading offscreen at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addInitScript(() => localStorage.setItem('nostreddit.ui.imageProxy', JSON.stringify({ enabled: false })));
    let release!: () => void;
    const imageReady = new Promise<void>(resolve => { release = resolve; });
    await page.route('https://feed-images.test/**', async route => {
      await imageReady;
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#456756"/></svg>' });
    });
    const topic = `scroll-photo-${width}`;
    const photo = finalizeEvent({ kind: 1, content: 'https://feed-images.test/late.png', tags: [['subject', 'Slow photo'], ['t', topic]], created_at: now - 100 }, generateSecretKey());
    await publish([photo, ...Array.from({ length: 28 }, (_, i) => note(`Photo scroll ${width} ${i}`, topic, -200 - i))]);
    await page.addInitScript(order => localStorage.setItem('nostreddit.ui.sort', JSON.stringify(order)), 'New');
    await page.goto(`/t/${topic}`);
    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const link = page.locator(`${active} .feed-list article h2 a`).filter({ hasText: `Photo scroll ${width} 18` });
    await expect(link).toBeAttached();
    await link.evaluate(node => scrollTo(0, node.getBoundingClientRect().top + scrollY - 120));
    const before = (await link.boundingBox())!.y;
    await link.click();
    await expect(page.getByRole('heading', { name: 'Comments', exact: true })).toBeVisible();
    release();
    await expect.poll(() => page.locator('img[alt^="Photo from feed-images.test"]').first().evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1200);
    await page.goBack();
    await expect(link).toBeVisible();
    await expect.poll(async () => Math.abs((await link.boundingBox())!.y - before)).toBeLessThanOrEqual(1);
  });

  for (const order of ['Hot', 'New']) {
    test(`post back navigation retains feed scroll and card offset at ${width}px in ${order}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const topic = `scroll-${width}-${order.toLowerCase()}`;
      const rows = Array.from({ length: 36 }, (_, i) => note(`Scroll ${width} ${order} ${i}`, topic, -7200 - i));
      await publish(rows);
      await page.addInitScript(order => localStorage.setItem('nostreddit.ui.sort', JSON.stringify(order)), order);
      await page.goto(`/t/${topic}`);
      await expect(page.getByRole('button', { name: order, exact: true })).toHaveAttribute('aria-pressed', 'true');
      const titles = page.locator(`${active} .feed-list article h2 a`);
      await expect(titles).toHaveCount(24);
      const link = titles.nth(18);
      const href = (await link.getAttribute('href'))!;
      await link.evaluate(node => scrollTo(0, node.getBoundingClientRect().top + scrollY - 120));
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(1500);
      const original = await link.elementHandle();
      const before = await link.evaluate(node => ({ scroll: scrollY, top: node.getBoundingClientRect().top }));
      await link.click();
      await expect(page).toHaveURL(new RegExp(href.split('?')[0]));
      await expect(page.getByRole('heading', { name: 'Comments', exact: true })).toBeVisible();
      await publish([note(`Arrived while reading ${width} ${order}`, topic, -1)]);
      await page.goBack();
      const restored = page.locator(`${active} .feed-list article h2 a`).filter({ hasText: `Scroll ${width} ${order} 18` });
      await expect(restored).toBeVisible();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before.scroll, 0);
      expect(await restored.evaluate((node, old) => node === old, original)).toBe(true);
      expect(Math.abs((await restored.boundingBox())!.y - before.top)).toBeLessThanOrEqual(1);
      // A second forward/back cycle must keep the original feed snapshot too.
      await page.goForward();
      await expect(page.getByRole('heading', { name: 'Comments', exact: true })).toBeVisible();
      await page.goBack();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before.scroll, 0);
      expect(Math.abs((await restored.boundingBox())!.y - before.top)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath('restored-feed.png') });
    });
  }
}

test('a short feed waits when an appended card would enter the viewport', async ({ page }) => {
  const topic = 'viewport-short';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await publish([note('Only card', topic, -40)]);
  await page.addInitScript(order => localStorage.setItem('nostreddit.ui.sort', JSON.stringify(order)), 'New');
  await page.goto(`/t/${topic}`);
  await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const cards = page.locator(`${active} .feed-list article`);
  await expect(cards).toHaveCount(1);
  const bottom = await cards.first().evaluate(node => node.getBoundingClientRect().bottom);
  expect(bottom).toBeLessThan(950);
  await publish([note('Older card', topic, -80)]);
  const update = page.getByRole('button', { name: 'Show updated posts' });
  await expect(update).toBeVisible();
  await expect(cards).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: Math.floor(bottom) - 10 });
  await expect(cards).toHaveCount(2);
  await expect(update).toHaveCount(0);
});

test('choosing another sort shows arrivals that follow without a prompt', async ({ page }) => {
  const topic = 'sort-switch';
  const rows = Array.from({ length: 8 }, (_, i) => note(`Switch ${i}`, topic, -3600 - i));
  await publish(rows);
  await page.goto(`/t/${topic}`);
  const titles = page.locator(`${active} .feed-list article h2`);
  await expect(titles).toHaveCount(rows.length);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(titles.first()).toHaveText('Switch 0');
  await publish([note('Switch arrival', topic, -5)]);
  await expect(titles.first()).toHaveText('Switch arrival');
  await expect(page.getByRole('button', { name: 'Show updated posts' })).toHaveCount(0);
});
