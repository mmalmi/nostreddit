import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
test('proxy settings reroute open tabs, profile images and posters and preserve opened photos offline', async ({page,context}) => {
  await allowFixtureAuthors(context);
  const secret=generateSecretKey(), pubkey=getPublicKey(secret), stamp=Math.floor(Date.now()/1000);
  const base='https://origin.example', photo=base+'/p.jpg', avatar=base+'/avatar.png', banner=base+'/cover.png', clip=base+'/movie.mp4';
  const root=finalizeEvent({kind:1,created_at:stamp,tags:[['t','proxy-fixture'],['subject','Proxy delivery'],['imeta','url '+photo,'alt Harbor photo','dim 350x250']],content:'Proxy delivery\n\n'+photo+'\n'+clip},secret);
  const bio=finalizeEvent({kind:0,created_at:stamp,tags:[],content:JSON.stringify({name:'Cloud Heron',picture:avatar,banner})},secret);
  const reply=finalizeEvent({kind:1,created_at:stamp,tags:[['e',root.id,'','root']],content:'I can see the water.'},secret);
  const relay=new WebSocket(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  try {
    await once(relay,'open');
    for (const event of [root,bio,reply]) {
      const ack=once(relay,'message');relay.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally {relay.close();}
  const originalHits:string[] = [], proxyHits:string[]=[];
  let breakUnopened=false;
  await context.route('https://origin.example/**',async route => {
    originalHits.push(route.request().url());
    if (route.request().url()===clip) return route.abort();
    return route.fulfill({contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:png});
  });
  for (const host of ['imgproxy.iris.to','vidproxy.iris.to','proxy.example','video-proxy.example']) {
    await context.route('https://'+host+'/**',route=>{
      const url=route.request().url();
      proxyHits.push(url);
      const target=Buffer.from(new URL(url).pathname.split('/').pop()!,'base64url').toString();
      if (breakUnopened && target!==photo) return route.abort();
      return route.fulfill({contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:png});
    });
  }
  await page.goto('/t/proxy-fixture');
  const image=page.locator('.image-link img').first();
  await expect(image).toHaveAttribute('src',/^https:\/\/imgproxy\.iris\.to\/.+\/rs:fit:350:350\/dpr:2\//);
  await expect(page.locator('.load .poster').first()).toHaveAttribute('src',/^https:\/\/vidproxy\.iris\.to\/.+\/thumb\//);
  expect(originalHits).toEqual([]);
  const settings=await context.newPage();
  await settings.goto('/settings');
  const toggle=settings.getByLabel('Load images via proxy'), fallback=settings.getByLabel('Fallback to original source');
  await expect(toggle).toBeChecked(); await expect(fallback).toBeChecked();
  await toggle.uncheck();
  await expect(image).toHaveAttribute('src',photo);
  await settings.reload(); await expect(toggle).not.toBeChecked();
  await toggle.check(); await fallback.uncheck();
  await settings.getByText('Proxy servers and signing',{exact:true}).click();
  await settings.getByLabel('Image proxy URL',{exact:true}).fill('https://proxy.example/images');
  await settings.getByLabel('Video thumbnail proxy URL',{exact:true}).fill('https://video-proxy.example');
  await settings.getByLabel('Signing key',{exact:true}).fill('11'.repeat(32));
  await settings.getByLabel('Salt',{exact:true}).fill('22'.repeat(32));
  await settings.getByRole('button',{name:'Save proxy settings'}).click();
  await expect(settings.getByRole('status',{name:''}).filter({hasText:'Saved'}).first()).toBeVisible();
  await expect(image).toHaveAttribute('src',/^https:\/\/proxy\.example\/images\//);
  await expect(page.locator('.load .poster').first()).toHaveAttribute('src',/^https:\/\/video-proxy\.example\/.+\/thumb\//);
  originalHits.length=0;
  await page.getByRole('link',{name:'Expand image: Harbor photo'}).click();
  const viewer=page.getByRole('dialog',{name:'Expanded image'});
  await expect(viewer.locator('img')).toHaveAttribute('src',/^https:\/\/proxy\.example\/images\/.+\/dpr:2\//);
  await expect(viewer.getByRole('link',{name:'Open original'})).toHaveAttribute('href',photo);
  await expect.poll(()=>page.evaluate(async url=>!!(await (await caches.open('nostreddit-opened-photos-v1')).match(url)),photo)).toBe(true);
  expect(originalHits).toEqual([]);
  await viewer.getByRole('button',{name:'Close image'}).click();
  await page.goto('/u/'+npubEncode(pubkey));
  await expect(page.getByRole('heading',{name:'Cloud Heron'})).toBeVisible();
  await expect.poll(()=>proxyHits.some(url=>url.includes('/rs:fill:68:68/dpr:2/') && url.endsWith(Buffer.from(avatar).toString('base64url')))).toBe(true);
  await expect.poll(()=>proxyHits.some(url=>url.includes('/rs:fit:655:655/dpr:2/') && url.endsWith(Buffer.from(banner).toString('base64url')))).toBe(true);
  await page.getByRole('button',{name:'Expand profile banner'}).click();
  await expect(viewer.locator('img')).toHaveAttribute('src',/^https:\/\/proxy\.example\/images\/.+\/dpr:2\//);
  await expect(viewer.locator('img')).not.toHaveAttribute('src',/\/rs:fit:655:655\//);
  await expect(viewer.getByRole('link',{name:'Open original'})).toHaveAttribute('href',banner);
  expect(originalHits).toEqual([]);
  await viewer.getByRole('button',{name:'Close image'}).click();
  // Force a fresh failing proxy URL, and verify disabled and enabled fallbacks against actual origin requests.
  breakUnopened=true;
  await settings.getByLabel('Image proxy URL',{exact:true}).fill('https://proxy.example/fail');
  await settings.getByRole('button',{name:'Save proxy settings'}).click();
  await expect.poll(()=>proxyHits.some(url=>url.includes('/fail/') && url.endsWith(Buffer.from(avatar).toString('base64url')))).toBe(true);
  await expect(page.locator('.avatar .iris-minidenticon')).toBeVisible();
  expect(originalHits).not.toContain(avatar); expect(originalHits).not.toContain(banner);
  await fallback.check();
  await expect.poll(()=>originalHits.includes(avatar) && originalHits.includes(banner)).toBe(true);
  await settings.close();
});
