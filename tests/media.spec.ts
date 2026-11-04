import { postUrl } from '../src/lib/post-url';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const previewPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAlgAAAFoAQAAAACjj7hBAAAAeElEQVR4nO3MMQ0AAAwDoPo33ZrYswQEkN6Jy+VyuVwul8vlcrlcLpfL5XK5XC6Xy+VyuVwul8vlcrlcLpfL5XK5XC6Xy+VyuVwul8vlcrlcLpfL5XK5XC6Xy+VyuVwul8vlcrlcLpfL5XK5XC6Xy+VyuVwul+v9NfMvFLC0d5sqAAAAAElFTkSuQmCC','base64');

test('photos expand, native video stays idle, and a provider is contacted only on demand', async ({page, context}) => {
  await allowFixtureAuthors(context);
  const photo = 'https://media.example.test/shore.jpg';
  const video = 'https://media.example.test/clip';
  const youtube = 'https://youtu.be/aqz-KE-bpKQ';
  const note = finalizeEvent({
    kind: 1, created_at: Math.floor(Date.now()/1000), content: 'From the pier\n\n' + [photo,video,youtube].join('\n'),
    tags: [['subject','From the pier'], ['t','media-fixture'], ['imeta','url '+photo,'alt Harbor at sunset','dim 600x360'],
      ['imeta','url '+video,'m video/mp4','alt Boats on the water']],
  }, generateSecretKey());
  const relay = new WebSocket(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  try {
    await once(relay,'open');
    const ack = once(relay,'message');
    relay.send(JSON.stringify(['EVENT',note]));
    const [frame] = await ack;
    expect(JSON.parse(frame.toString()).slice(0,3)).toEqual(['OK',note.id,true]);
  } finally { relay.close(); }

  let providerRequests = 0;
  await page.route(photo, route => route.fulfill({contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},
    body:previewPng}));
  await page.route('https://imgproxy.iris.to/**', route => route.fulfill({contentType:'image/png',
    headers:{'Access-Control-Allow-Origin':'*'},body:previewPng}));
  await page.route('https://vidproxy.iris.to/**', route => route.fulfill({contentType:'image/png',body:previewPng}));
  await page.route(video, route => route.abort());
  await page.route('https://www.youtube-nocookie.com/**', route => {
    providerRequests++;
    return route.fulfill({contentType:'text/html',body:'<title>Fixture player</title>'});
  });

  await page.goto('/t/media-fixture');
  const feedPhoto = page.getByRole('link',{name:'Expand image: Harbor at sunset'});
  await expect(feedPhoto).toBeVisible();
  const bounds = await feedPhoto.boundingBox();
  expect(bounds!.width).toBeGreaterThan(200);
  expect(bounds!.height).toBeGreaterThan(120);
  const previews = page.getByRole('button',{name:'Show media previews',exact:true});
  await previews.click();
  await expect(previews).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.media-gallery')).toHaveCount(0);
  await page.reload();
  await expect(previews).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.media-gallery')).toHaveCount(0);
  await previews.click();
  await expect(feedPhoto).toBeVisible();
  await page.getByRole('link',{name:'From the pier',exact:true}).click();
  await expect(page).toHaveURL(url => url.pathname + url.search === postUrl(note.id,'media-fixture'));
  const expand = page.getByRole('link',{name:'Expand image: Harbor at sunset'});
  await expect(expand).toBeVisible();
  await expand.click();
  const viewer = page.getByRole('dialog',{name:'Expanded image'});
  await expect(viewer.getByRole('img',{name:'Harbor at sunset'})).toBeVisible();
  await expect(viewer.getByRole('link',{name:'Open original'})).toHaveAttribute('href',photo);
  await viewer.getByRole('img',{name:'Harbor at sunset'}).click();
  await expect(viewer).toBeVisible();
  await page.screenshot({path:test.info().outputPath('expanded-image.png')});
  await page.mouse.click(5, 5);
  await expect(viewer).toHaveCount(0);
  await expand.click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expand.click();
  await viewer.getByRole('button',{name:'Close image'}).click();
  await expect(viewer).toHaveCount(0);

  const native = page.locator('video').first();
  await expect(native).toHaveAttribute('src',video);
  await expect(native).toHaveAttribute('preload','none');
  expect(await native.evaluate(el => el instanceof HTMLVideoElement && el.controls && el.paused && !el.autoplay)).toBe(true);
  await expect(page.getByRole('button',{name:'Load YouTube player'})).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(providerRequests).toBe(0);
  await page.getByRole('button',{name:'Load YouTube player'}).click();
  await expect(page.locator('iframe[title="YouTube video player"]')).toHaveAttribute('src',
    'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ');
  await expect.poll(()=>providerRequests).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(async url=>Boolean(await (await caches.open('nostreddit-opened-photos-v1')).match(url)),photo)).toBe(true);
  await page.route(photo,route=>route.abort());
  await page.route('https://imgproxy.iris.to/**',route=>route.abort());
  await page.reload();
  await expect(page.locator('.image-link img').first()).toHaveAttribute('src',/^blob:/);
  await expand.click();
  await expect(viewer.locator('img')).toHaveAttribute('src',/^blob:/);
});
