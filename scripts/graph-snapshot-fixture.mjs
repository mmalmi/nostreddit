import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {createNamedGraphFixture} from 'nostr-social-graph/testing/namedGraph';
import {DEFAULT_GRAPH_SNAPSHOT} from 'nostr-social-graph/hashtreeSnapshot';

export const blockRoute = /^https:\/\/cdn\.iris\.to\/[a-f0-9]{64}\.bin$/;

// A loopback relay is visible to dedicated workers as well as page scripts.
// Only the test response for the built graph worker trusts this fixture signer.
export async function installGraphSnapshot(context, root, bytes, beforeBlock) {
  const fixture = await createNamedGraphFixture(root, bytes);
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
    let bundle = original.replaceAll(DEFAULT_GRAPH_SNAPSHOT.publisher, fixture.publisher);
    for (const url of DEFAULT_GRAPH_SNAPSHOT.relays) bundle = bundle.replaceAll(url, relayUrl);
    return route.fulfill({response, body: bundle});
  });
  await context.route('https://graph-api.iris.to/**', route => { reads.legacy++; return route.abort(); });
  await context.route(blockRoute, async route => {
    const data = await fixture.readBlock(new URL(route.request().url()).pathname.slice(1, -4));
    if (!data) return route.abort();
    reads.blocks++;
    if (beforeBlock) await beforeBlock();
    await route.fulfill({contentType: 'application/octet-stream', body: Buffer.from(data),
      headers: {'access-control-allow-origin': '*'}}).catch(error => {
      if (!route.request().failure() && !context.pages().every(page => page.isClosed())) throw error;
    });
  });
  return reads;
}
