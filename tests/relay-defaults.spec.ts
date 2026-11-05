import { once } from 'node:events';
import { test, expect, assertWorkerNetworkBlocked } from './helpers/isolatedBrowser';
import { WebSocketServer } from 'ws';
import { getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';

const previous = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://temp.iris.to'];
const shipped = ['wss://relay.ditto.pub', ...previous];
const cases = [
  { name: 'absent', saved: null, expected: shipped },
  { name: 'previous defaults', saved: previous.join('\n'), expected: previous },
  { name: 'empty', saved: '', expected: [] },
  { name: 'whitespace', saved: ' \n ', expected: [] },
  { name: 'invalid', saved: 'https://not-a-relay.invalid', expected: [] },
  { name: 'custom', saved: 'wss://chosen.example', expected: ['wss://chosen.example'] },
];

// Run this suite with an independent loopback-only network boundary. The
// worker rewrite below observes requested routes; it is not the egress guard.
for (const scenario of cases) test(`relay defaults preserve ${scenario.name} settings and worker routes`, async ({ page, context, networkBoundary }, testInfo) => {
  await assertWorkerNetworkBlocked(page, networkBoundary);
  const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(relay, 'listening');
  const address = relay.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback relay');
  const loopback = `ws://127.0.0.1:${address.port}`;
  const frames: { destination: string; frame: unknown[] }[] = [];
  const configured: string[][] = [];
  relay.on('connection', (socket, request) => {
    const destination = new URL(request.url!, 'http://localhost').searchParams.get('destination')!.replace(/\/$/, '');
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw));
      frames.push({ destination, frame });
      if (frame[0] === 'REQ') socket.send(JSON.stringify(['EOSE', frame[1]]));
      if (frame[0] === 'NEG-OPEN') socket.send(JSON.stringify(['NEG-ERR', frame[1], 'unsupported']));
      if (frame[0] === 'EVENT') socket.send(JSON.stringify(['OK', frame[1].id, true, '']));
    });
  });
  const instrument = `{
    const OriginalSocket = globalThis.WebSocket;
    globalThis.WebSocket = class extends OriginalSocket {
      constructor(url, protocols) { super(${JSON.stringify(loopback)} + '/?destination=' + encodeURIComponent(String(url)), protocols); }
    };
    globalThis.addEventListener('message', event => {
      if (event.data?.type === 'configure') console.debug('relay-configured:' + JSON.stringify(event.data.urls));
    });
  }\n`;
  let workersInstrumented = 0;
  page.on('console', message => {
    if (message.text().startsWith('relay-configured:')) configured.push(JSON.parse(message.text().slice(17)));
  });
  try {
    await context.route(/\/assets\/.*worker[^/]*\.js$/, async route => {
      const response = await route.fetch();
      workersInstrumented++;
      await route.fulfill({ response, body: instrument + await response.text() });
    });
    await context.addInitScript({ content: instrument });
    const secret = new Uint8Array(32).fill(84);
    await context.addInitScript(({ saved, account }) => {
      if (saved !== null) localStorage.setItem('nostreddit.relays.v1', saved);
      localStorage.setItem('nostreddit.account.v1', JSON.stringify(account));
      localStorage.setItem('nostreddit.ui.graphVisibility', JSON.stringify({maxDistance:null,hideOvermuted:false}));
    }, { saved: scenario.saved, account: { pubkey: getPublicKey(secret), method: 'local', nsec: nsecEncode(secret) } });
    await page.goto('/settings');
    await expect(page.getByLabel('One relay address per line')).toHaveValue(scenario.expected.join('\n'));
    await expect.poll(() => configured.at(-1)).toEqual(scenario.expected);
    expect(workersInstrumented).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByLabel('One relay address per line')).toHaveValue(scenario.expected.join('\n'));
    expect(await page.evaluate(() => localStorage.getItem('nostreddit.relays.v1'))).toBe(scenario.saved);
    await expect.poll(() => configured.length).toBeGreaterThan(1);
    if (scenario.name === 'absent') {
      await page.getByRole('button', { name: 'Create post', exact: true }).first().click();
      await page.getByRole('combobox', { name: 'Topic', exact: true }).fill('nostr');
      await page.getByLabel('Title', { exact: true }).fill('Loopback relay routing fixture');
      await page.getByLabel(/Body/).fill('This event stays inside the isolated test relay.');
      await page.getByRole('button', { name: 'Publish post', exact: true }).click();
      await expect.poll(() => frames.filter(row => row.frame[0] === 'EVENT').length).toBeGreaterThanOrEqual(shipped.length);
      const published = frames.filter(row => row.frame[0] === 'EVENT');
      expect([...new Set(published.map(row => row.destination))].sort()).toEqual([...shipped].sort());
      expect(published.every(row => verifyEvent(row.frame[1] as Parameters<typeof verifyEvent>[0]))).toBe(true);
      await expect.poll(() => [...new Set(frames.filter(row => row.frame[0] === 'NEG-OPEN').map(row => row.destination))], { timeout: 20000 })
        .toEqual(['wss://graph-relay.iris.to', 'wss://relay.ditto.pub', 'wss://relay.damus.io']);
    }
    const ordinary = frames.filter(row => row.frame[0] === 'REQ').map(row => row.destination);
    expect(ordinary.every(destination => scenario.expected.includes(destination))).toBe(true);
    if (scenario.expected.length === 0) expect(frames).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`relays-${scenario.name.replaceAll(' ', '-')}.png`) });
  } finally {
    await testInfo.attach('relay-routing.json', { body: JSON.stringify({ configured, workersInstrumented, frames }), contentType: 'application/json' });
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    for (const socket of relay.clients) socket.terminate();
    await new Promise<void>(resolve => relay.close(() => resolve()));
  }
});
