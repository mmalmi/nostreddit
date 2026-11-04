import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const at=Math.floor(Date.now()/1000), author=generateSecretKey();
const record=(key:Uint8Array,content:string,tags:string[][],kind=1,time=at)=>finalizeEvent({kind,content,tags,created_at:time},key);
const active=record(author,'A lively discussion from earlier today',[['subject','A lively discussion from earlier today'],['t','hot-lab'],['t','photography']],1,at-6*3600);
const quiet=Array.from({length:28},(_,i)=>record(generateSecretKey(),`Quiet field note ${i+1}`,
  [['subject',`Quiet field note ${i+1}`],['t','hot-lab'],...(i<2?[['t','photography']]:[])],1,at-600-i));
const texts=[
  ['A fast prime after sunset','A wide aperture and a steady hand make sharp portraits in dim light without a flash.'],
  ['Tuning the gears','Adjust cable tension to keep the bicycle chain from skipping when climbing hills.'],
  ['Morning pour-over','Freshly roasted beans, a burr grinder, a paper filter and hot water make a clean cup.'],
  ['Water for the garden','Mulch keeps the vegetable beds moist between showers.'],
  ['Weekend listening','A record of brass and drums recorded live in a small jazz club.'],
  ['A walk along the headland','The path runs from a sheltered bay to a rocky shore.'],
];
const aiPosts=texts.map(([title,body],i)=>record(generateSecretKey(),title+'\n\n'+body,[['subject',title],['t','hot-ai']],1,at-600+i));
async function publish(events:Event[]) {
  const socket=new WebSocket('ws://127.0.0.1:43164');
  try {
    await once(socket,'open');
    for(const event of events){const ack=once(socket,'message');socket.send(JSON.stringify(['EVENT',event]));expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',event.id,true]);}
  } finally {socket.close();}
}
test.beforeAll(async()=>{
  await publish([...quiet,active,...aiPosts,...Array.from({length:9},()=>record(generateSecretKey(),'+',[['e',active.id],['p',active.pubkey]],7,at-60))]);
});
test.beforeEach(async({context})=>{
  await allowFixtureAuthors(context);
  // These baseline discovery fixtures use deliberately unconnected keys.
  // Connection-strength behavior has its own signed graph fixture.
  await context.addInitScript(()=>{
    const prefs=JSON.parse(localStorage.getItem('nostreddit.ui.hot')||'{}');
    localStorage.setItem('nostreddit.ui.hot',JSON.stringify({...prefs,connectionStrength:false}));
  });
});

test('Hot finds activity below the viewport on the homepage and in a community, without loading AI',async({page,context},info)=>{
  const modelRequests:string[]=[];
  context.on('request',request=>{if(request.url().includes('/assets/search/'))modelRequests.push(request.url());});
  const started=performance.now();
  await page.goto('/r/hot-lab');
  await expect(page.locator('article h2').first()).toBeVisible();
  const firstContent=performance.now()-started;
  await expect(page.locator('article h2').first()).toHaveText(active.content);
  await page.getByRole('button',{name:'New',exact:true}).click();
  await expect(page.locator('article h2').first()).toHaveText(quiet[0].content);
  await page.getByRole('button',{name:'Hot',exact:true}).click();
  await expect(page.locator('article h2').first()).toHaveText(active.content);
  await page.goto('/');
  await expect(page.locator('article h2').first()).toHaveText(active.content);
  expect(modelRequests).toEqual([]);
  await page.screenshot({path:info.outputPath('hot-desktop.png')});
  console.log(JSON.stringify({hotFirstContentMs:Math.round(firstContent),defaultModelRequests:modelRequests.length}));
});

test('local AI improves a specific interest over social-only ranking and preserves all community posts',async({page,context},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/r/hot-ai');
  await expect(page.locator('article h2')).toHaveCount(texts.length);
  const social=await page.locator('article h2').allTextContents();
  await page.goto('/settings');
  await page.getByLabel('Your interests').fill('taking photographs in low light without a flash');
  await page.getByLabel('Personalize Hot with AI').check();
  const started=performance.now();
  await page.goto('/r/hot-ai');
  await expect(page.getByText('Personalized on this device',{exact:true})).toBeVisible({timeout:30_000});
  const elapsed=performance.now()-started;
  const ranked=await page.locator('article h2').allTextContents();
  expect(ranked[0]).toBe(texts[0][0]);expect(new Set(ranked)).toEqual(new Set(texts.map(([title])=>title)));
  expect(social[0]).not.toBe(texts[0][0]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('hot-ai-mobile.png')});
  const requests:string[]=[];page.on('request',request=>{if(request.url().endsWith('.onnx'))requests.push(request.url());});
  await page.reload();
  await expect(page.locator('article h2').first()).toHaveText(texts[0][0]);
  await expect(page.getByText('Personalized on this device',{exact:true})).toBeVisible();
  expect(requests).toEqual([]);
  await page.goto('/settings');await expect(page.getByLabel('Personalize Hot with AI')).toBeChecked();
  await expect(page.getByLabel('Your interests')).toHaveValue('taking photographs in low light without a flash');
  console.log(JSON.stringify({socialFirst:social[0],personalizedFirst:ranked[0],aiReadyMs:Math.round(elapsed),reloadModelRequests:requests.length}));
  for(const [query,title] of [['repairing a slipping bicycle chain',texts[1][0]],['coffee brewing',texts[2][0]]]) {
    await page.getByLabel('Your interests').fill(query);await page.getByRole('heading',{name:'Hot feed',exact:true}).click();
    await page.goto('/r/hot-ai');await expect(page.getByText('Personalized on this device',{exact:true})).toBeVisible({timeout:30_000});
    await expect(page.locator('article h2').first()).toHaveText(title);
    await page.goto('/settings');
  }
  await page.goto('/r/hot-ai');
  await expect(page.getByText('Personalized on this device',{exact:true})).toBeVisible();
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('nostreddit-feed-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try {return await new Promise<number>((resolve,reject)=>{const request=db.transaction('snapshots').objectStore('snapshots').get('ws://127.0.0.1:43164');
      request.onsuccess=()=>resolve((request.result||[]).filter((event:{tags:string[][]})=>event.tags.some(tag=>tag[0]==='t'&&tag[1]==='hot-ai')).length);request.onerror=()=>reject(request.error);});}
    finally{db.close();}
  })).toBe(texts.length);
  await context.addCookies([{name:'nostreddit_offline_fixture',value:'1',url:page.url()}]);
  await context.setOffline(true);await page.reload();
  await expect(page.getByText('Personalized on this device',{exact:true})).toBeVisible();
  await expect(page.locator('article h2').first()).toHaveText(texts[2][0]);
  await expect(page.locator('article h2')).toHaveCount(texts.length);
});

test('a failed AI download keeps the social feed usable',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:'block'});
  try {
    await allowFixtureAuthors(context);
    await context.addInitScript(()=>localStorage.setItem('nostreddit.ui.hot',JSON.stringify({ai:true,interests:'photography'})));
    await context.route('**/*.onnx',route=>route.abort());
    const page=await context.newPage();await page.goto('/r/hot-ai');
    await expect(page.locator('article')).toHaveCount(texts.length);
    await expect(page.getByText('AI unavailable · social ranking',{exact:true})).toBeVisible({timeout:20_000});
    await page.locator('article h2 a').first().click();await expect(page).toHaveURL(/\/post\/note1/);
  } finally {await context.close();}
});

test('a signed-in reader discovers a post liked by a follow while graph settings still control visibility',async({page,context})=>{
  const viewer=generateSecretKey(),friend=generateSecretKey(),stranger=generateSecretKey();
  const liked=record(stranger,'Discovered through a friend’s like',[['subject','Discovered through a friend’s like']]);
  await publish([record(viewer,'',[['p',getPublicKey(friend)]],3),liked,record(friend,'+',[['e',liked.id],['p',liked.pubkey]],7)]);
  await context.addInitScript(session=>localStorage.setItem('nostreddit.account.v1',JSON.stringify(session)),
    {method:'local',pubkey:getPublicKey(viewer),nsec:nsecEncode(viewer)});
  await page.goto('/');
  await expect(page.getByRole('link',{name:liked.content,exact:true})).toBeVisible({timeout:15_000});
  await page.goto('/settings');
  await page.getByLabel('Maximum follow distance').selectOption('1');
  await page.goto('/');
  await expect(page.getByRole('link',{name:liked.content,exact:true})).toHaveCount(0);
});

test('incoming activity does not shuffle the feed while reading; refresh applies the new order',async({page})=>{
  const rows=Array.from({length:16},(_,i)=>record(generateSecretKey(),'Reading order '+i,[['t','reading-order'],['subject','Reading order '+i]],1,at-3600-i));
  await publish(rows);
  await page.goto('/r/reading-order');
  await expect(page.locator('article h2').first()).toHaveText(rows[0].content);
  await page.evaluate(()=>window.scrollTo(0,850));
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(160);
  const newer=record(generateSecretKey(),'A newly arriving discussion',[['t','reading-order'],['subject','A newly arriving discussion']]);
  await publish([newer]);
  const refresh=page.getByRole('button',{name:'Show updated posts',exact:true});
  await expect(refresh).toBeAttached();
  await expect(page.locator('article h2').first()).toHaveText(rows[0].content);
  await refresh.click();
  await expect(page.locator('article h2').first()).toHaveText(newer.content);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
});

test('hiding the page terminates AI work and returning resumes a bounded batch',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:'block'});
  try {
    await allowFixtureAuthors(context);
    await context.addInitScript(()=>localStorage.setItem('nostreddit.ui.hot',JSON.stringify({ai:true,interests:'photography'})));
    await context.route('**/*.onnx',()=>{});
    const page=await context.newPage();await page.goto('/r/hot-ai');
    const workers=()=>page.workers().filter(worker=>worker.url().includes('/hot.worker-')).length;
    await expect.poll(workers).toBe(1);
    await page.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(workers).toBe(0);
    await context.unroute('**/*.onnx');
    await page.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByText('Personalized on this device',{exact:true})).toBeVisible({timeout:30_000});
    expect(workers()).toBe(1);
    await page.goto('/settings');await expect.poll(workers).toBe(0);
    await page.goto('/search?q=photography');
    await expect(page.getByText('Ranked on this device',{exact:true})).toBeVisible({timeout:30_000});
    expect(workers()).toBe(0);
    expect(page.workers().filter(worker=>worker.url().includes('/meaning.worker-')).length).toBe(1);
  } finally {await context.close();}
});
