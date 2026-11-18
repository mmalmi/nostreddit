import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {SocialGraph} from 'nostr-social-graph';
import {finalizeEvent, getPublicKey} from 'nostr-tools';
import {pathToFileURL} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
import {installGraphSnapshot, duplicateGraphIdentity} from './graph-snapshot-fixture.mjs';


const provenance = JSON.parse(await readFile(new URL('../public/socialGraphSnapshot.provenance.json', import.meta.url), 'utf8'));
const bundled = new Uint8Array(await readFile(new URL('../public/socialGraph.bin', import.meta.url)));
const root = provenance.root, marker = 'ea'.repeat(32), at = Math.floor(Date.now() / 1000);
const event = (targets) => ({pubkey:root, kind:3, id:marker, created_at:at, tags:targets.map(p=>['p',p]), content:'', sig:''});
const healthy = await SocialGraph.fromBinary(root, bundled);
healthy.handleEvent(event([...healthy.getFollowedByUser(root)]));
const healthyBytes = await healthy.toBinary();
healthy.addFollower(root, [...healthy.getFollowedByUser(root)][0]);
const partialBytes = await healthy.toBinary();
const small = new SocialGraph(root);
small.handleEvent(event(Array.from({length:999}, (_,i)=>(i+1).toString(16).padStart(64,'0'))));
const smallBytes = await small.toBinary();
assert.equal(small.size().users, 1000);
const malformed = healthyBytes.slice(); malformed[0] = 255;

// Complete personal lists beat overlapping newer public projections; newer
// personal revisions also beat complete public lists. Both kinds are covered.
const secret=new Uint8Array(32).fill(81), author=getPublicKey(secret);
const signed=(kind,time,targets)=>finalizeEvent({kind,created_at:time,tags:targets.map(p=>['p',p]),content:''},secret);
const concurrent=new SocialGraph(root);
concurrent.handleEvent(event([author,...Array.from({length:13000},(_,i)=>(i+1).toString(16).padStart(64,'0'))]),true);
concurrent.handleEvent(signed(3,at,[root]),true);
concurrent.markListIncomplete(author,3);
concurrent.handleEvent(signed(10000,at-2,[root]),true);
const concurrentBytes=await concurrent.toBinary();
const personalEvents=[signed(3,at-1,['ab'.repeat(32)]),signed(10000,at-1,['ac'.repeat(32)])];
const laterEvent=signed(3,at+1,['ad'.repeat(32)]);
async function sendEvents(page,events,version){
  await page.evaluate(({root,events,version})=>new Promise((resolve,reject)=>{
    const worker=window.graphFixtureWorker;
    const timer=setTimeout(()=>reject(new Error('Graph worker did not reply')),8000);
    const receive=({data})=>{if(data.version!==version)return;clearTimeout(timer);worker.removeEventListener('message',receive);data.error?reject(new Error('Graph worker failed')):resolve();};
    worker.addEventListener('message',receive);
    worker.postMessage({root,events,version,ranking:false,authors:[],edges:{follows:{},mutes:{}},profile:'',lists:[],directory:null});
  }),{root,events,version});
}

async function stored(page, bytes) {
  const result=await page.evaluate(bytes => new Promise((resolve, reject) => {
    const open = indexedDB.open('nostreddit-social-graph', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('snapshots', bytes === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('snapshots');
      const request = bytes === undefined ? store.get('current') : store.put(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)), 'current');
      tx.oncomplete = () => {
        db.close();
        if(bytes!==undefined){resolve();return;}
        // Transfer one compact string, not 1.4 million individually serialized
        // Playwright numbers. Every persisted byte is still checked below.
        const value=request.result??new Uint8Array(),chunks=[];
        for(let i=0;i<value.length;i+=32768)chunks.push(String.fromCharCode(...value.subarray(i,i+32768)));
        resolve(btoa(chunks.join('')));
      };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), bytes===undefined?undefined:Buffer.from(bytes).toString('base64'));
  return bytes===undefined?new Uint8Array(Buffer.from(result,'base64')):undefined;
}

export async function checkGraphCoverage(browser, base, output, contextOptions = {}, only) {
  const results=[];
  for (const [name, bytes, failure] of [
    ['valid-small', smallBytes], ['healthy', healthyBytes], ['healthy-partial', partialBytes], ['truncated', healthyBytes.slice(0,-1), 'malformed'],
    ['malformed-large', malformed, 'malformed'], ['duplicate-identity', duplicateGraphIdentity(healthyBytes), 'malformed'], ['bad-integrity', healthyBytes, 'integrity'],
    ['unavailable', healthyBytes, 'unavailable'], ['personal-cache', healthyBytes],
    ['personal-during-fetch', concurrentBytes],
  ]) {
    if (only && name !== only) continue;
    const context = await browser.newContext({...contextOptions, serviceWorkers:'block'}), errors = [];
    await context.route(/^https:\/\//, route=>route.abort());
    await context.routeWebSocket(/^wss:\/\//, socket=>socket.close());
    let release; const held=new Promise(resolve=>{release=resolve;});
    const reads = await installGraphSnapshot(context, root, bytes, name==='personal-during-fetch'?()=>held:undefined, failure);
    await context.addInitScript(()=>{
      const Original=window.Worker;window.graphFixtureWorkers=[];
      window.Worker=class extends Original {
        constructor(url,options){super(url,options);window.graphFixtureWorkers.push(this);if(String(url).includes('graph-worker'))window.graphFixtureWorker=this;}
      };
    });
    const page = await context.newPage(); page.on('pageerror', error=>errors.push(error.message));
    if (name === 'personal-cache') {
      const fixture = new URL('/__coverage_cache_fixture__', base).href;
      await context.route(fixture, route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Cache fixture</title>'}));
      await page.goto(fixture); await stored(page, Array.from(smallBytes));
    }
    const started = performance.now();
    await page.goto(base, {waitUntil:'domcontentloaded'});
    if (name !== 'personal-cache') await expect.poll(()=>reads.blocks,{timeout:15000}).toBeGreaterThan(0);
    if(name==='personal-during-fetch') {
      await sendEvents(page, personalEvents, -880);
      // The first message is handled while signed snapshot bytes remain held.
      release();
    }
    await expect.poll(async()=> (await stored(page)).length,{timeout:15000}).toBeGreaterThan(0);
    // The normal bootstrap has an eight-second deadline. Observe the persisted
    // graph after that deadline and the debounced save, including failure retries.
    await page.waitForTimeout(Math.max(0, 10_000 - (performance.now()-started)));
    const retained = await SocialGraph.fromBinary(root, new Uint8Array(await stored(page)));
    if (name === 'healthy' || name === 'healthy-partial') {
      assert.equal(retained.getListRevision(root,3)?.id, marker);
      assert.equal(retained.size().users, healthy.size().users);
      assert.equal(retained.getListRevision(root,3)?.complete, name !== 'healthy-partial');
    } else if (name === 'personal-during-fetch') {
      for(const event of personalEvents)assert.equal(retained.getListRevision(event.pubkey,event.kind)?.id,event.id);
      assert.equal(retained.getListRevision(root,3)?.id,marker);
      // A request after replacement must mutate the new authoritative graph.
      await sendEvents(page,[laterEvent],-881);
      await expect.poll(async()=>{
        const graph=await SocialGraph.fromBinary(root,new Uint8Array(await stored(page)));
        return graph.getListRevision(laterEvent.pubkey,laterEvent.kind)?.id;
      },{timeout:7000}).toBe(laterEvent.id);
    } else if (name === 'personal-cache') {
      assert.equal(retained.size().users, 1000);
      assert.equal(retained.getListRevision(root,3)?.id, marker);
      assert.equal(reads.names,0); assert.equal(reads.blocks,0);
    } else {
      assert.equal(retained.getListRevision(root,3)?.id, provenance.snapshot.rootFollow.id, name+' must preserve the bundled root list');
      assert.equal(retained.size().users, provenance.snapshot.users, name+' must preserve discovery coverage');
    }
    assert.equal(reads.legacy,0); assert.deepEqual(errors,[]);
    results.push({name, passed:true, users:retained.size().users, reads, elapsedMs:performance.now()-started});
    console.log(`PASS: ${name} (${Math.round(performance.now()-started)} ms)`);
    await page.evaluate(()=>window.graphFixtureWorkers.forEach(worker=>worker.terminate()));
    await context.unrouteAll({behavior:'ignoreErrors'});
    await context.close();
  }
  await writeFile(output,JSON.stringify({passed:true, embeddedUsers:provenance.snapshot.users, results},null,2)+'\n');
  console.log('PASS: signed discovery coverage, malformed/integrity/offline fallback, and personal cache preservation');
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const [base,output,only]=process.argv.slice(2);
  if(!base||!output)throw new Error('Usage: node scripts/check-graph-coverage.mjs URL RECEIPT [CASE]');
  const browser=await chromium.launch();
  try{await checkGraphCoverage(browser,base,output,{},only);}finally{await browser.close();}
}
