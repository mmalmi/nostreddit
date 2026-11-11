import { once } from 'node:events';
import { test, expect, assertWorkerNetworkBlocked } from './helpers/isolatedBrowser';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { matchFilters } from 'nostr-tools/filter';
import type { NostrFilter } from 'nostr-pubsub';

async function fixture(query: string) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (typeof address === 'string' || !address) throw Error('Missing fixture address');
  const event = finalizeEvent({ kind: 1, content: query, created_at: Math.floor(Date.now()/1000),
    tags: [['subject', query], ['t', 'private-search-fixture']] }, generateSecretKey());
  const state = { url: `ws://127.0.0.1:${address.port}`, searches: 0, hold: false, pending: new Set<string>() };
  server.on('connection', socket => {
    socket.on('message', raw => {
      const [type, id, ...filters] = JSON.parse(String(raw)) as [string, string, ...NostrFilter[]];
      if (type === 'CLOSE') { state.pending.delete(id); return; }
      if (type !== 'REQ') return;
      if (filters.some(filter => filter.search)) {
        state.searches++;
        if (state.hold) { state.pending.add(id); return; }
      }
      if (matchFilters(filters, event) && filters.some(filter => !filter.search || query.includes(filter.search)))
        socket.send(JSON.stringify(['EVENT', id, event]));
      socket.send(JSON.stringify(['EOSE', id]));
    });
    socket.on('close', () => state.pending.clear());
  });
  return { state, async close() { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('custom relays contain keyword search on startup, live switch and reload', async ({ page, context, networkBoundary }, testInfo) => {
  await assertWorkerNetworkBlocked(page, networkBoundary);
  const first = await fixture('firstprivacysearchfixture'), second = await fixture('secondprivacysearchfixture');
  const socketAttempts: string[] = [];
  try {
    page.on('console', message => { if (message.text().startsWith('relay-test-socket:')) socketAttempts.push(message.text().slice(18)); });
    // Observe real worker WebSockets, blocking any unexpected public attempt.
    await context.route(/\/assets\/.*worker[^/]*\.js$/, async route => {
      const response = await route.fetch();
      const instrumentation = `const NativeSocket = globalThis.WebSocket;
        globalThis.WebSocket = class extends NativeSocket {
          constructor(url, protocols) {
            console.debug('relay-test-socket:' + url);
            if (new URL(url).hostname !== '127.0.0.1') throw new Error('Unexpected public relay');
            super(url, protocols);
          }
        };\n`;
      await route.fulfill({ response, body: instrumentation + await response.text() });
    });
    await context.addInitScript(url => {
      if (!localStorage.getItem('nostreddit.relays.v1')) localStorage.setItem('nostreddit.relays.v1', url);
      localStorage.setItem('nostreddit.ui.graphVisibility', JSON.stringify({maxDistance:null,hideOvermuted:false}));
      localStorage.setItem('nostreddit.ui.relatedSearch', 'false');
    }, first.state.url);
    await page.goto('/search?q=firstprivacysearchfixture');
    await expect(page.getByRole('heading', { name: 'firstprivacysearchfixture', exact: true })).toBeVisible();
    expect(first.state.searches).toBeGreaterThan(0);

    // Leave a search unfinished, then change relays without reloading the app.
    first.state.hold = true;
    await page.locator('[data-route-active="true"]').getByLabel('Search Nostreddit').fill('pendingprivacysearchfixture');
    await page.locator('[data-route-active="true"]').getByLabel('Search Nostreddit').press('Enter');
    await expect.poll(() => first.state.pending.size).toBeGreaterThan(0);
    await page.locator('[data-route-active="true"]').getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('link', { name: 'Network', exact: true }).click();
    await page.getByLabel('One relay address per line').fill(second.state.url);
    await page.getByRole('button', { name: 'Save relays', exact: true }).click();
    await expect.poll(() => first.state.pending.size).toBe(0);
    const oldSearches = first.state.searches;
    await page.locator('[data-route-active="true"]').getByLabel('Search Nostreddit').fill('secondprivacysearchfixture');
    await page.locator('[data-route-active="true"]').getByLabel('Search Nostreddit').press('Enter');
    await expect(page.getByRole('heading', { name: 'secondprivacysearchfixture', exact: true })).toBeVisible();
    expect(second.state.searches).toBeGreaterThan(0);
    expect(first.state.searches).toBe(oldSearches);
    const beforeReload = second.state.searches;
    await page.reload();
    await expect.poll(() => second.state.searches).toBeGreaterThan(beforeReload);
    await expect(page.getByRole('heading', { name: 'secondprivacysearchfixture', exact: true })).toBeVisible();
    expect(socketAttempts.length).toBeGreaterThan(0);
    expect(socketAttempts.filter(url => ![first.state.url, second.state.url].includes(url.replace(/\/$/, '')))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('custom-relay-search.png') });
  } finally { await first.close(); await second.close(); }
});
