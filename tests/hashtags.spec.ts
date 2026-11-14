import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { decode } from 'nostr-tools/nip19';
import { verifyEvent, type Event } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

async function published(id:string):Promise<Event|undefined> {
  const socket=new WebSocket('ws://127.0.0.1:43164');
  try {
    await once(socket,'open');
    return await new Promise((resolve,reject)=>{
      socket.once('error',reject);
      socket.on('message',raw=>{
        const [type,sub,event]=JSON.parse(raw.toString());
        if (sub!=='tag-test') return;
        if (type==='EVENT') {
          if(event.id!==id || !verifyEvent(event)) return reject(Error('Invalid relay event'));
          resolve(event);
        } else if(type==='EOSE') resolve(undefined);
      });
      socket.send(JSON.stringify(['REQ','tag-test',{ids:[id],limit:1}]));
    });
  } finally {socket.close();}
}
for(const [device,width,height] of [['desktop',1400,960],['mobile',390,844]] as const) {
  test(device+' can publish a multi-tag discussion and browse hashtags in its headline, body, and replies',async({page,context},info)=>{
    await allowFixtureAuthors(context);
    await page.setViewportSize({width,height});
    await page.goto('/t/mostro');
    await page.getByRole('button',{name:'Create post',exact:true}).first().click();
    await page.getByRole('button',{name:'Create profile',exact:true}).click();
    const headlineTag='Tides-'+device, bodyTag='Sunrise-'+device, replyTag='Waterline-'+device;
    const title='Watching #'+headlineTag, body='Meet at the inlet for #'+bodyTag+'. #MOSTRO #'+bodyTag;
    await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('mostro');
    await page.getByLabel('Post',{exact:true}).fill(title+'\n\n'+body);
    await page.getByRole('button',{name:'Publish post',exact:true}).click();
    await expect(page.getByRole('heading',{name:title})).toBeVisible();
    await expect(page).toHaveURL(/\/post\/note1[0-9a-z]+(?:[?#].*)?$/);
    const identifier=new URL(page.url()).pathname.split('/').at(-1)!;
    const pointer=decode(identifier); if(pointer.type!=='note')throw Error('Expected note permalink');
    const expected=['mostro',headlineTag.toLowerCase(),bodyTag.toLowerCase()];
    await expect.poll(async()=>(await published(pointer.data))?.tags.filter(t=>t[0]==='t').map(t=>t[1])).toEqual(expected);

    await page.getByRole('heading',{name:title}).getByRole('link',{name:'#'+headlineTag}).click();
    await expect(page).toHaveURL(new RegExp('/t/'+headlineTag.toLowerCase()+'$'));
    const card=page.locator('[data-route-active=\"true\"] article').filter({has:page.getByRole('heading',{name:title})});
    await expect(card.locator('.topic-link')).toHaveText('t/'+headlineTag.toLowerCase());
    await card.getByRole('link',{name:'#'+bodyTag,exact:true}).first().click();
    const fromTag=bodyTag.toLowerCase();
    await expect(page).toHaveURL(new RegExp('/t/'+fromTag+'$'));
    await card.locator('.stamp').first().click();
    await expect(page).toHaveURL(new RegExp('/post/'+identifier+'\\?t='+fromTag+'$'));
    await expect(page.locator('[data-route-active="true"] a.back-link').first()).toHaveAttribute('href','/t/'+fromTag);
    const reply='The channel is rising. #'+replyTag;
    await page.locator('[data-route-active="true"]').getByLabel('Your reply').fill(reply);
    await page.getByRole('button',{name:'Post reply',exact:true}).click();
    const row=page.locator('[data-route-active=\"true\"] li[data-comment-id]').filter({hasText:reply});
    const id=await row.getAttribute('data-comment-id');
    await expect.poll(async()=>(await published(id!))?.tags.filter(t=>t[0]==='t').map(t=>t[1])).toEqual(['mostro',replyTag.toLowerCase()]);
    await row.getByRole('link',{name:'#'+replyTag,exact:true}).click();
    await expect(page).toHaveURL(new RegExp('/t/'+replyTag.toLowerCase()+'$'));
    const matchingReply=page.locator('[data-route-active=\"true\"] article').filter({has:page.getByRole('heading',{name:reply})});
    await expect(matchingReply.getByRole('link',{name:'Reply to discussion'})).toBeVisible();
    await page.screenshot({path:info.outputPath('tagged-reply-'+device+'.png')});
    await matchingReply.locator('.stamp').first().click();
    await expect(page.locator('[data-route-active="true"] a.back-link').first()).toHaveAttribute('href','/t/'+replyTag.toLowerCase());
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
