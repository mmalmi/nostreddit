import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
import {finalizeEvent,generateSecretKey,getPublicKey,type Event} from 'nostr-tools/pure';
import {npubEncode,nsecEncode} from 'nostr-tools/nip19';
import {WebSocket} from 'ws';
import {postUrl} from '../src/lib/post-url';

const viewer=generateSecretKey(),friends=Array.from({length:11},()=>generateSecretKey()),gray=generateSecretKey(),gold=generateSecretKey();
const at=Math.floor(Date.now()/1000)-60;
const event=(secret:Uint8Array,kind:number,content:string,tags:string[][]=[])=>finalizeEvent({kind,content,tags,created_at:at},secret);
const grayPost=event(gray,1,'A neighbor’s field notes',[['subject','A neighbor’s field notes'],['t','badge-check']]);
const goldPost=event(gold,1,'A widely followed field guide',[['subject','A widely followed field guide'],['t','badge-check']]);
const friendPost=event(friends[0],1,'A friend’s observation',[['subject','A friend’s observation'],['t','badge-check']]);
const ownPost=event(viewer,1,'My observation',[['subject','My observation'],['t','badge-check']]);
const guestPost:Event=JSON.parse(readFileSync('public/starter-feed.json','utf8')).find((e:Event)=>e.id==='c6b253ccbfc699f0f458bb7336dcf99ca907b70e4ca4ec6d0e36902f4749c992');
test.beforeAll(async()=>{
  const records=[event(viewer,3,'',friends.map(key=>['p',getPublicKey(key)])),
    ...friends.map((key,i)=>event(key,3,'',[['p',getPublicKey(gold)],...(i===0?[['p',getPublicKey(gray)]]:[])])),
    event(gray,0,JSON.stringify({name:'Gray Finch'})),event(gold,0,JSON.stringify({name:'Golden Finch'})),
    grayPost,goldPost,friendPost,ownPost,guestPost];
  const socket=new WebSocket('ws://127.0.0.1:43164');
  try{await once(socket,'open');for(const record of records){const ack=once(socket,'message');socket.send(JSON.stringify(['EVENT',record]));expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',record.id,true]);}}finally{socket.close();}
});

test('shared badges distinguish self, follows and familiar neighbors; profile explains them and offline follow updates',async({page,context},info)=>{
  await context.addInitScript(session=>localStorage.setItem('nostreddit.account.v1',JSON.stringify(session)),{pubkey:getPublicKey(viewer),method:'local',nsec:nsecEncode(viewer)});
  await page.goto('/t/badge-check');
  const badge=(post:Event)=>page.locator('article').filter({has:page.getByRole('heading',{name:post.content,exact:true})}).getByTestId('social-distance-badge');
  await expect(badge(ownPost)).toHaveClass(/self/);
  await expect(badge(friendPost)).toHaveClass(/following/);
  await expect(badge(grayPost)).toHaveClass(/friend/);
  await expect(badge(goldPost)).toHaveClass(/trusted/);
  await expect(badge(goldPost)).toHaveAttribute('title','Followed by 11 people you follow');
  await page.screenshot({path:info.outputPath('feed-badges.png')});
  await page.goto('/u/'+npubEncode(getPublicKey(gold)));
  await expect(page.locator('h1').getByTestId('social-distance-badge')).toHaveClass(/trusted/);
  const explanation=page.locator('.social-context');
  await expect(explanation.locator('summary')).toContainText('Followed by 11 people you follow');
  await explanation.locator('summary').click();
  await expect(explanation).toContainText('not identity verification or an endorsement');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:info.outputPath('profile-explainer-mobile.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.addCookies([{name:'nostreddit_offline_fixture',value:'1',url:'http://127.0.0.1:43164'}]);
  await context.setOffline(true);
  await page.getByRole('button',{name:'Follow',exact:true}).click();
  await expect(page.locator('h1').getByTestId('social-distance-badge')).toHaveClass(/following/);
  await expect(explanation.locator('summary')).toHaveText('You follow this profile.');
  await page.getByRole('button',{name:'Following',exact:true}).click();
  await expect(page.locator('h1').getByTestId('social-distance-badge')).toHaveClass(/trusted/);
});

test('guest badges explain the public graph without claiming the reader follows someone',async({page})=>{
  await page.goto(postUrl(guestPost.id));
  const badge=page.locator('article.detail').getByTestId('social-distance-badge');
  await expect(badge).toHaveAttribute('title','Direct connection in the public graph');
  await page.goto('/u/'+npubEncode(guestPost.pubkey));
  await page.locator('.social-context summary').click();
  await expect(page.locator('.social-context')).toContainText('Discovery uses the public social graph until you follow people.');
  await expect(page.locator('.social-context summary')).not.toContainText('You follow');
});
