import assert from 'node:assert/strict';
import test from 'node:test';
import { HashTree, LinkType, MemoryStore, nhashEncode, toHex, fromHex } from '@hashtree/core';
import { npubEncode } from 'nostr-tools/nip19';
import { findTreeEmbeds, hasTreeCapability, parseTreeAttachment } from '../src/lib/tree-embeds';
import { loadTreeAttachment } from '../src/lib/tree-reader';

const nhash = nhashEncode({hash:new Uint8Array(32).fill(1),key:new Uint8Array(32).fill(2)});

test('recognizes Iris file links, Directory links and Drive fragments; preserves encoded filenames and de-duplicates aliases', () => {
  const path = '/garden/Quiet%20night%20(1).mp4';
  for (const form of [nhash + path, 'htree://'+nhash+path, 'hashtree://'+nhash+path, 'nhash://'+nhash+path,
    'hashtree:'+nhash+path, 'https://drive.iris.to/#/'+nhash+path]) {
    const [item] = findTreeEmbeds('See (' + form + ').');
    assert.equal(item.name,'Quiet night (1).mp4'); assert.equal(item.kind,'video');
    assert.deepEqual(item.path,['garden','Quiet night (1).mp4']);
    assert.equal(new URL(item.viewerUrl).pathname,'/'); assert.equal(new URL(item.viewerUrl).search,'');
    assert.equal(new URL(item.viewerUrl).hash,'#/'+nhash+path);
  }
  assert.equal(findTreeEmbeds(nhash+path+' '+ 'htree://'+nhash+path).length,1);
  assert.equal(parseTreeAttachment(nhash)!.kind,'tree');
  const owner = npubEncode('01'.repeat(32));
  assert.equal(parseTreeAttachment('https://drive.iris.to/#/'+owner+'/photos')!.mutable,true);
  assert.equal(parseTreeAttachment('htree://'+owner+'/photos')!.viewerUrl,'https://drive.iris.to/#/'+owner+'/photos');
});

test('rejects malformed hashes, unsafe paths and third-party or credential-bearing viewer URLs', () => {
  for (const bad of ['htree://nhash1fake/x.png',nhash+'/e%2Fvil', nhash+'/%2e%2e',nhash+'/%00',nhash+'/bad%zz',
    'https://outside.example/'+nhash+'/x.gif', 'https://outside.example/?secret='+nhash+'/x.png',
    'https://bad@drive.iris.to/#/'+nhash+'/x.jpg', 'http://drive.iris.to/#/'+nhash+'/x.jpg']) {
    assert.deepEqual(findTreeEmbeds(bad),[],bad);
  }
  assert.equal(parseTreeAttachment(nhash+'/image.svg')!.kind,'file');
  assert.equal(parseTreeAttachment(nhash+'/payload.html')!.mime,'application/octet-stream');
});

async function encryptedFixture() {
  const store = new MemoryStore(), source = new HashTree({store,chunkSize:4});
  const bytes = new TextEncoder().encode('Signed content is independently verifiable.');
  const file = await source.putFile(bytes);
  const folder = await source.putDirectory([{name:'photo.webp',cid:file.cid,size:file.size,type:LinkType.File}]);
  const root = await source.putDirectory([{name:'garden',cid:folder.cid,size:folder.size,type:LinkType.Dir}]);
  const urls: string[] = [];
  const fetchBlock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.deepEqual([init?.credentials,init?.referrerPolicy],['omit','no-referrer']);
    assert.match(url.pathname,/^\/[a-f0-9]{64}\.bin$/); assert.equal(url.search,''); assert.equal(url.hash,'');
    assert.ok(['cdn.iris.to','upload.iris.to'].includes(url.hostname));
    urls.push(url.href);
    const stored = await store.get(fromHex(url.pathname.slice(1,65)));
    return stored ? new Response(new Uint8Array(stored)) : new Response(null,{status:404});
  };
  return {bytes,file,root,urls,fetchBlock};
}

test('encrypted named file CIDs and nested directory paths load matching plaintext via hash-only requests', async () => {
  const {bytes,file,root,urls,fetchBlock} = await encryptedFixture();
  const signal = new AbortController().signal;
  for (const link of ['htree://'+nhashEncode(file.cid)+'/original.webp', nhashEncode(root.cid)+'/garden/photo.webp']) {
    const content = await loadTreeAttachment(parseTreeAttachment(link)!, signal, fetchBlock);
    assert.equal(content.type,'file'); if (content.type !== 'file') return;
    assert.deepEqual(new Uint8Array(await content.blob.arrayBuffer()),bytes);
    assert.equal(content.blob.type,'image/webp');
  }
  const directory = await loadTreeAttachment(parseTreeAttachment(nhashEncode(root.cid))!,signal,fetchBlock);
  assert.equal(directory.type,'directory');
  if (directory.type === 'directory') {
    assert.deepEqual(directory.entries.map(e=>[e.name,e.directory]),[['garden',true]]);
    assert.equal(new URL(directory.entries[0].href).pathname,'/');
    assert.match(new URL(directory.entries[0].href).hash,/^#\/nhash1/);
  }
  assert.ok(urls.length>2); assert.ok(!urls.join('\n').includes(toHex(file.cid.key!)));
  await assert.rejects(loadTreeAttachment(parseTreeAttachment(nhashEncode(root.cid)+'/missing.mp3')!,signal,fetchBlock), /does not exist/);
});

test('tampered data, oversized responses, cancelled requests, and missing paths are not rendered', async () => {
  const {file} = await encryptedFixture();
  const item = parseTreeAttachment(nhashEncode(file.cid)+'/music.mp3')!;
  const signal = new AbortController().signal;
  await assert.rejects(loadTreeAttachment(item, signal, async () => new Response('modified')), /verified copy/);
  await assert.rejects(loadTreeAttachment(item, signal, async () => new Response('size', {headers:{'Content-Length':String(999_999_999)}})), /too large/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadTreeAttachment(item, controller.signal, async () => {throw new Error('unexpected fetch');}), /abort/i);
});

test('capability protection applies to proxied and percent-encoded HTTP media URLs', () => {
  assert.ok(hasTreeCapability('https://example.org/proxy?src='+nhash+'/media.png'));
  assert.ok(hasTreeCapability('https://example.org/proxy?src='+nhash.replace('nhash','%256e%2568%2561%2573%2568')+'/media.png'));
  assert.equal(hasTreeCapability('https://example.org/plain%20photo.png'),false);
});

test('a new reader re-verifies durable ciphertext, works offline, and repairs corrupted blocks', async () => {
  const {file,bytes,fetchBlock} = await encryptedFixture();
  const item = parseTreeAttachment(nhashEncode(file.cid)+'/archive.webp')!;
  const blocks = new Map<string,Uint8Array>();
  const cache = {
    async read(hash:string) {return blocks.get(hash) || null;},
    async save(hash:string, value:Uint8Array) {blocks.set(hash,new Uint8Array(value));},
    async remove(hash:string) {blocks.delete(hash);},
  };
  const signal = new AbortController().signal;
  await loadTreeAttachment(item,signal,fetchBlock,cache);
  assert.ok(blocks.size>1);
  const rootKey = toHex(file.cid.hash);
  assert.ok(blocks.has(rootKey));
  assert.ok([...blocks.keys()].every(id => /^[a-f0-9]{64}$/.test(id)));
  assert.ok(![...blocks.keys()].includes(toHex(file.cid.key!)));
  let network = 0;
  const offline = await loadTreeAttachment(item,signal,async () => {network++;throw Error('offline');},cache);
  assert.equal(network,0);
  assert.equal(offline.type,'file');
  if (offline.type==='file') assert.deepEqual(new Uint8Array(await offline.blob.arrayBuffer()),bytes);
  blocks.set(rootKey,new Uint8Array([0,1,2]));
  await assert.rejects(loadTreeAttachment(item,signal,async () => {throw Error('offline');},cache),/verified copy/);
  assert.equal(blocks.has(rootKey),false);
  const restored = await loadTreeAttachment(item,signal,fetchBlock,cache);
  assert.equal(restored.type,'file');
  assert.ok(blocks.has(rootKey));
});

test('cache capacity evicts the least recently used entries before either bound is exceeded', async () => {
  const {evictions, cacheByteLimit, cacheBlockLimit} = await import('../src/lib/tree-block-cache');
  const entry = (hash:string,size:number,used:number) => ({hash,size,used});
  assert.deepEqual(evictions([entry('a',5,1),entry('b',8,2)],entry('c',cacheByteLimit-8,3)),['a']);
  assert.deepEqual(evictions([entry('a',2,1),entry('b',8,2)],entry('a',cacheByteLimit-8,3)),[]);
  const dense = Array.from({length:cacheBlockLimit},(_,i)=>entry(String(i),1,i));
  assert.deepEqual(evictions(dense,entry('next',1,Infinity)),['0']);
});
