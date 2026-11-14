import {once} from 'node:events';
import {test,expect} from '@playwright/test';
import {finalizeEvent,generateSecretKey,verifyEvent,type Event} from 'nostr-tools/pure';
import {WebSocket} from 'ws';
import {allowFixtureAuthors} from './helpers/graphPreferences';

test('a guest starts an open topic offline, publishes its first post and another profile can participate',async({page,context,browser,baseURL},info)=>{
  await allowFixtureAuthors(context);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/topics');await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.addCookies([{name:'nostreddit_offline_fixture',value:'1',url:'http://127.0.0.1:43164'}]);
  await context.setOffline(true);
  await expect(page.getByRole('heading',{name:'Topics',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/join|create community/i})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Find or open a topic'}).fill('#Quiet-Gardens');
  await page.getByRole('link',{name:'Open quiet-gardens'}).click();
  await expect(page).toHaveURL(/\/t\/quiet-gardens$/);
  await page.getByRole('button',{name:'Create post',exact:true}).first().click();
  await expect(page.getByLabel('Display name',{exact:true})).not.toHaveValue('');
  await page.getByRole('button',{name:'Create profile',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Topic',exact:true})).toHaveValue('quiet-gardens');
  await page.getByLabel('Post',{exact:true}).fill('What are you growing this winter?');
  await page.screenshot({path:info.outputPath('topic-composer-mobile.png')});
  await page.getByRole('button',{name:'Publish post',exact:true}).click();
  await expect(page.getByRole('heading',{name:'What are you growing this winter?',exact:true})).toBeVisible();
  await expect(page.locator('[data-route-active=\"true\"] article .queued').first()).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'What are you growing this winter?',exact:true})).toBeVisible();
  const owner=await page.evaluate(()=>JSON.parse(localStorage.getItem('nostreddit.account.v1')!).pubkey as string);
  await context.addCookies([{name:'nostreddit_offline_fixture',value:'0',url:'http://127.0.0.1:43164'}]);
  await context.setOffline(false);await expect(page.locator('[data-route-active=\"true\"] article .queued')).toHaveCount(0,{timeout:20000});
  const socket=new WebSocket('ws://127.0.0.1:43164');
  try{
    await once(socket,'open');
    const records=await new Promise<Event[]>(resolve=>{
      const rows:Event[]=[];socket.on('message',raw=>{const [type,id,event]=JSON.parse(String(raw));if(id!=='read')return;if(type==='EVENT')rows.push(event);if(type==='EOSE')resolve(rows);});
      socket.send(JSON.stringify(['REQ','read',{authors:[owner]}]));
    });
    expect(records.every(verifyEvent)).toBe(true);expect(records.some(e=>e.kind===34550||e.kind===37368)).toBe(false);
    const first=records.find(e=>e.kind===1)!;
    expect(first.tags).toContainEqual(['t','quiet-gardens']);
    expect(first.content).toBe('What are you growing this winter?');
    expect(first.tags.some(tag=>['a','A','h'].includes(tag[0]))).toBe(false);
    const other=finalizeEvent({kind:1,created_at:Math.floor(Date.now()/1000),content:'My seedlings are coming along',tags:[['t','quiet-gardens'],['subject','My seedlings are coming along']]},generateSecretKey());
    const ack=once(socket,'message');socket.send(JSON.stringify(['EVENT',other]));expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',other.id,true]);
  }finally{socket.close();}
  const reader=await browser.newContext({baseURL});
  try{await allowFixtureAuthors(reader);const other=await reader.newPage();await other.goto('/t/quiet-gardens');
    await expect(other.getByRole('heading',{name:'What are you growing this winter?',exact:true})).toBeVisible();
    await expect(other.getByRole('heading',{name:'My seedlings are coming along',exact:true})).toBeVisible();
    await expect(other.getByRole('main')).not.toContainText('A public Nostr topic');
  }finally{await reader.close();}
});

test('old topic URLs redirect without losing query or fragment and work offline',async({page,context,baseURL})=>{
  await page.goto('/r/Bitcoin?view=compact#latest');
  await expect(page).toHaveURL(new URL('/t/bitcoin?view=compact#latest',baseURL).href);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto('/r/photography');
  await expect(page).toHaveURL(new URL('/t/photography',baseURL).href);
  await expect(page.getByRole('heading',{name:'t/photography',exact:true})).toBeVisible();
});
