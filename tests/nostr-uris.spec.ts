import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { neventEncode, nprofileEncode, noteEncode, npubEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { postUrl } from '../src/lib/post-url';
import { profileUrl } from '../src/lib/profile-url';
import { allowFixtureAuthors } from './helpers/graphPreferences';

for (const [device,width,height] of [['desktop',1440,960],['mobile',390,844]] as const) {
  test(device+' resolves Nostr profile mentions and quoted posts in headlines, bodies and replies', async ({page,context,baseURL},info) => {
    await allowFixtureAuthors(context);
    await page.setViewportSize({width,height});
    const author = generateSecretKey(), person = generateSecretKey();
    const pubkey = getPublicKey(person), created_at = Math.floor(Date.now()/1000);
    const sign = (content:string,tags:string[][]=[],key=author,kind=1) => finalizeEvent({kind,created_at,content,tags},key);
    const first = sign('Harbor light\n\nA quiet morning beside the water.',[['subject','Harbor light']]);
    const second = sign('Footprints in the sand\n\nThe tide has turned.',[['subject','Footprints in the sand']]);
    const npub = npubEncode(pubkey), nprofile = nprofileEncode({pubkey,relays:['wss://example.org']});
    const note = noteEncode(first.id), nevent = neventEncode({id:second.id,author:second.pubkey,kind:1,relays:['wss://example.org']});
    const invalid = 'nostr:'+note.slice(0,-4), url = 'https://example.org/'+note;
    const title = 'A walk with nostr:'+npub;
    const body = 'People: (nostr:'+npub+'), nostr:'+nprofile+'.\nRead nostr:'+note+' and nostr:'+nevent+'.\nKeep '+invalid+' as text.\n'+url;
    const topic = 'uri-fixture-'+device;
    const main = sign(title+'\n\n'+body,[['subject',title],['t',topic]]);
    const reply = sign('Replying to nostr:'+nprofile+': nostr:'+nevent,[['e',main.id,'','root'],['p',main.pubkey]]);
    const headline = sign('nostr:'+nevent,[['t','uri-headline-'+device]]);
    const events = [sign(JSON.stringify({name:'Coastal Walker'}),[],person,0),
      sign(JSON.stringify({name:'Trail Observer'}),[],author,0),first,second,main,reply,headline];
    const relay = new WebSocket('ws://127.0.0.1:'+(Number(new URL(baseURL!).port)+1));
    try {
      await once(relay,'open');
      for (const event of events) {
        const ack=once(relay,'message'); relay.send(JSON.stringify(['EVENT',event]));
        expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',event.id,true]);
      }
    } finally {relay.close();}

    await page.goto(postUrl(main.id));
    const card = page.locator('article.detail').first();
    await expect(card.locator('h2').getByRole('link',{name:'@Coastal Walker',exact:true})).toHaveAttribute('href',profileUrl(pubkey));
    const text = card.locator('.note-text');
    await expect(text.getByRole('link',{name:'@Coastal Walker',exact:true})).toHaveCount(2);
    for (const id of [first.id,second.id]) {
      await expect(text.locator('a[href="'+postUrl(id)+'"]')).toBeVisible();
      await expect(text.locator('a[href="'+postUrl(id)+'"]')).not.toHaveAttribute('target','_blank');
    }
    await expect(text).toContainText(invalid);
    await expect(card.locator('a[href="'+url+'"]')).toHaveAttribute('target','_blank');
    await expect(card.locator('.quoted-post')).toHaveCount(2);
    await expect(card.locator('.quoted-post').first()).toContainText('A quiet morning beside the water.');
    const comment = page.locator('li[data-comment-id="'+reply.id+'"]');
    await expect(comment.getByRole('link',{name:'@Coastal Walker',exact:true})).toHaveAttribute('href',profileUrl(pubkey));
    await expect(comment.locator('.quoted-post')).toContainText('Footprints in the sand');
    await page.screenshot({path:info.outputPath('nostr-uris-'+device+'.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

    await card.locator('.quoted-post').first().click();
    await expect(page).toHaveURL(new URL(postUrl(first.id),baseURL).href);
    await expect(page.getByRole('heading',{name:'Harbor light',exact:true})).toBeVisible();
    await page.goBack();
    await card.locator('h2').getByRole('link',{name:'@Coastal Walker',exact:true}).click();
    await expect(page).toHaveURL(new URL(profileUrl(pubkey),baseURL).href);
    await expect(page.getByRole('heading',{name:'Coastal Walker',exact:true})).toBeVisible();

    await page.goto('/t/'+topic);
    const feed = page.locator('article').filter({has:page.getByRole('heading',{name:'A walk with @Coastal Walker'})});
    await expect(feed.locator('.quoted-post')).toHaveCount(2);
    await page.getByRole('button',{name:'Show media previews',exact:true}).click();
    await expect(feed.locator('.quoted-post')).toHaveCount(0);
    await expect(feed.locator('.note-text a[href="'+postUrl(first.id)+'"]')).toBeAttached();

    await page.goto(postUrl(headline.id));
    await expect(page.locator('article.detail h2 a')).toHaveAttribute('href',postUrl(second.id));
    await expect(page.locator('article.detail .quoted-post')).toContainText('Footprints in the sand');
    await expect(page.locator('article.detail h2')).not.toContainText('nevent1');
  });
}
