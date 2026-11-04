import { postUrl } from '../src/lib/post-url';
import { once } from 'node:events';
import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test.beforeEach(async ({context}) => { await allowFixtureAuthors(context); });

const relayUrl = process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164';

async function seedDiscussion() {
  const birder = generateSecretKey(), ranger = generateSecretKey();
  const base = Math.floor(Date.now() / 1000) - 90;
  const topic = ['t', 'shorebird-field-notes'];
  const sign = (key: Uint8Array, offset: number, kind: number, content: string, tags: string[][]) =>
    finalizeEvent({kind, content, tags, created_at: base + offset}, key);
  const root = sign(birder, 0, 1, 'What did you see at the inlet?', [topic, ['subject', 'Inlet observations']]);
  function reply(parent: Event, key: Uint8Array, offset: number, text: string) {
    const tags = [['e', root.id, '', 'root', root.pubkey]];
    if (parent.id !== root.id) tags.push(['e', parent.id, '', 'reply', parent.pubkey]);
    return sign(key, offset, 1, text, [...tags, ['p', parent.pubkey], topic]);
  }
  const sand = reply(root, birder, 1, 'The sandbar was busy.');
  const pier = reply(root, ranger, 2, 'I watched from the pier.');
  const tracks = reply(sand, ranger, 3, 'Which tracks were in the sand?');
  const flock = reply(sand, birder, 4, 'A flock landed at noon.');
  const heron = reply(tracks, birder, 5, 'One set looked like a heron.');
  const photo = reply(heron, ranger, 6, 'I took a photo of those prints.');
  const tides = reply(pier, birder, 7, 'Did the tide reach the steps?');
  const like = sign(birder, 8, 7, '+', [['e', pier.id], ['p', pier.pubkey], ['k', '1']]);
  // Relays may return grandchildren before either their parent or the original post.
  const socket = new WebSocket(relayUrl);
  try {
    await once(socket, 'open');
    for (const event of [photo, tides, flock, heron, pier, tracks, like, sand, root]) {
      const acknowledgement = once(socket, 'message');
      socket.send(JSON.stringify(['EVENT', event]));
      const [frame] = await acknowledgement;
      expect(JSON.parse(frame.toString()).slice(0, 3)).toEqual(['OK', event.id, true]);
    }
  } finally { socket.close(); }
  return {root, sand, pier, tracks, flock, heron, photo, tides};
}

const row = (page: Page, id: string) => page.locator(`li[data-comment-id="${id}"]`);
const rows = (page: Page) => page.locator('[data-route-active=\"true\"] li[data-comment-id]');
async function expectOrder(page: Page, posts: Event[]) {
  await expect.poll(() => rows(page).evaluateAll(els => els.map(el => el.getAttribute('data-comment-id'))))
    .toEqual(posts.map(post => post.id));
}

let branch: Awaited<ReturnType<typeof seedDiscussion>>;
test.beforeAll(async () => { branch = await seedDiscussion(); });

test('sibling sorting and collapse preserve entire branches despite out-of-order delivery', async ({page}) => {
  const {root, sand, pier, tracks, flock, heron, photo, tides} = branch;
  await page.goto('/post/' + root.id);
  const sort = page.getByLabel('Sort comments');
  await sort.selectOption('old');
  await expectOrder(page, [sand, tracks, heron, photo, flock, pier, tides]);
  await expect(row(page, sand.id)).toHaveAttribute('data-depth', '0');
  await expect(row(page, tracks.id)).toHaveAttribute('data-depth', '1');
  await expect(row(page, heron.id)).toHaveAttribute('data-depth', '2');
  await expect(row(page, photo.id)).toHaveAttribute('data-depth', '3');

  await sort.selectOption('new');
  await expectOrder(page, [pier, tides, sand, flock, tracks, heron, photo]);
  await sort.selectOption('top');
  await expectOrder(page, [pier, tides, sand, tracks, heron, photo, flock]);

  const toggle = row(page, tracks.id).locator('.branch-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expectOrder(page, [pier, tides, sand, tracks, flock]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expectOrder(page, [pier, tides, sand, tracks, heron, photo, flock]);
});

test('an inline reply stays with its immediate parent on a cold comment permalink', async ({page, browser}) => {
  const {root, sand, pier, tracks, flock, heron, photo} = branch;
  await page.goto('/post/' + root.id);
  await page.getByRole('button', {name:'Sign in', exact:true}).click();
  await page.getByRole('button', {name:'Create profile', exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const parent = row(page, heron.id);
  await parent.getByRole('button', {name:'Reply to comment', exact:true}).click();
  const text = 'I found another print beside this one.';
  await parent.getByRole('textbox').fill(text);
  await parent.getByRole('button', {name:'Post reply', exact:true}).click();

  const added = rows(page).filter({hasText:text});
  await expect(added).toHaveAttribute('data-depth', '3');
  const newId = await added.getAttribute('data-comment-id');
  expect(newId).toMatch(/^[0-9a-f]{64}$/);

  // A different browser context has neither the writer's key nor its cached ancestry.
  const guest = await browser.newContext({viewport:{width:390, height:844}});
  try {
    await allowFixtureAuthors(guest);
    const reader = await guest.newPage();
    await reader.goto(new URL('/post/' + tracks.id, page.url()).href);
    await expect(reader.getByRole('link', {name:'View original discussion'})).toHaveAttribute('href', postUrl(root.id));
    await expect(reader.getByRole('link', {name:'Parent comment'})).toHaveAttribute('href', postUrl(sand.id));
    await expect(row(reader, heron.id)).toHaveAttribute('data-depth', '0');
    await expect(row(reader, photo.id)).toHaveAttribute('data-depth', '1');
    await expect(row(reader, newId!)).toHaveAttribute('data-depth', '1');
    await expect(row(reader, newId!)).toContainText(text);
    await expect(row(reader, flock.id)).toHaveCount(0);
    await expect(row(reader, pier.id)).toHaveCount(0);
    await expect(rows(reader)).toHaveCount(3);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await guest.close(); }
});
