import {test, expect, assertWorkerNetworkBlocked} from './helpers/isolatedBrowser';
import {allowFixtureAuthors} from './helpers/graphPreferences';
import {createBunkerSigner} from './helpers/bunkerSigner';

test.beforeEach(async ({context}) => {await allowFixtureAuthors(context);});

async function existingProfile(page: import('@playwright/test').Page) {
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Create profile',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sign in with bunker',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Use an existing profile',exact:true}).click();
  await page.getByRole('button',{name:'Sign in with bunker',exact:true}).click();
}

for (const width of [1440,390,320]) test(`bunker belongs to existing-profile sign-in at ${width}px`, async ({page},info) => {
  await page.setViewportSize({width,height:850});
  await page.goto('/');
  await existingProfile(page);
  await expect(page.getByRole('button',{name:'Sign in with extension'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sign in with secret key'})).toBeVisible();
  await page.getByLabel('Bunker link').fill('not-a-bunker');
  await page.getByRole('button',{name:'Connect signer'}).click();
  await expect(page.getByRole('alert')).toContainText('Enter a valid bunker:// link');
  await page.screenshot({path:info.outputPath('existing-profile.png')});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Create a new profile'}).click();
  await expect(page.getByLabel('Bunker link')).toHaveCount(0);
});

for (const width of [1440,390]) test(`bunker publishes, resumes after reload and signs out at ${width}px`, async ({page,networkBoundary},info) => {
  const signer = await createBunkerSigner();
  try {
    await assertWorkerNetworkBlocked(page,networkBoundary);
    await page.setViewportSize({width,height:900});
    await page.goto('/t/photography');
    await existingProfile(page);
    await page.getByLabel('Bunker link').fill(signer.link);
    await page.getByRole('button',{name:'Connect signer'}).click();
    await expect(page.getByRole('dialog',{name:'Nostr profile'})).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nostreddit.account.v1')!));
    expect(saved.pubkey).toBe(signer.pubkey); expect(saved.pubkey).not.toBe(signer.remotePubkey);
    expect(saved.method).toBe('bunker'); expect(saved.nsec).toBeUndefined();
    expect(saved.bunker.connection).not.toContain('secret');
    expect(JSON.stringify(saved)).not.toContain('single-use-secret');
    expect(JSON.parse(signer.requests[0].params[3]).name).toBe('Nostreddit');
    await expect.poll(() => signer.connections).toBe(0);
    await page.getByRole('main').getByRole('button',{name:'Create a post',exact:true}).click();
    const editor = page.getByRole('dialog',{name:'Create post',exact:true});
    const title = `Bunker field notes ${width}`;
    await editor.getByLabel('Title',{exact:true}).fill(title);
    await editor.getByRole('button',{name:'Publish post',exact:true}).click();
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    await page.getByLabel('Your reply',{exact:true}).fill('Still signed in after reload');
    await page.getByRole('button',{name:'Post reply',exact:true}).click();
    await expect(page.locator('[data-route-active="true"] li[data-comment-id]').filter({hasText:'Still signed in after reload'})).toBeVisible();
    expect(signer.requests.filter(request => request.method === 'connect')).toHaveLength(1);
    expect(new Set(signer.requests.map(request => request.client)).size).toBe(1);
    expect(signer.signed).toHaveLength(2);
    expect(signer.signed.every(event => event.pubkey === signer.pubkey)).toBe(true);
    expect(signer.traffic.every(event => event.kind === 24133)).toBe(true);
    await expect.poll(() => signer.connections).toBe(0);
    await page.screenshot({path:info.outputPath('signed-post-and-reply.png')});
    await page.locator('[data-route-active="true"] .account-button').click();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    expect(await page.evaluate(() => localStorage.getItem('nostreddit.account.v1'))).toBeNull();
    await page.reload();
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  } finally {await signer.close();}
});

test('cancelling or closing pairing ignores late responses and permits retry', async ({page}) => {
  const signer = await createBunkerSigner(); signer.control.silent = true;
  try {
    await page.goto('/'); await existingProfile(page);
    await page.getByLabel('Bunker link').fill(signer.link);
    await page.getByRole('button',{name:'Connect signer'}).click();
    await expect.poll(() => signer.requests.length).toBe(1);
    await page.getByRole('button',{name:'Cancel sign-in'}).click();
    await expect.poll(() => signer.connections).toBe(0);
    signer.approve();
    expect(await page.evaluate(() => localStorage.getItem('nostreddit.account.v1'))).toBeNull();
    await page.getByRole('button',{name:'Connect signer'}).click();
    await expect.poll(() => signer.requests.length).toBe(2);
    await page.keyboard.press('Escape');
    await expect.poll(() => signer.connections).toBe(0);
    signer.approve();
    expect(await page.evaluate(() => localStorage.getItem('nostreddit.account.v1'))).toBeNull();
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('button',{name:'Create profile',exact:true})).toBeVisible();
  } finally {await signer.close();}
});

test('signer approval links require a click and work above the post editor', async ({page},info) => {
  const signer = await createBunkerSigner(); signer.control.auth = true;
  try {
    await page.goto('/t/photography'); await existingProfile(page);
    await page.getByLabel('Bunker link').fill(signer.link);
    await page.getByRole('button',{name:'Connect signer'}).click();
    await expect(page.getByRole('link',{name:'Approve in signer'})).toHaveAttribute('href',signer.control.authUrl);
    expect(page.context().pages()).toHaveLength(1);
    signer.approve();
    await expect(page.getByRole('dialog',{name:'Nostr profile'})).toHaveCount(0);
    await page.getByRole('main').getByRole('button',{name:'Create a post',exact:true}).click();
    const editor = page.getByRole('dialog',{name:'Create post',exact:true});
    await editor.getByLabel('Title',{exact:true}).fill('Explicit approval');
    await editor.getByRole('button',{name:'Publish post',exact:true}).click();
    const approval = page.getByRole('dialog',{name:'Signer approval',exact:true});
    await expect(approval.getByRole('link',{name:'Approve in signer'})).toBeVisible();
    await page.screenshot({path:info.outputPath('signer-approval.png')});
    signer.approve();
    await expect(page.getByRole('heading',{name:'Explicit approval',exact:true})).toBeVisible();
    await expect(approval).toHaveCount(0);
  } finally {await signer.close();}
});

test('denied pairing and altered signed posts are rejected', async ({page}) => {
  const signer = await createBunkerSigner(); signer.control.denied = true;
  try {
    await page.goto('/t/photography'); await existingProfile(page);
    await page.getByLabel('Bunker link').fill(signer.link);
    await page.getByRole('button',{name:'Connect signer'}).click();
    await expect(page.getByRole('alert')).toContainText('Check your signer');
    expect(await page.evaluate(() => localStorage.getItem('nostreddit.account.v1'))).toBeNull();
    signer.control.denied = false;
    await page.getByRole('button',{name:'Connect signer'}).click();
    await expect(page.getByRole('dialog',{name:'Nostr profile'})).toHaveCount(0);
    signer.control.mutate = true;
    await page.getByRole('main').getByRole('button',{name:'Create a post',exact:true}).click();
    const editor = page.getByRole('dialog',{name:'Create post',exact:true});
    await editor.getByLabel('Title',{exact:true}).fill('Must remain unchanged');
    await editor.getByRole('button',{name:'Publish post',exact:true}).click();
    await expect(editor.getByRole('alert')).toContainText('Check your signer');
    await expect(editor.getByLabel('Title',{exact:true})).toHaveValue('Must remain unchanged');
    await expect.poll(() => signer.connections).toBe(0);
    signer.control.mutate = false;
    await editor.getByRole('button',{name:'Publish post',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Must remain unchanged',exact:true})).toBeVisible();
  } finally {await signer.close();}
});
