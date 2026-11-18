import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SocialGraph} from 'nostr-social-graph';
import {assertDiscoveryGraphCoverage} from '../src/lib/graph-snapshot-policy.js';
// @ts-expect-error Node-only maintainer script, exercised through its normal exported entry.
import {verifyEmbeddedGraph} from '../scripts/graph-input.mjs';
// @ts-expect-error Node-only maintainer script; injected transport keeps these tests offline.
import {refreshSocialGraph} from '../scripts/refresh-social-graph.mjs';
// @ts-expect-error Shared binary corruption fixture.
import {duplicateGraphIdentity} from '../scripts/graph-snapshot-fixture.mjs';

const provenance=JSON.parse(await readFile(new URL('../public/socialGraphSnapshot.provenance.json',import.meta.url),'utf8'));
const bundled=new Uint8Array(await readFile(new URL('../public/socialGraph.bin',import.meta.url)));
const size={users:provenance.snapshot.users,follows:provenance.snapshot.follows,mutes:provenance.snapshot.mutes};

test('default discovery has an absolute and relative coverage floor and mobile bounds',()=>{
  assert.doesNotThrow(()=>assertDiscoveryGraphCoverage(size,25805));
  assert.doesNotThrow(()=>assertDiscoveryGraphCoverage({...size,users:12903},25805));
  for(const users of [1000,9999,12902,30001,NaN,Infinity,-1,1.5])
    assert.throws(()=>assertDiscoveryGraphCoverage({...size,users},25805));
  assert.throws(()=>assertDiscoveryGraphCoverage({...size,users:9999},1));
  assert.throws(()=>assertDiscoveryGraphCoverage({...size,follows:180001},25805));
});

async function fixture(fn:(directory:string)=>Promise<void>){
  const directory=await mkdtemp(path.join(tmpdir(),'nostreddit-coverage-'));
  try {
    await mkdir(path.join(directory,'public'));
    await writeFile(path.join(directory,'public/socialGraph.bin'),bundled);
    await writeFile(path.join(directory,'public/socialGraphSnapshot.provenance.json'),JSON.stringify(provenance));
    await fn(directory);
  } finally { await rm(directory,{recursive:true,force:true}); }
}
const small=new SocialGraph(provenance.root);
small.handleEvent({pubkey:provenance.root,kind:3,created_at:2,id:'ad'.repeat(32),content:'',sig:'',tags:[['p','ae'.repeat(32)]]});
small.handleEvent({pubkey:provenance.root,kind:10000,created_at:2,id:'af'.repeat(32),content:'',sig:'',tags:[]});
const smallBytes=await small.toBinary();
const malformed=bundled.slice();malformed[0]=255;
const duplicate=duplicateGraphIdentity(bundled);
const oversized=new Uint8Array(4*1024*1024+1);oversized.set(bundled);
const metadata=(bytes:Uint8Array)=>({size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});

test('offline build rejects undersized and malformed bundles even with matching provenance digests',async()=>{
  for(const bytes of [smallBytes,bundled.slice(0,-1),malformed,oversized,duplicate])await fixture(async directory=>{
    await writeFile(path.join(directory,'public/socialGraph.bin'),bytes);
    await writeFile(path.join(directory,'public/socialGraphSnapshot.provenance.json'),JSON.stringify({
      ...provenance,snapshot:{...provenance.snapshot,...(bytes===duplicate?(await SocialGraph.fromBinary(provenance.root,duplicate)).size():{}),...metadata(bytes),bytes:bytes.length},
    }));
    await assert.rejects(verifyEmbeddedGraph(directory));
  });
  await fixture(async directory=>{assert.equal((await verifyEmbeddedGraph(directory)).graph.size().users,25805);});
});

test('refresh validates before writing and leaves the proven pair intact on failed input',async()=>{
  for(const input of ['unavailable',smallBytes,bundled.slice(0,-1),malformed,duplicate])await fixture(async directory=>{
    const before=await readFile(path.join(directory,'public/socialGraphSnapshot.provenance.json'));
    const openSnapshot=async()=>{
      if(input==='unavailable')throw new Error('offline');
      const bytes=input as Uint8Array;
      return {eventId:'ab'.repeat(32),directoryHash:'ac'.repeat(32),manifest:{root:provenance.root,
        generated_at:provenance.source.generatedAt+1,graph_completed_at:provenance.source.graphCompletedAt+1,
        files:{'mobile.bin':metadata(bytes)},mobile_roots:{}},readFile:async()=>bytes};
    };
    await assert.rejects(refreshSocialGraph({directory,openSnapshot}));
    assert.deepEqual(await readFile(path.join(directory,'public/socialGraph.bin')),Buffer.from(bundled));
    assert.deepEqual(await readFile(path.join(directory,'public/socialGraphSnapshot.provenance.json')),before);
  });
});

test('a healthy refresh writes a pair accepted by the offline build',async()=>{
  await fixture(async directory=>{
    const result=await refreshSocialGraph({directory,openSnapshot:async()=>({
      eventId:'ab'.repeat(32),directoryHash:'ac'.repeat(32),manifest:{root:provenance.root,
        generated_at:provenance.source.generatedAt+1,graph_completed_at:provenance.source.graphCompletedAt+1,
        files:{'mobile.bin':metadata(bundled)},mobile_roots:{}},readFile:async()=>bundled,
    })});
    assert.equal(result.source.graphCompletedAt,provenance.source.graphCompletedAt+1);
    assert.equal((await verifyEmbeddedGraph(directory)).graph.size().users,25805);
  });
});
