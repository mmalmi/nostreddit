import {once} from 'node:events';
import {test,expect} from '@playwright/test';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools/pure';
import {nsecEncode} from 'nostr-tools/nip19';
import {WebSocket} from 'ws';
const viewer=generateSecretKey(),bridges=Array.from({length:3},()=>generateSecretKey()),
  bots=Array.from({length:40},()=>generateSecretKey()),readers=[generateSecretKey(),generateSecretKey()],
  authors=[generateSecretKey(),generateSecretKey()],now=Math.floor(Date.now()/1000)-60;
const event=(key:Uint8Array,kind:number,content:string,tags:string[][]=[])=>finalizeEvent({kind,created_at:now,content,tags},key);
const posts=['Repeated promotion','Independent recommendations'].map((title,i)=>event(authors[i],1,title,[['t','connection-check'],['subject',title]]));
test.beforeAll(async()=>{
  const records=[event(viewer,3,'',bridges.map(k=>['p',getPublicKey(k)])),
    event(bridges[0],3,'',[...bots,...authors].map(k=>['p',getPublicKey(k)])),
    ...readers.map((r,i)=>event(bridges[i+1],3,'',[['p',getPublicKey(r)]])),...posts,
    ...bots.map(k=>event(k,7,'+',[['e',posts[0].id],['p',posts[0].pubkey]])),
    ...readers.map(k=>event(k,7,'+',[['e',posts[1].id],['p',posts[1].pubkey]]))];
  const socket=new WebSocket('ws://127.0.0.1:43164');
  try{await once(socket,'open');for(const record of records){const ack=once(socket,'message');socket.send(JSON.stringify(['EVENT',record]));expect(JSON.parse(String((await ack)[0])).slice(0,3)).toEqual(['OK',record.id,true]);}}finally{socket.close();}
});
test('independent connections outweigh many keys behind one follow; switching modes and offline reload work',async({page,context},info)=>{
  await context.addInitScript(session=>localStorage.setItem('nostreddit.account.v1',JSON.stringify(session)),{pubkey:getPublicKey(viewer),method:'local',nsec:nsecEncode(viewer)});
  await page.goto('/t/connection-check');
  const flood=page.locator('[data-route-active=\"true\"] article').filter({has:page.getByRole('heading',{name:'Repeated promotion',exact:true})});
  await expect(flood.getByRole('button',{name:'Like',exact:true})).toHaveText('40');
  const independent=page.locator('[data-route-active=\"true\"] article').filter({has:page.getByRole('heading',{name:'Independent recommendations',exact:true})});
  await expect(independent.getByRole('button',{name:'Like',exact:true})).toHaveText('2');
  const expectRankedFirst=async(title:string)=>{
    const first=page.locator('[data-route-active=\"true\"] article h2').first();
    await expect(first).toBeVisible();
    // Graph and reaction updates preserve painted rows until the reader applies them.
    if(await first.textContent()!==title)await page.getByRole('button',{name:'Show updated posts',exact:true}).click();
    await expect(first).toHaveText(title);
  };
  await expectRankedFirst('Independent recommendations');
  await page.screenshot({path:info.outputPath('connection-strength.png')});
  await page.goto('/settings/feeds');await page.getByLabel('Weight reactions by connection strength').uncheck();
  await page.goto('/t/connection-check');await expectRankedFirst('Repeated promotion');
  await page.goto('/settings/feeds');await page.getByLabel('Weight reactions by connection strength').check();
  await page.goto('/t/connection-check');await expectRankedFirst('Independent recommendations');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  // The bounded feed snapshot is written in a batch; wait for its durable
  // records before testing a fresh offline page (not merely the DOM cache).
  await expect.poll(()=>page.evaluate(ids=>new Promise<boolean>(resolve=>{
    const open=indexedDB.open('nostreddit-feed-v1');
    open.onsuccess=()=>{const db=open.result,read=db.transaction('snapshots').objectStore('snapshots').get('ws://127.0.0.1:43164');
      read.onsuccess=()=>{resolve(ids.every(id=>read.result?.some((event:{id:string})=>event.id===id)));db.close();};
      read.onerror=()=>{resolve(false);db.close();};};open.onerror=()=>resolve(false);
  }),posts.map(post=>post.id)),{timeout:10000}).toBe(true);
  await context.addCookies([{name:'nostreddit_offline_fixture',value:'1',url:'http://127.0.0.1:43164'}]);await context.setOffline(true);
  await page.reload();
  await expectRankedFirst('Independent recommendations');
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/rank|pagerank/i.test(k)))).toEqual([]);
});
test('ordinary settings and distance mode do not import the optional ranking module',async({browser,baseURL})=>{
  // Exclude service-worker shell precaching: this checks the application import.
  const context=await browser.newContext({baseURL,serviceWorkers:'block'});
  try {
  const page=await context.newPage();
  const requests:string[]=[];context.on('request',r=>requests.push(r.url()));
  await page.goto('/settings/feeds');await page.getByLabel('Weight reactions by connection strength').uncheck();
  await page.goto('/t/connection-check');await expect(page.getByRole('button',{name:'Refresh Hot',exact:true})).toBeVisible();
  expect(requests.filter(url=>/\/ranking-[^/]+\.js/.test(url))).toEqual([]);
  }finally{await context.close();}
});
