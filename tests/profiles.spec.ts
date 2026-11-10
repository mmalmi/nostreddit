import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { nsecEncode, npubEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const relayUrl = process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164';

test('profile context links the viewer’s mutuals and uses Iris Kit names for unnamed profiles', async ({ page, context }) => {
  await allowFixtureAuthors(context);
  const [viewer, subject, unrelated] = Array.from({length:3}, () => generateSecretKey());
  // Mutuals are shown in key order. Keep the named and unnamed examples in the preview.
  const [friend, unnamed, ...others] = Array.from({length:4}, () => generateSecretKey())
    .sort((a,b) => getPublicKey(a).localeCompare(getPublicKey(b)));
  const [v, t, f, u] = [viewer, subject, friend, unnamed].map(getPublicKey);
  const timestamp = Math.floor(Date.now()/1000);
  const list = (key: Uint8Array, ...follows: string[]) => finalizeEvent({
    kind:3, tags:follows.map(id => ['p',id]), content:'', created_at:timestamp,
  },key);
  const metadata = (key: Uint8Array, name:string) => finalizeEvent({
    kind:0, tags:[], content:JSON.stringify({display_name:name}), created_at:timestamp,
  },key);
  const events: Event[] = [metadata(subject,'Harbor Watch'), metadata(friend,'Coast Wren'), metadata(unrelated,'Far Shore'),
    list(viewer, t, f, u, ...others.map(getPublicKey)), list(subject,v), list(friend,t), list(unnamed,t),
    ...others.map(key => list(key,t)), list(unrelated,t)];
  const relay = new WebSocket(relayUrl);
  try {
    await once(relay,'open');
    for (const event of events) {
      const response = once(relay,'message');
      relay.send(JSON.stringify(['EVENT',event]));
      const [kind, id, accepted] = JSON.parse(String((await response)[0]));
      expect([kind,id,accepted]).toEqual(['OK',event.id,true]);
    }
  } finally { relay.close(); }
  await page.goto('/u/'+t);
  await expect(page.getByRole('heading',{name:'Harbor Watch',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Use an existing profile'}).click();
  await page.getByRole('textbox',{name:'Secret key',exact:true}).fill(nsecEncode(viewer));
  await page.getByRole('button',{name:'Sign in with secret key'}).click();
  const header = page.getByRole('region',{name:'Profile',exact:true});
  await expect(header.getByText('Follows you',{exact:true})).toBeVisible();
  await expect(header.getByRole('link',{name:'Coast Wren',exact:true})).toBeVisible({timeout:20000});
  const unnamedLink = header.locator('a[href="/u/'+npubEncode(u)+'"]');
  await expect(unnamedLink).toBeVisible();
  await expect(unnamedLink).toHaveText(/[a-z]{3}/i);
  await expect(unnamedLink).not.toHaveText(/npub1|[0-9a-f]{6,}/i);
  await expect(header.getByText('Far Shore',{exact:true})).toHaveCount(0);
  await expect(header.getByRole('button',{name:'Copy public key'})).toBeVisible();
  await expect(header.getByText(/\bnpub1[a-z0-9]+/)).toHaveCount(0);
  await header.getByRole('link',{name:'and 1 more'}).click();
  await expect(page).toHaveURL(new RegExp('/u/'+npubEncode(t)+'/followers$'));
  await expect(page.getByRole('list',{name:'Followers'}).locator('a[href="/u/'+npubEncode(getPublicKey(others[1]))+'"]')).toBeVisible();
  await page.goBack();
  await header.getByRole('link',{name:'Coast Wren'}).click();
  await expect(page).toHaveURL(new RegExp('/u/'+npubEncode(f)+'$'));
  await expect(page.getByRole('heading',{name:'Coast Wren',exact:true})).toBeVisible();
  await page.goto('/settings');
  await page.getByLabel('Maximum follow distance').selectOption('1');
  await page.goto('/u/'+npubEncode(t)+'/followers');
  const directory=page.getByRole('list',{name:'Followers'});
  await expect(directory.getByRole('link',{name:'Coast Wren'})).toBeVisible({timeout:20000});
  await expect(directory.locator('a[href="/u/'+npubEncode(u)+'"]')).toBeVisible();
  await expect(directory.getByRole('link',{name:'Far Shore'})).toHaveCount(0);
  await expect(directory.locator('a[href="/u/'+npubEncode(v)+'"]')).toBeVisible();
  await expect(directory.getByRole('listitem')).toHaveCount(5);
  await page.goto('/u/'+npubEncode(getPublicKey(unrelated))+'/following');
  await expect(page.getByRole('link',{name:'graph settings'})).toBeVisible({timeout:20000});
  await expect(page.getByText('Far Shore',{exact:true})).toHaveCount(0);
});


test('guest relationship pages resolve legacy URLs, paginate nonmutual followers, and reopen checked lists offline', async ({page, context}) => {
  await allowFixtureAuthors(context);
  const subject = generateSecretKey(), removed = generateSecretKey(), onlyFollow = generateSecretKey();
  const t=getPublicKey(subject), nextPerson=getPublicKey(onlyFollow);
  const confirmed = Array.from({length:31},() => generateSecretKey());
  const now=Math.floor(Date.now()/1000);
  const list = (signer:Uint8Array, time:number, ...people:string[]) => finalizeEvent({
    kind:3, created_at:time, content:'', tags:people.map(key=>['p',key]),
  },signer);
  const bio = (signer:Uint8Array, name:string) => finalizeEvent({
    kind:0, created_at:now, content:JSON.stringify({name}),tags:[],
  },signer);
  const events = [bio(subject,'Harbor Directory'),bio(removed,'Former Reader'),bio(onlyFollow,'Morning Walk'),
    list(subject,now,nextPerson),list(removed,now-4,t),list(removed,now-2),
    ...confirmed.flatMap((key,index)=>[bio(key,'Birdwatcher '+(index+1)),list(key,now,t)])];
  const relay=new WebSocket(relayUrl);
  try {
    await once(relay,'open');
    for (const event of events) {
      const response=once(relay,'message');
      relay.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse(String((await response)[0])).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally {relay.close();}
  const canonical='/u/'+npubEncode(t);
  await page.goto('/u/'+t+'/followers');
  await expect(page).toHaveURL(new RegExp(canonical+'/followers$'));
  const followers=page.getByRole('list',{name:'Followers'});
  await expect(followers.getByRole('listitem')).toHaveCount(30,{timeout:20000});
  const first = await followers.getByRole('link').evaluateAll(links=>links.map(el=>el.getAttribute('href')));
  await expect(followers.getByRole('link',{name:/Former Reader/})).toHaveCount(0);
  await page.getByRole('button',{name:/Next/}).click();
  await expect(followers.getByRole('listitem')).toHaveCount(1);
  const second=await followers.getByRole('link').getAttribute('href');
  expect([...first,second].sort()).toEqual(confirmed.map(k=>'/u/'+npubEncode(getPublicKey(k))).sort());
  await page.getByRole('navigation',{name:'Relationship lists'}).getByRole('link',{name:'Following',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(canonical+'/following$'));
  const following=page.getByRole('list',{name:'Following'});
  await expect(following.getByRole('link',{name:'Morning Walk'})).toHaveAttribute('href','/u/'+npubEncode(nextPerson),{timeout:20000});
  await context.setOffline(true);
  try {
    await page.getByRole('navigation',{name:'Relationship lists'}).getByRole('link',{name:'Followers',exact:true}).click();
    await expect(followers.getByRole('listitem')).toHaveCount(30,{timeout:12000});
    await page.getByRole('navigation',{name:'Relationship lists'}).getByRole('link',{name:'Following',exact:true}).click();
    await expect(following.getByRole('link',{name:'Morning Walk'})).toBeVisible({timeout:12000});
  } finally {await context.setOffline(false);}
});

for (const width of [390, 1440]) {
  test(`profile loading placeholder matches the header at ${width}px`, async ({page, context}) => {
    await page.setViewportSize({width, height:960});
    await allowFixtureAuthors(context);
    let releaseHeader!: () => void;
    const headerReady = new Promise<void>(resolve => { releaseHeader = resolve; });
    await page.route('**/ProfileHeader-*.js', async route => {
      await headerReady;
      await route.continue();
    });
    try {
      await page.goto('/u/'+getPublicKey(generateSecretKey()), {waitUntil:'domcontentloaded'});
      const placeholder=page.locator('.profile-loading');
      await expect(placeholder).toBeAttached();
      const reserved=await placeholder.evaluate(node => node.getBoundingClientRect().height);
      releaseHeader();
      const header=page.getByRole('region',{name:'Profile',exact:true});
      await expect(header.locator('.avatar')).toBeVisible();
      await expect(placeholder).toHaveCount(0);
      const loaded=await header.boundingBox();
      expect(Math.abs(loaded!.height-reserved)).toBeLessThanOrEqual(1);
    } finally { releaseHeader(); }
  });

  test(`profile reserves image space and expands its banner and photo at ${width}px`, async ({page, context}, testInfo) => {
    await page.setViewportSize({width, height:960});
    await allowFixtureAuthors(context);
    await context.addInitScript(() => localStorage.setItem('nostreddit.ui.imageProxy', JSON.stringify({enabled:false})));
    let releaseImages!: () => void;
    const imagesReady = new Promise<void>(resolve => { releaseImages = resolve; });
    await page.route('https://profile-images.test/**', async route => {
      await imagesReady;
      const photo = route.request().url().endsWith('/avatar.svg');
      const size = photo ? 'width="48" height="64"' : 'width="1200" height="800"';
      await route.fulfill({contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" '+size+'><rect width="100%" height="100%" fill="#446655"/><circle cx="32%" cy="30%" r="12%" fill="#ffcc88"/></svg>'});
    });
    const key=generateSecretKey(), pubkey=getPublicKey(key);
    await page.goto('/u/'+getPublicKey(generateSecretKey()));
    const header=page.getByRole('region',{name:'Profile',exact:true});
    await expect(header.locator('.avatar')).toBeVisible();
    const banner=header.getByRole('button',{name:'Expand profile banner'});
    const photo=header.getByRole('button',{name:'Expand profile photo'});
    await expect(banner).toHaveCount(0);
    await expect(photo).toHaveCount(0);
    const before=await header.boundingBox();
    const event=finalizeEvent({kind:0,tags:[],created_at:Math.floor(Date.now()/1000),content:JSON.stringify({
      name:'A long profile name that should stay on one line even on a small phone',
      nip05:'reader@example.com', about:'Watching the coast and sharing stories.', website:'https://example.com',
      lud16:'reader@example.com', picture:'https://profile-images.test/avatar.svg', banner:'https://profile-images.test/banner.svg',
    })},key);
    const relay=new WebSocket(relayUrl);
    try {
      await once(relay,'open');
      const response=once(relay,'message');
      relay.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse(String((await response)[0])).slice(0,3)).toEqual(['OK',event.id,true]);
    } finally {relay.close();}
    // Profile metadata is a bounded read; visit the populated profile after the relay has it.
    await page.goto('/u/'+pubkey,{waitUntil:'domcontentloaded'});
    await expect(header.getByText('Watching the coast and sharing stories.')).toBeVisible();
    const metadata=await header.boundingBox();
    expect(Math.abs(metadata!.height-before!.height)).toBeLessThanOrEqual(1);
    releaseImages();
    await expect.poll(() => header.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth>0))).toBe(true);
    const loaded=await header.boundingBox();
    expect(Math.abs(loaded!.height-metadata!.height)).toBeLessThanOrEqual(1);
    const bannerBox=await banner.boundingBox();
    expect(Math.abs(bannerBox!.width-(loaded!.width-2))).toBeLessThanOrEqual(1);
    await page.screenshot({path:testInfo.outputPath('profile-loaded.png')});
    await banner.click();
    const viewer=page.getByRole('dialog',{name:'Expanded image'});
    const fullImage=viewer.getByRole('img',{name:/Profile banner for/});
    await expect(fullImage).toBeVisible();
    await expect.poll(() => fullImage.evaluate((image:HTMLImageElement) => image.complete && image.naturalWidth>0)).toBe(true);
    await expect(viewer.getByRole('link',{name:'Open original'})).toHaveAttribute('href','https://profile-images.test/banner.svg');
    const imageBox=await fullImage.boundingBox();
    expect(imageBox!.width).toBeLessThanOrEqual(width);
    expect(imageBox!.width/imageBox!.height).toBeCloseTo(1.5,1);
    await page.screenshot({path:testInfo.outputPath('profile-banner-expanded.png')});
    await fullImage.click();
    await expect(viewer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(banner).toBeFocused();
    await banner.press('Enter');
    await expect(viewer).toBeVisible();
    await viewer.getByRole('button',{name:'Close image'}).click();
    await expect(viewer).toHaveCount(0);
    await expect(banner).toBeFocused();
    await banner.press('Space');
    await expect(viewer).toBeVisible();
    await page.mouse.click(5,5);
    await expect(viewer).toHaveCount(0);
    await photo.click();
    const portrait=viewer.getByRole('img',{name:/Profile photo for/});
    await expect.poll(() => portrait.evaluate((img:HTMLImageElement) => img.naturalWidth)).toBe(48);
    const portraitBox=await portrait.boundingBox();
    expect(portraitBox!.width).toBeGreaterThan((await photo.boundingBox())!.width);
    expect(portraitBox!.width/portraitBox!.height).toBeCloseTo(0.75, 2);
    await expect(viewer.getByRole('link',{name:'Open original'})).toHaveAttribute('href','https://profile-images.test/avatar.svg');
    await page.screenshot({path:testInfo.outputPath('profile-photo-expanded.png')});
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(photo).toBeFocused();
  });
}
