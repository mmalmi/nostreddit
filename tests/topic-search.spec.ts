import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const topic = 'boatbuilding';
const query = 'varnish';
const scopedTitles = ['Varnish for a cedar skiff', 'A second coat of varnish', 'Varnish on the old tiller'];
const outside = 'Varnish for a garden gate';

test.beforeAll(async () => {
  const key = generateSecretKey();
  const created_at = Math.floor(Date.now()/1000) - 20;
  const note = (title:string, body:string, tags:string[][]) => finalizeEvent({
    kind:1, created_at, content:[title,body].filter(Boolean).join('\n\n'), tags:[['subject',title], ...tags],
  },key);
  const root = note(scopedTitles[0], 'Preparing a bare hull.', [['t','woodwork'],['t',topic]]);
  const notes = [
    root, note(scopedTitles[1], '#woodwork #Boatbuilding', []),
    note(scopedTitles[2], 'Another #boatbuilding project.', [['e',root.id,'','root'],['t',topic]]),
    note(outside, 'Spring repairs.', [['t','gardening']]),
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
    await input.fill('#woodwork'); await input.press('Enter');
    await expect(page).toHaveURL(url=>url.pathname==='/search' && url.searchParams.get('q')==='#woodwork' && url.searchParams.get('t')===topic);
    await expect(active.locator('.relay-search')).toContainText('Found 2 matching discussions');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
