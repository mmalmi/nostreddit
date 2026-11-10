import { once } from 'node:events';
import { test, expect, assertWorkerNetworkBlocked } from './helpers/isolatedBrowser';
import type { Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';

test('an established reader and two new friends connect and discover each other with default graph filters',async ({page,context,browser,baseURL,networkBoundary},info) => {
  test.setTimeout(120_000);
  await assertWorkerNetworkBlocked(page,networkBoundary);
  const inviter=generateSecretKey(), oldFriend=generateSecretKey(), inviterKey=getPublicKey(inviter);
  const created_at=Math.floor(Date.now()/1000)-60;
  const record=(key:Uint8Array,kind:number,content:string,tags:string[][]=[])=>finalizeEvent({kind,created_at,content,tags},key);
  const relay=new WebSocket(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
  try {
    await once(relay,'open');
    for (const event of [record(inviter,0,JSON.stringify({name:'Rowan the inviter'})),
      record(oldFriend,0,JSON.stringify({name:'An established connection'})),
      record(inviter,3,'',[['p',getPublicKey(oldFriend)]]),record(oldFriend,3,'',[['p',inviterKey]]),
      record(inviter,1,'Welcome to our little corner of Nostr.',[['subject','Welcome to our little corner of Nostr.'],['t','new-friends']])]) {
      const ack=once(relay,'message');relay.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally {relay.close();}
  await page.exposeFunction('inviterKey',()=>inviterKey);
  await page.exposeFunction('inviterSign',(event:EventTemplate)=>finalizeEvent(event,inviter));
  await page.addInitScript(()=>{
    const w=window as Window & {nostr?:object;inviterKey?:Function;inviterSign?:Function};
    w.nostr={getPublicKey:w.inviterKey,signEvent:w.inviterSign};
  });
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('button',{name:'Use an existing profile'}).click();
  await page.getByRole('button',{name:'Sign in with extension'}).click();
  await expect(page.getByRole('button',{name:'Rowan the inviter',exact:true})).toBeVisible();
  await page.goto('/u/'+npubEncode(inviterKey));
  await page.getByRole('button',{name:'Copy profile link',exact:true}).click();
  const invitation=await page.evaluate(()=>navigator.clipboard.readText());
  expect(invitation).toBe(new URL('/u/'+npubEncode(inviterKey),baseURL).href);

  async function openPerson(reader:Page,publicKey:string) {
    const search=reader.getByRole('textbox',{name:'Search Nostreddit'});
    await search.fill(publicKey);await search.press('Enter');
    await expect(reader).toHaveURL(new RegExp('/u/'+publicKey+'$'));
  }
  async function followPerson(reader:Page,publicKey:string,name:string) {
    await openPerson(reader,publicKey);
    await reader.getByRole('region',{name:'Profile',exact:true}).getByRole('button',{name:'Follow',exact:true}).click();
    await expect(reader.getByRole('region',{name:'Profile',exact:true}).getByRole('button',{name:'Following',exact:true})).toBeVisible();
    await expect(reader.getByRole('heading',{name,exact:true})).toBeVisible();
  }
  const friendContexts=[];
  const friends:{page:Page;name:string;npub:string;title:string}[]=[];
  try {
    for (const [index,name] of ['Mira Newfriend','Leo Newfriend'].entries()) {
      const fresh=await browser.newContext({baseURL,proxy:{server:networkBoundary.url,bypass:'127.0.0.1,localhost'},serviceWorkers:'block',viewport:{width:index ? 390 : 1440,height:960}});
      friendContexts.push(fresh);
      await fresh.grantPermissions(['clipboard-read','clipboard-write']);
      const reader=await fresh.newPage();
      await reader.goto(invitation);
      await reader.getByRole('region',{name:'Profile',exact:true}).getByRole('button',{name:'Follow',exact:true}).click();
      await reader.getByLabel('Display name',{exact:true}).fill(name);
      await reader.getByRole('button',{name:'Create profile',exact:true}).click();
      await expect(reader.getByRole('button',{name,exact:true})).toBeVisible();
      await expect(reader.getByRole('region',{name:'Profile',exact:true}).getByRole('button',{name:'Following',exact:true})).toBeVisible();
      await expect(reader.getByRole('heading',{name:'Rowan the inviter',exact:true})).toBeVisible();
      // Exchange the same public identifier a real person can send to a friend.
      await reader.getByRole('button',{name,exact:true}).click();
      await reader.getByRole('link',{name:'View profile',exact:true}).click();
      await reader.getByRole('button',{name:'Copy public key',exact:true}).click();
      const npub=await reader.evaluate(()=>navigator.clipboard.readText());
      expect(npub).toMatch(/^npub1/);
      await followPerson(page,npub,name);
      const title=`${name}'s first post`;
      await reader.getByRole('button',{name:'Create post',exact:true}).first().click();
      await reader.getByRole('combobox',{name:'Topic',exact:true}).fill('new-friends');
      await reader.getByLabel('Title',{exact:true}).fill(title);
      await reader.getByLabel(/Body/).fill('Hello friends, I made it here.');
      await reader.getByRole('button',{name:'Publish post',exact:true}).click();
      await expect(reader.getByRole('heading',{name:title,exact:true})).toBeVisible();
      friends.push({page:reader,name,npub,title});
    }
    await page.goto('/following');
    for (const friend of friends) await expect(page.getByRole('heading',{name:friend.title,exact:true})).toBeVisible({timeout:20_000});
    await page.screenshot({path:info.outputPath('inviter-sees-both-friends.png')});
    for (const [index,friend] of friends.entries()) {
      const other=friends[1-index];
      await friend.page.goto('/network');
      // The inviter's signed follow list brings the other newcomer two steps away.
      await expect(friend.page.getByRole('heading',{name:other.title,exact:true})).toBeVisible({timeout:20_000});
      await followPerson(friend.page,other.npub,other.name);
      await friend.page.goto('/following');
      await expect(friend.page.getByRole('heading',{name:other.title,exact:true})).toBeVisible();
      await friend.page.reload();
      await expect(friend.page.getByRole('heading',{name:other.title,exact:true})).toBeVisible();
      await friend.page.screenshot({path:info.outputPath('connected-friend-'+index+'.png')});
      await friend.page.goto('/settings');
      await expect(friend.page.getByLabel('Maximum follow distance')).toHaveValue('5');
      await expect(friend.page.getByLabel('Hide overmuted profiles')).toBeChecked();
    }
    await page.reload();
    for (const friend of friends) await expect(page.getByRole('heading',{name:friend.title,exact:true})).toBeVisible();
  } finally {for (const fresh of friendContexts) await fresh.close().catch(()=>{});}
});

test('cancelling sign-in clears the requested follow',async ({page})=>{
  await page.goto('/u/'+npubEncode(getPublicKey(generateSecretKey())));
  const profile=page.getByRole('region',{name:'Profile',exact:true});
  await profile.getByRole('button',{name:'Follow',exact:true}).click();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByLabel('Display name',{exact:true}).fill('Independent Newcomer');
  await page.getByRole('button',{name:'Create profile',exact:true}).click();
  await expect(page.getByRole('button',{name:'Independent Newcomer',exact:true})).toBeVisible();
  await expect(profile.getByRole('button',{name:'Follow',exact:true})).toBeVisible();
  await expect(profile.getByRole('button',{name:'Following',exact:true})).toHaveCount(0);
  await page.reload();
  await expect(profile.getByRole('button',{name:'Follow',exact:true})).toBeVisible();
});
