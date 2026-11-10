import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const tag = 'search-trial';
const notes = [
  ['Handheld portraits indoors', 'A fast prime lens and a wide aperture keep handheld shots sharp in dim rooms.'],
  ['Indexing a rear derailleur', 'The gears skipped on steep climbs. Adjusting the cable tension fixed my bicycle.'],
  ['Beans for my morning cup', 'A burr grinder and a paper filter give a clean pour-over.'],
  ['A guide to brewing pale ale', 'Malt, hops and yeast for a hoppy beer.'],
  ['Walking between beaches at low tide', 'The coastal path runs from the inlet to a sandy cove.'],
  ['Cats watching the garden', 'Two tabbies watching birds from the window.'],
];
test.beforeAll(async ({baseURL}) => {
  const port = Number(new URL(baseURL!).port) + 1;
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  try {
    await once(ws, 'open');
    const fixture = createHash('sha256').update('nostreddit loopback search fixture').digest();
    for (const [i,[title,body]] of notes.entries()) {
      const topic = i === 4 ? 'coastal-archive' : i === 5 ? 'cats-archive' : tag;
      const event = finalizeEvent({kind:1, content:title+'\n\n'+body, created_at:1730000000+i,
        tags:[['t', topic], ['subject',title]]}, fixture);
      const ack = once(ws,'message');
      ws.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse((await ack)[0].toString()).slice(0,3)).toEqual(['OK',event.id,true]);
    }
    // Loose substring results fill the newest batch but do not match the word cats.
    for (let i=0; i<42; i++) {
      const title = 'catsunrelatedfixture '+i;
      const event = finalizeEvent({kind:1,content:title,created_at:1730000010+i,
        tags:[['t','cold-search-unrelated'],['subject',title]]}, fixture);
      const ack = once(ws,'message'); ws.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse((await ack)[0].toString()).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally { ws.close(); }
});
test.beforeEach(async ({context}) => { await allowFixtureAuthors(context); });
async function submit(page: Page, query: string) {
  const input = page.getByRole('textbox',{name:'Search Nostreddit'});
  await input.fill(query); await input.press('Enter');
  await expect(page).toHaveURL(url => url.pathname === '/search' && url.searchParams.get('q') === query);
}
async function ranked(page: Page) {
  await expect(page.locator('[data-route-active="true"]').getByText('Ranked on this device',{exact:true})).toBeVisible({timeout:25_000});
}
test('a cold search fetches posts and suggests its topic while the model is still loading', async ({browser,baseURL},testInfo) => {
  const context = await browser.newContext({baseURL,serviceWorkers:'block'});
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await allowFixtureAuthors(context);
    await context.route('**/*.onnx', async route => { await held; await route.abort(); });
    const page = await context.newPage();
    await page.goto('/search?q=cats', {waitUntil:'domcontentloaded'});
    const topic = page.locator('.search-topics a').first();
    await expect(topic).toHaveText('t/cats');
    await expect(topic).toHaveAttribute('href','/t/cats');
    await expect(page.getByRole('link',{name:notes[5][0],exact:true})).toBeVisible({timeout:10_000});
    await expect(page.getByText('Preparing on-device search…')).toBeVisible();
    await expect(page.getByRole('button',{name:'Search again',exact:true})).toBeVisible({timeout:10_000});
    await expect(page.getByText('Looking for matches…')).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath('search-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('search-mobile.png')});
    await topic.click();
    await expect(page).toHaveURL(/\/t\/cats$/);
    release();
  } finally { release(); await context.close(); }
});
test('a reader finds paraphrases, excludes a competing meaning and can switch back to keywords', async ({page}) => {
  await page.goto('/t/'+tag);
  await expect(page.getByRole('link',{name:notes[0][0],exact:true})).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox',{name:'Search Nostreddit'})).toBeFocused();
  const top = page.locator('[data-route-active=\"true\"] article h2').first();
  for (const [query, expected] of [
    ['taking pictures in low light without a flash',notes[0][0]],
    ['fixing a slipping bicycle chain',notes[1][0]],
    ['coffee brewing',notes[2][0]],
  ]) {
    await submit(page, query+' #'+tag); await ranked(page);
    await expect(top).toHaveText(expected);
  }
  await expect(page.getByRole('link',{name:notes[3][0],exact:true})).toHaveCount(0);
  await page.getByRole('checkbox',{name:'Match related meanings'}).uncheck();
  await expect(page.getByText('No matching posts')).toBeVisible();
  await submit(page, 'find posts about morning cup #'+tag);
  await expect(top).toHaveText(notes[2][0]);
  await page.getByRole('combobox',{name:'Sort search results'}).selectOption('New');
  await expect(top).toHaveText(notes[2][0]);
  await page.reload();
  await expect(page.getByRole('checkbox',{name:'Match related meanings'})).not.toBeChecked();
});

// Opening a result must go through the normal thread page, including on a phone.
test('a mobile reader automatically finds related relay posts and returns to the results', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('textbox',{name:'Search Nostreddit'}).click();
  await submit(page,'seaside walks'); await ranked(page);
  const link = page.getByRole('link',{name:notes[4][0],exact:true});

  await expect(link).toBeVisible({timeout:15_000});
  await expect(page.locator('[data-route-active="true"] .relay-search small')).toContainText(/Found \d+ matching/);
  await link.click();
  await expect(page).toHaveURL(/\/post\/note1[023456789acdefghjklmnpqrstuvwxyz]{58}$/);
  await page.goBack();
  await expect(page.getByRole('textbox',{name:'Search Nostreddit'})).toHaveValue('seaside walks');
  await ranked(page);
  await expect(link).toBeVisible();
  const refine = page.getByRole('textbox',{name:'Refine search'});
  await refine.fill('walking between beaches'); await refine.press('Enter'); await ranked(page);
  await expect(link).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a cold model failure preserves immediate results and a newer query wins', async ({browser,baseURL}) => {
  const context = await browser.newContext({baseURL,serviceWorkers:'block'});
  try {
    await allowFixtureAuthors(context);
    await context.route('**/*.onnx', route=>route.abort());
    const page = await context.newPage();
    await page.goto('/t/'+tag);
    await expect(page.getByRole('link',{name:notes[0][0],exact:true})).toBeVisible();
    await submit(page,'handheld portraits'); await submit(page,'rear derailleur');
    await expect(page.locator('[data-route-active=\"true\"] article h2').first()).toHaveText(notes[1][0]);
    await expect(page.getByText(/model unavailable/i)).toBeVisible({timeout:20_000});
    await expect(page.getByRole('link',{name:notes[0][0],exact:true})).toHaveCount(0);
    const input = page.getByRole('textbox',{name:'Search Nostreddit'});
    await input.fill('nsec1deadbeef'); await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(page).toHaveURL(/q=rear%20derailleur/);
    await page.goto('/search?q=nsec1deadbeef');
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.locator('[data-route-active=\"true\"] main')).not.toContainText('nsec1');
  } finally { await context.close(); }
});

test('the home shell skips model downloads and a previous search works after offline reload', async ({page,context,baseURL}) => {
  const requests: string[] = [];
  context.on('request', request => { if (request.url().includes('/assets/search/')) requests.push(request.url()); });
  await page.goto('/t/'+tag);
  await expect(page.getByRole('link',{name:notes[0][0],exact:true})).toBeVisible();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  expect(requests).toEqual([]);
  const query = 'taking pictures in low light #'+tag;
  await submit(page,query); await ranked(page);
  await expect(page.locator('[data-route-active=\"true\"] article h2').first()).toHaveText(notes[0][0]);
  await expect.poll(() => page.evaluate(async () => {
    const stores = await Promise.all((await caches.keys()).map(name=>caches.open(name)));
    const keys = (await Promise.all(stores.map(store=>store.keys()))).flat();
    return keys.some(k => k.url.endsWith('.onnx')) && keys.some(k => k.url.endsWith('.wasm'));
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve) => {
    const open = indexedDB.open('nostreddit-feed-v1');
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('snapshots').objectStore('snapshots').getAll();
      read.onsuccess = () => { db.close(); resolve(read.result.some(events =>
        events.some((e: {content:string}) => e.content.startsWith('Handheld portraits indoors')))); };
      read.onerror = () => { db.close(); resolve(false); };
    };
    open.onerror = () => resolve(false);
  }))).toBe(true);
  const relay = new URL(baseURL!); relay.port = String(Number(relay.port)+1);
  await context.addCookies([{name:'nostreddit_offline_fixture', value:'1', url:relay.href}]);
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  expect(await page.evaluate(()=>navigator.onLine)).toBe(false);
  await ranked(page);
  await expect(page.locator('[data-route-active=\"true\"] article h2').first()).toHaveText(notes[0][0]);
});
