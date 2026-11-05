import { chromium, expect } from '@playwright/test';
import { SocialGraph } from 'nostr-social-graph';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

const [base, output] = process.argv.slice(2);
if (!base || !output) throw new Error('Usage: node scripts/check-graph-negentropy.mjs URL RECEIPT');
const require = createRequire(import.meta.url);
const graphPackage = dirname(require.resolve('nostr-social-graph/package.json'));
const { Negentropy, NegentropyStorageVector } = await import(pathToFileURL(join(graphPackage, 'src/vendor/negentropy.js')));
const { root } = JSON.parse(await readFile(new URL('../public/socialGraphSnapshot.provenance.json', import.meta.url), 'utf8'));
const key = new Uint8Array(32).fill(42), owner = getPublicKey(key);
const target = getPublicKey(new Uint8Array(32).fill(43));
const at = Math.floor(Date.now() / 1000) - 30;
const event = (kind, created_at) => finalizeEvent({ kind, created_at, content: '', tags: [['p', target]] }, key);
const previous = [event(3, at), event(10000, at + 1)];
const changed = [event(3, at + 10), event(10000, at + 11)];
const retained = new SocialGraph(root);
retained.addFollower(root, owner);
retained.handleEvent(previous, true);
const original = [...await retained.toBinary()];

async function stored(page, bytes) {
  return page.evaluate(bytes => new Promise((resolve, reject) => {
    const open = indexedDB.open('nostreddit-social-graph', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('snapshots', bytes === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = bytes === undefined ? store.get('current') : store.put(new Uint8Array(bytes), 'current');
      transaction.oncomplete = () => { db.close(); resolve(bytes === undefined ? [...(request.result ?? [])] : undefined); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), bytes);
}

const browser = await chromium.launch();
const receipts = [];
try {
  for (const mode of ['unsupported', 'success']) {
    const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(relay, 'listening');
    const url = `ws://127.0.0.1:${relay.address().port}`;
    const state = { negotiations: 0, closed: 0, graphRequests: [], errors: [] };
    relay.on('connection', socket => {
      const sessions = new Map();
      let graphSocket = false;
      socket.on('close', () => { if (graphSocket) state.closed++; });
      socket.on('message', async raw => {
        try {
          const frame = JSON.parse(raw.toString());
          if (frame[0] === 'NEG-OPEN') {
            graphSocket = true;
            state.negotiations++;
            if (mode === 'unsupported') {
              socket.send(JSON.stringify(['NEG-ERR', frame[1], 'unsupported']));
              return;
            }
            const storage = new NegentropyStorageVector();
            for (const item of changed) if (frame[2].authors.includes(item.pubkey) && frame[2].kinds.includes(item.kind)) {
              storage.insert(item.created_at, item.id);
            }
            storage.seal();
            const session = new Negentropy(storage, 16384);
            sessions.set(frame[1], session);
            socket.send(JSON.stringify(['NEG-MSG', frame[1], (await session.reconcile(frame[3]))[0]]));
          } else if (frame[0] === 'NEG-MSG') {
            socket.send(JSON.stringify(['NEG-MSG', frame[1], (await sessions.get(frame[1]).reconcile(frame[2]))[0]]));
          } else if (frame[0] === 'NEG-CLOSE') {
            sessions.delete(frame[1]);
          } else if (frame[0] === 'REQ') {
            if (graphSocket) {
              state.graphRequests.push(frame[2]);
              // The old broad fallback must fail visibly, not because the test
              // relay withheld bodies from it.
              for (const item of changed) if (!frame[2].ids || frame[2].ids.includes(item.id)) {
                socket.send(JSON.stringify(['EVENT', frame[1], item]));
              }
            }
            socket.send(JSON.stringify(['EOSE', frame[1]]));
          }
        } catch (error) { state.errors.push(String(error)); socket.close(); }
      });
    });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let bootstrapRequests = 0;
    const errors = [];
    await context.route('https://graph-api.iris.to/**', route => { bootstrapRequests++; return route.abort(); });
    await context.routeWebSocket(/^wss:\/\//, socket => socket.close());
    const fixture = new URL('/__graph_protocol_fixture__', base).href;
    await context.route(fixture, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Graph protocol fixture</title>' }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(fixture);
      await page.evaluate(url => localStorage.setItem('nostreddit.relays.v1', url), url);
      await stored(page, original);
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => state.closed, { timeout: 20000 }).toBeGreaterThan(0);
      if (mode === 'unsupported') {
        expect(state.graphRequests, 'Rejected NEG must not cause a graph event query').toEqual([]);
        await page.waitForTimeout(1800);
        expect(await stored(page)).toEqual(original);
      } else {
        const revisions = async () => {
          const graph = await SocialGraph.fromBinary(root, new Uint8Array(await stored(page)));
          return [graph.getListRevision(owner, 3)?.id, graph.getListRevision(owner, 10000)?.id];
        };
        await expect.poll(revisions, { timeout: 10000 }).toEqual(changed.map(item => item.id));
        expect(state.graphRequests.every(filter => Object.keys(filter).join(',') === 'ids')).toBe(true);
        expect(state.graphRequests.flatMap(filter => filter.ids).sort()).toEqual(changed.map(item => item.id).sort());
        const requests = state.graphRequests.length, closed = state.closed;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect.poll(() => state.closed).toBeGreaterThan(closed);
        expect(await revisions()).toEqual(changed.map(item => item.id));
        expect(state.graphRequests.length, 'Persisted heads need no repeated event download').toBe(requests);
      }
      expect(bootstrapRequests).toBe(0);
      expect(errors).toEqual([]);
      expect(state.errors).toEqual([]);
      receipts.push({ mode, passed: true, negotiations: state.negotiations, requests: state.graphRequests, bootstrapRequests });
    } finally {
      await context.close();
      for (const socket of relay.clients) socket.terminate();
      await new Promise(resolve => relay.close(resolve));
    }
  }
  await writeFile(output, JSON.stringify({ passed: true, cases: receipts }, null, 2) + '\n');
  console.log('PASS: rejected graph reconciliation preserves saved bytes; successful NEG fetches exact IDs and retains them across reload.');
} finally { await browser.close(); }
