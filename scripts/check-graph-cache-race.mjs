import {chromium,expect} from '@playwright/test';
import {SocialGraph} from 'nostr-social-graph';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const [base,output]=process.argv.slice(2);
if(!base||!output)throw new Error('Usage: node scripts/check-graph-cache-race.mjs URL RECEIPT');
const {root}=JSON.parse(await readFile(new URL('../public/socialGraphSnapshot.provenance.json',import.meta.url),'utf8'));
const graph=new SocialGraph(root),at=Math.floor(Date.now()/1000),target='da'.repeat(32);
graph.handleEvent({pubkey:root,kind:3,id:'db'.repeat(32),created_at:at,tags:[['p',target]],content:'',sig:''});
const server=Buffer.from(await graph.toBinary());
graph.handleEvent({pubkey:root,kind:3,id:'dc'.repeat(32),created_at:at+1,tags:[],content:'',sig:''});
graph.handleEvent({pubkey:root,kind:10000,id:'dd'.repeat(32),created_at:at+1,tags:[['p',target]],content:'',sig:''});
const personal=Array.from(await graph.toBinary());
const browser=await chromium.launch(),errors=[];
const digest=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
async function stored(page,bytes){
 return page.evaluate(bytes=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('nostreddit-social-graph',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('snapshots');
  open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{
   const db=open.result,tx=db.transaction('snapshots',bytes===undefined?'readonly':'readwrite'),store=tx.objectStore('snapshots');
   const request=bytes===undefined?store.get('current'):store.put(new Uint8Array(bytes),'current');
   tx.oncomplete=()=>{db.close();resolve(bytes===undefined?Array.from(request.result??[]):undefined);};
   tx.onerror=()=>{db.close();reject(tx.error);};
  };
 }),bytes);
}
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.routeWebSocket(/^wss:\/\//,socket=>socket.close());
 let requested=false,release;
 const ready=new Promise(resolve=>{release=resolve;});
 await context.route('https://graph-api.iris.to/**',async route=>{
  requested=true;await ready;
  await route.fulfill({status:200,headers:{'content-type':'application/octet-stream','x-graph-root':root,'access-control-allow-origin':'*','access-control-expose-headers':'x-graph-root'},body:server});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await expect.poll(()=>requested,{timeout:10000}).toBe(true);
 // Model a second tab's committed crawl while the first tab awaits the server.
 await stored(page,personal);
 release();
 await page.waitForTimeout(3000);
 expect(digest(await stored(page))).toBe(digest(personal));
 await context.close();

 const damaged=await browser.newContext({serviceWorkers:'block'});
 await damaged.routeWebSocket(/^wss:\/\//,socket=>socket.close());
 let bootstrapRequests=0;
 await damaged.route('https://graph-api.iris.to/**',route=>{bootstrapRequests++;return route.abort();});
 const fixture=new URL('/__graph_cache_fixture__',base).href;
 await damaged.route(fixture,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Graph cache fixture</title>'}));
 const second=await damaged.newPage();second.on('pageerror',error=>errors.push(error.message));
 await second.goto(fixture);await stored(second,[0,1,2]);
 await second.goto(base,{waitUntil:'domcontentloaded'});
 await second.waitForTimeout(3000);
 expect(await stored(second)).toEqual([0,1,2]);expect(bootstrapRequests).toBe(0);
 await damaged.close();expect(errors).toEqual([]);
 await writeFile(output,JSON.stringify({passed:true,concurrentPersonalGraphPreserved:true,unreadableCachePreserved:true,unreadableCacheBootstrapRequests:bootstrapRequests,errors},null,2)+'\n');
 console.log('PASS: delayed server bootstrap preserves another tab’s graph; unreadable personal cache remains recoverable');
}finally{await browser.close();}
