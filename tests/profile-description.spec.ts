import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { noteEncode, npubEncode } from 'nostr-tools/nip19';
import { Relay } from 'nostr-tools/relay';
import { profileUrl } from '../src/lib/profile-url';
import { allowFixtureAuthors } from './helpers/graphPreferences';
import { expect, test } from './helpers/isolatedBrowser';

test('short attachment-only descriptions load previews on expansion', async ({page, context}) => {
  await allowFixtureAuthors(context);
  await context.addInitScript(() => localStorage.setItem('nostreddit.ui.imageProxy', JSON.stringify({enabled:false})));
  const author = generateSecretKey(), pubkey = getPublicKey(author);
  const photo = 'https://profile-media.test/shore.png';
  const tree = npubEncode(pubkey) + '/field-notes';
  const profile = finalizeEvent({kind:0, created_at:Math.floor(Date.now()/1000), tags:[],
    content:JSON.stringify({name:'Beachcomber', about:photo + '\nhtree://' + tree})}, author);
  const relay = await Relay.connect(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  try { await relay.publish(profile); } finally { relay.close(); }
  let requests = 0;
  await page.route(photo, route => {
    requests++;
    return route.fulfill({contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNY6ywKAAKmAQa4FRofAAAAAElFTkSuQmCC','base64')});
  });
  await page.goto(profileUrl(pubkey));
  const bio = page.locator('.identity [data-translation-item]');
  await expect(bio.getByRole('link', {name:photo})).toHaveAttribute('href', photo);
  expect(requests).toBe(0);
  await bio.getByRole('button', {name:'Show more'}).click();
  await expect(bio.getByRole('link', {name:'Open in Iris Drive'})).toHaveAttribute('href','https://drive.iris.to/#/' + tree);
  await expect.poll(() => bio.getByRole('img').evaluate((img:HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(bio.locator('.note-text')).toHaveCount(0);
  await bio.getByRole('button', {name:'Show less'}).click();
  await expect(bio.getByRole('img')).toHaveCount(0);
  await expect(bio.getByRole('link', {name:photo})).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`profile descriptions disclose prose and embeds at ${width}px`, async ({page, context}, info) => {
    await allowFixtureAuthors(context);
    await page.setViewportSize({width, height:900});
    const author = generateSecretKey(), friend = generateSecretKey();
    const created_at = Math.floor(Date.now() / 1000);
    const sign = (key: Uint8Array, kind: number, content: string) => finalizeEvent({kind, content, created_at, tags:[]}, key);
    const note = sign(friend, 1, 'A field guide to the northern lights');
    const friendKey = getPublicKey(friend);
    const clip = 'https://youtu.be/abcdefghijk';
    const about = [
      'Field notes with nostr:' + npubEncode(friendKey),
      'My favorite topic is #aurora.',
      'Find the guide (https://example.org/guide).',
      'Writing from the Arctic Circle.',
      'Winter expeditions resume in November.',
      'nostr:' + noteEncode(note.id), clip,
    ].join('\n');
    const longURL = 'https://example.org/' + 's'.repeat(300);
    const librarian = generateSecretKey();
    const relay = await Relay.connect(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
    try {
      await Promise.all([
        note, sign(author, 0, JSON.stringify({name:'Arctic Observer', about})),
        sign(friend, 0, JSON.stringify({name:'Field Guide', about:'Home among the #pines.'})),
        sign(librarian, 0, JSON.stringify({name:'Library', about:longURL + ' Full archive.'})),
      ].map(event => relay.publish(event)));
    } finally { relay.close(); }

    await page.goto(profileUrl(getPublicKey(author)));
    const bio = page.locator('[data-route-active="true"] .identity [data-translation-item]');
    const friendLink = bio.getByRole('link', {name:'@Field Guide'});
    await expect(friendLink).toHaveAttribute('href', profileUrl(friendKey));
    await expect(bio.getByRole('link', {name:'#aurora'})).toHaveAttribute('href', '/t/aurora');
    await expect(bio.getByRole('link', {name:'https://example.org/guide'})).toHaveAttribute('href', 'https://example.org/guide');
    await expect(bio).toContainText('Arctic Circle.');
    await expect(bio).not.toContainText('Winter expeditions');
    await expect(bio.locator('.quoted-post,.media')).toHaveCount(0);
    const more = bio.getByRole('button', {name:'Show more'});
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({path:info.outputPath('profile-description.png')});
    await more.press('Enter');
    await expect(bio).toContainText('Winter expeditions');
    await expect(bio.locator('.quoted-post')).toContainText(note.content);
    await expect(bio.getByRole('button', {name:'Load YouTube player'})).toBeVisible();
    await expect(bio.locator('iframe')).toHaveCount(0);
    await expect(bio.locator('.note-text')).not.toContainText(clip);
    const less = bio.getByRole('button', {name:'Show less'});
    await expect(less).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({path:info.outputPath('profile-description-expanded.png')});
    await less.click();
    await expect(bio.locator('.quoted-post,.media')).toHaveCount(0);
    await expect(bio).not.toContainText('Winter expeditions');

    await friendLink.click();
    await expect(bio.getByRole('link', {name:'#pines'})).toBeVisible();
    await expect(bio.getByRole('button', {name:'Show more'})).toHaveCount(0);

    await page.goto(profileUrl(getPublicKey(librarian)));
    const url = bio.getByRole('link');
    await expect(url).toHaveAttribute('href', longURL);
    expect((await url.innerText()).length).toBeLessThan(longURL.length);
    await expect(bio).not.toContainText('Full archive.');
    await more.click();
    await expect(url).toHaveText(longURL);
    await expect(bio).toContainText('Full archive.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
