import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {createNamedGraphFixture} from 'nostr-social-graph/testing/namedGraph';
import {DEFAULT_GRAPH_SNAPSHOT} from 'nostr-social-graph/hashtreeSnapshot';
import {HashTree, MemoryStore, LinkType, sha256, toHex, fromHex} from '@hashtree/core';
import {generateSecretKey, getPublicKey, finalizeEvent, nip19} from 'nostr-tools';

export const blockRoute = /^https:\/\/cdn\.iris\.to\/[a-f0-9]{64}\.bin$/;

// The SDK fixture parses its input, so negative parser tests need a valid signed
// tree containing deliberately invalid graph bytes. Integrity remains correct.
async function malformedSnapshot(root, bytes) {
  const key=generateSecretKey(), pubkey=getPublicKey(key), store=new MemoryStore();
  const tree=new HashTree({store,encryptionMode:'legacy-chk'}), encode=value=>new TextEncoder().encode(value);
  const files={'social-graph.bin':bytes,'social-graph-v4.bin':bytes,'mobile.bin':bytes,
    'profile-data.json':encode('[]'),'profile-index.json':encode('{"keys":[],"records":[]}'),'allowlist.txt':encode(root+'\n')};
  const metadata=async body=>({size:body.length,sha256:toHex(await sha256(body))});
  const alternate='mobile-'+root+'.bin', now=Math.floor(Date.now()/1000);
  const manifest={version:1,root:pubkey,graph_completed_at:now,graph_since:now-300,generated_at:now,
    files:Object.fromEntries(await Promise.all(Object.entries(files).map(async([name,body])=>[name,await metadata(body)]))),
    mobile_roots:{[root]:{file:alternate,...await metadata(bytes)}}};
  const entries=await Promise.all(Object.entries({...files,[alternate]:bytes,'manifest.json':encode(JSON.stringify(manifest))})
    .map(async([name,body])=>({...await tree.putFile(body),name,type:LinkType.File})));
  const {cid}=await tree.putDirectory(entries);
  return {publisher:nip19.npubEncode(pubkey),event:finalizeEvent({kind:30064,created_at:now,
    tags:[['d','social-graph'],['l','hashtree'],['hash',toHex(cid.hash)],['key',toHex(cid.key)]],content:''},key),
    readBlock:hash=>store.get(fromHex(hash))};
}

// A loopback relay is visible to dedicated workers as well as page scripts.
// Only the test response for the built graph worker trusts this fixture signer.
export async function installGraphSnapshot(context, root, bytes, beforeBlock, failure) {
  const fixture = failure === 'malformed' ? await malformedSnapshot(root, bytes) : await createNamedGraphFixture(root, bytes);
  const relay = new WebSocketServer({host: '127.0.0.1', port: 0});
  await once(relay, 'listening');
  const relayUrl = 'ws://127.0.0.1:' + relay.address().port;
  const reads = {names: 0, blocks: 0, legacy: 0};
  relay.on('connection', socket => socket.on('message', raw => {
    const [type, subscription, ...filters] = JSON.parse(String(raw));
    if (type !== 'REQ') return;
    if (filters.some(filter => filter.kinds?.includes(30064) &&
        filter.authors?.includes(fixture.event.pubkey) && filter['#d']?.includes('social-graph'))) {
      reads.names++;
      socket.send(JSON.stringify(['EVENT', subscription, fixture.event]));
    }
    socket.send(JSON.stringify(['EOSE', subscription]));
  }));
  context.once('close', () => {
    for (const client of relay.clients) client.terminate();
    relay.close();
  });
  await context.route(/\/assets\/[^/]+\.js$/, async route => {
    const response = await route.fetch();
    const original = await response.text();
    if (!original.includes(DEFAULT_GRAPH_SNAPSHOT.publisher)) return route.fulfill({response});
    const bundle = original.replaceAll(DEFAULT_GRAPH_SNAPSHOT.publisher, fixture.publisher);
    // Leave configured relays intact for policy checks, but isolate worker
    // sockets too: Playwright's page WebSocket routes do not cover every worker.
    const transport = `globalThis.WebSocket = class extends globalThis.WebSocket {
      constructor(url, protocols) {
        super(String(url).startsWith('wss://')
          ? ${JSON.stringify(relayUrl)} : url, protocols);
      }
    };
`;
    return route.fulfill({response, body: transport + bundle});
  });
  await context.route('https://graph-api.iris.to/**', route => { reads.legacy++; return route.abort(); });
  await context.route(blockRoute, async route => {
    const data = await fixture.readBlock(new URL(route.request().url()).pathname.slice(1, -4));
    if (!data) return route.abort();
    reads.blocks++;
    if (beforeBlock) await beforeBlock();
    if (failure === 'unavailable') return route.abort();
    const body = Buffer.from(data);
    if (failure === 'integrity') body[0] ^= 1;
    await route.fulfill({contentType: 'application/octet-stream', body,
      headers: {'access-control-allow-origin': '*'}}).catch(error => {
      if (!route.request().failure() && !context.pages().every(page => page.isClosed())) throw error;
    });
  });
  return reads;
}

// Keep a valid-looking v4 payload large while duplicating one identity row.
// The legacy personal-cache parser canonicalizes it; public snapshots must reject it.
export function duplicateGraphIdentity(bytes) {
  const result=bytes.slice(); let offset=0;
  const variable=()=>{let value=0,shift=0,byte;do{byte=result[offset++];value+=(byte&127)*2**shift;shift+=7;}while(byte&128);return value;};
  if(variable()!==4 || variable()<2)throw new Error('Expected a large v4 fixture');
  variable();if(variable()!==0)throw new Error('Expected a public-key identity');
  const first=result.slice(offset,offset+32);offset+=32;
  variable();if(variable()!==0)throw new Error('Expected a public-key identity');
  result.set(first,offset);return result;
}
