import { once } from 'node:events';
import { test, expect, type Locator } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { neventEncode, noteEncode, nprofileEncode, npubEncode, nsecEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const topic = 'boatbuilding';
const query = 'varnish';
const scopedTitles = ['Varnish for a cedar skiff', 'A second coat of varnish', 'Varnish on the old tiller'];
const outside = 'Varnish for a garden gate';
let postId: string, author: string;

test.beforeAll(async () => {
  const key = generateSecretKey();
  const created_at = Math.floor(Date.now()/1000) - 20;
  const note = (title:string, body:string, tags:string[][]) => finalizeEvent({
    kind:1, created_at, content:[title,body].filter(Boolean).join('\n\n'), tags:[['subject',title], ...tags],
  },key);
  const root = note(scopedTitles[0], 'Preparing a bare hull.', [['t','woodwork'],['t',topic]]);
  postId = root.id;
  author = root.pubkey;
  const notes = [
    finalizeEvent({kind:0,created_at,content:JSON.stringify({name:'Cedar Skiff'}),tags:[]},key),
    root, note(scopedTitles[1], '#woodwork #Boatbuilding', []),
    note(scopedTitles[2], 'Another #boatbuilding project.', [['e',root.id,'','root'],['t',topic]]),
    note(outside, 'Spring repairs.', [['t','gardening']]),
    note('A dovetail joint', 'Cutting a drawer.', [['t','woodwork']]),
    note('Riveting a clinker hull', 'Copper nails.', [['t',topic]]),
  ];
  const relay = new WebSocket(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  try {
    await once(relay,'open');
    for (const event of notes) {
      const ack = once(relay,'message');
      relay.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally { relay.close(); }
});

for (const width of [1440,390]) {
  test('search within a topic and broaden the same query at '+width+'px',async ({page,context},info) => {
    await allowFixtureAuthors(context);
    await context.addInitScript(()=>localStorage.setItem('nostreddit.ui.relatedSearch','false'));
    await page.setViewportSize({width,height:844});
    await page.goto('/t/'+topic);
    const header = page.getByRole('search');
    const input = header.getByRole('textbox');
    const remove = header.getByRole('button',{name:'Remove t/'+topic+' from search'});
    await expect(page.getByRole('heading',{name:scopedTitles[0]})).toBeVisible();
    await expect(page.locator('.feed-list .byline .topic-link')).toHaveCount(0);
    await input.focus();
    await expect(remove).toBeVisible();
    await input.fill(query);
    await remove.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(query);
    await expect(page).toHaveURL(/\/t\/boatbuilding$/);

    await page.reload();
    await input.focus();
    await expect(remove).toBeVisible();
    await expect(page.getByRole('heading',{name:scopedTitles[0]})).toBeVisible();
    await page.screenshot({path:info.outputPath('topic-search-'+width+'.png')});
    await input.fill(query); await input.press('Enter');
    await expect(page).toHaveURL(url=>url.pathname==='/search' && url.searchParams.get('t')===topic && url.searchParams.get('q')===query);
    await page.reload();
    const active = page.locator('[data-route-active="true"]');
    const cards = active.locator('.feed-list article');
    // A cold scoped search must retrieve indexed tags, written hashtags and explicitly tagged replies.
    await expect(active.locator('.relay-search')).toContainText('Found 3 matching discussions');
    await expect(cards).toHaveCount(3);
    for (const title of scopedTitles) await expect(cards.getByRole('heading',{name:title})).toBeVisible();
    await expect(cards.locator('.topic-link')).toHaveCount(0);
    await expect(active.locator('.search-topics')).toHaveCount(0);
    await expect(cards.first().locator('.stamp').first()).toHaveAttribute('href',/\?t=boatbuilding$/);
    await page.screenshot({path:info.outputPath('scoped-results-'+width+'.png')});
    if (width <= 710) {
      await active.getByRole('form',{name:'Refine search'}).getByRole('button',{name:'Remove t/'+topic+' from search'}).click();
    } else await remove.click();
    await expect(page).toHaveURL(url=>url.searchParams.get('q')===query && !url.searchParams.has('t'));
    await expect(active.getByRole('heading',{name:outside})).toBeVisible();
    await expect(cards.filter({hasText:outside}).locator('.topic-link')).toHaveText('t/gardening');
    await page.goBack();
    await expect(active.locator('.relay-search')).toContainText('Found 3 matching discussions');
    await expect(active.getByRole('heading',{name:outside})).toHaveCount(0);
    await input.focus();
    await expect(remove).toBeVisible();
    await input.fill('#woodwork varnish'); await input.press('Enter');
    await expect(page).toHaveURL(url=>url.pathname==='/search' && url.searchParams.get('q')==='#woodwork varnish' && url.searchParams.get('t')===topic);
    await input.fill('#Woodwork'); await input.press('Enter');
    await expect(page).toHaveURL(url=>url.pathname==='/search' && url.searchParams.get('q')==='#Woodwork' && url.searchParams.get('t')===topic);
    await expect(active.locator('.relay-search')).toContainText('Found 2 matching discussions');
    for (const title of scopedTitles.slice(0,2)) await expect(cards.getByRole('heading',{name:title})).toBeVisible();
    await expect(cards).toHaveCount(2);
    const openTopic = active.getByRole('link',{name:'Open t/woodwork',exact:true});
    await expect(openTopic).toHaveAttribute('href','/t/woodwork');
    await page.screenshot({path:info.outputPath('intersecting-topics.png')});
    await openTopic.click();
    await expect(page).toHaveURL(/\/t\/woodwork$/);
    await expect(active.getByRole('heading',{name:'A dovetail joint'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

function paste(input:Locator, text:string) {
  return input.evaluate((el, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    return el.dispatchEvent(new ClipboardEvent('paste',{clipboardData, bubbles:true, cancelable:true}));
  }, text);
}

for (const mobile of [false,true]) {
  test('pasted identifiers navigate and secret keys stay out of '+(mobile ? 'mobile refine search' : 'header search'), async ({page,context},info) => {
    await allowFixtureAuthors(context);
    await page.setViewportSize({width:mobile ? 390 : 1440,height:844});
    await page.goto('/search?t='+topic);
    const field = page.getByRole('textbox',{name:mobile ? 'Refine search' : 'Search Nostreddit',exact:true});
    await field.fill('varnish');
    const startingUrl = page.url();
    const secret = nsecEncode(generateSecretKey());
    for (const text of [secret,'copied nostr:'+secret.toUpperCase()+' by mistake']) {
      expect(await paste(field,text)).toBe(false);
      await expect(field).toHaveValue('varnish');
      await expect(page).toHaveURL(startingUrl);
      await expect(page.getByText(/secret keys only in the sign-in dialog/i)).toBeVisible();
    }
    expect(await paste(field,' cedar')).toBe(true);
    expect(await paste(field,'#woodwork varnish')).toBe(true);
    await field.press('ControlOrMeta+a');
    expect(await paste(field,'#Woodwork')).toBe(true);
    await expect(page).toHaveURL(startingUrl);
    expect(await paste(field,'note1unfinished')).toBe(true);
    const relays = ['wss://relay.example.test/long-enough-to-exceed-the-keyword-search-limit'];
    const note = noteEncode(postId), npub = npubEncode(author);
    for (const [value,path] of [
      [note,'/post/'+note],['nostr:'+neventEncode({id:postId,relays}),'/post/'+note],
      [postId,'/post/'+note],[npub,'/u/'+npub],['web+nostr:'+nprofileEncode({pubkey:author,relays}),'/u/'+npub],
    ]) {
      expect(await paste(field,value)).toBe(false);
      await expect(page).toHaveURL(url=>url.pathname===path && !url.search);
      const main = page.locator('[data-route-active="true"] main');
      await expect(main.getByRole('heading',{name:path.startsWith('/u/') ? 'Cedar Skiff' : scopedTitles[0],exact:true}).first()).toBeVisible();
      if (value===note) await page.screenshot({path:info.outputPath('pasted-post.png')});
      await page.goBack();
      await expect(page).toHaveURL(startingUrl);
      await expect(field).toHaveValue('varnish');
    }
    await page.goto('/search');
    await field.fill('#boatbuilding ');
    expect(await paste(field,'#woodwork')).toBe(true);
    await expect(page).toHaveURL(/\/search$/);
    await field.fill('#boatbuilding #woodwork');
    await field.press('Enter');
    await expect(page.locator('[data-route-active="true"] .feed-list article')).toHaveCount(2);
    await field.press('ControlOrMeta+a');
    expect(await paste(field,' #Woodwork ')).toBe(false);
    await expect(page).toHaveURL(/\/t\/woodwork$/);
  });
}
