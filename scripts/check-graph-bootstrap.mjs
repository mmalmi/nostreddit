import {chromium, expect} from '@playwright/test';
import {SocialGraph} from 'nostr-social-graph';
import {readFile, writeFile} from 'node:fs/promises';

const base=process.argv[2], output=process.argv[3];
if(!base||!output)throw new Error('Usage: node scripts/check-graph-bootstrap.mjs URL RECEIPT');
const {root}=JSON.parse(await readFile(new URL('../public/socialGraphSnapshot.provenance.json',import.meta.url),'utf8'));
const author='ab'.repeat(32), target='ac'.repeat(32), followId='ca'.repeat(32), muteId='cb'.repeat(32), localId='cc'.repeat(32);
const at=Math.floor(Date.now()/1000);
const event=(pubkey,kind,id,time,targets)=>({pubkey,kind,id,created_at:time,tags:targets.map(p=>['p',p]),content:'',sig:''});
const seed=new SocialGraph(root);
seed.handleEvent(event(root,3,'cd'.repeat(32),at,[author]));
seed.handleEvent(event(author,3,followId,at,[target]));
seed.handleEvent(event(author,10000,muteId,at,[root]));
const body=Buffer.from(await seed.toBinary());
const browser=await chromium.launch();
let requests=0;
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.routeWebSocket(/^wss:\/\//,socket=>socket.close());
 await context.route('https://graph-api.iris.to/**',async route=>{
  requests++;
  await route.fulfill({status:200,headers:{'content-type':'application/octet-stream','x-graph-root':root,'access-control-allow-origin':'*','access-control-expose-headers':'x-graph-root'},body});
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const read=()=>page.evaluate(async()=>{
  if(!(await indexedDB.databases()).some(db=>db.name==='nostreddit-social-graph'))return null;
  return new Promise((resolve,reject)=>{
  const open=indexedDB.open('nostreddit-social-graph',1);
  open.onsuccess=()=>{
   const db=open.result;
   if(!db.objectStoreNames.contains('snapshots')){db.close();resolve(null);return;}
   const request=db.transaction('snapshots').objectStore('snapshots').get('current');
   request.onsuccess=()=>{db.close();resolve(request.result?Array.from(request.result):null);};
   request.onerror=()=>{db.close();reject(request.error);};
  };open.onerror=()=>reject(open.error);
  });
 });
 await page.goto(base,{waitUntil:'domcontentloaded'});
 let retained;
 await expect.poll(async()=>{
  const bytes=await read();if(!bytes)return false;
  retained=await SocialGraph.fromBinary(root,new Uint8Array(bytes));
  return retained.getListRevision(author,3)?.id===followId&&retained.getListRevision(author,10000)?.id===muteId;
 },{timeout:15000,intervals:[500,1000]}).toBe(true);
 expect(requests).toBe(1);
 expect([...retained.getFollowedByUser(author)]).toEqual([target]);
 expect([...retained.getMutedByUser(author)]).toEqual([root]);
 retained.handleEvent(event(author,3,localId,at+1,[root]));
 const local=Array.from(await retained.toBinary());
 await page.evaluate(bytes=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('nostreddit-social-graph',1);
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(new Uint8Array(bytes),'current');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};
  open.onerror=()=>reject(open.error);
 }),local);
 await context.unroute('https://graph-api.iris.to/**');
 await context.route('https://graph-api.iris.to/**',async route=>{requests++;await route.abort();});
 await page.reload({waitUntil:'domcontentloaded'});
 await expect.poll(async()=>{
  const bytes=await read();if(!bytes)return false;
  const graph=await SocialGraph.fromBinary(root,new Uint8Array(bytes));
  return graph.getListRevision(author,3)?.id===localId&&graph.getListRevision(author,10000)?.id===muteId;
 }).toBe(true);
 // Let initialization and its delayed save finish; the retained graph must skip HTTP bootstrap.
 await page.waitForTimeout(2000);
 const saved=await SocialGraph.fromBinary(root,new Uint8Array(await read()));
 expect(saved.getListRevision(author,3)?.id).toBe(localId);
 expect(saved.getListRevision(author,10000)?.id).toBe(muteId);
 expect([...saved.getFollowedByUser(author)]).toEqual([root]);
 expect(requests).toBe(1);expect(errors).toEqual([]);
 await writeFile(output,JSON.stringify({passed:true,bootstrapRequests:requests,followRevisionRetained:true,muteRevisionRetained:true,newerLocalListPreserved:true,retainedReloadSkipsBootstrap:true,errors},null,2)+'\n');
 console.log('PASS: actual worker bootstrap, both revision IDs persisted, newer local list retained on reload without another snapshot request');
 await context.close();
}finally{await browser.close();}
