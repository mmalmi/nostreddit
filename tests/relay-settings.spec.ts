import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { WebSocketServer, type WebSocket } from 'ws';

const defaultRelay = process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164';

test('relay rows validate, save, remove and restore', async ({ page }) => {
  await page.goto('/settings/network');
  const section = page.getByRole('region', { name: 'Relays', exact: true });
  const inputs = section.getByRole('textbox');
  const save = section.getByRole('button', { name: 'Save relays' });
  const add = section.getByRole('button', { name: 'Add relay' });
  await expect(inputs).toHaveCount(1);
  await expect(inputs.first()).toHaveValue(defaultRelay);
  await expect(section.getByText('Connected', { exact: true })).toBeVisible();

  await add.click();
  await expect(inputs.nth(1)).toBeFocused();
  await inputs.nth(1).fill('https://example.com');
  await save.click();
  await expect(section.getByRole('alert')).toContainText('wss://');
  expect(await page.evaluate(() => localStorage.getItem('nostreddit.relays.v1'))).toBeNull();
  await inputs.nth(1).fill(defaultRelay + '/');
  await save.click();
  await expect(inputs).toHaveCount(1);
  await expect(inputs.first()).toHaveValue(defaultRelay);

  await add.click();
  const custom = defaultRelay + '/custom';
  await inputs.nth(1).fill(custom);
  await expect(section.getByText('Unsaved', { exact: true })).toBeVisible();
  await save.click();
  await page.reload();
  await expect(inputs.nth(1)).toHaveValue(custom);
  await expect(section.getByText('Connected', { exact: true })).toHaveCount(2);
  await section.getByRole('button', { name: 'Remove relay 1' }).click();
  await expect(inputs.first()).toBeFocused();
  await save.click();
  await expect(inputs).toHaveCount(1);
  await expect(inputs.first()).toHaveValue(custom);
  expect(await page.evaluate(() => localStorage.getItem('nostreddit.relays.v1'))).toBe(custom);

  await section.getByRole('button', { name: 'Remove relay 1' }).click();
  await save.click();
  await expect(section.getByRole('alert')).toContainText('between 1 and 8');
  await section.getByRole('button', { name: 'Restore defaults' }).click();
  await expect(inputs.first()).toHaveValue(defaultRelay);
  await expect(section.getByRole('status')).toHaveText('Relay settings saved.');

  for (let i = 1; i < 8; i++) await add.click();
  await expect(add).toBeDisabled();
});

test('each row follows its own socket through handshake, open and close', async ({ page }, info) => {
  const server = createServer();
  const ws = new WebSocketServer({ noServer: true });
  let acceptConnections = false;
  const handshakes: (() => void)[] = [];
  const connections: WebSocket[] = [];
  server.on('upgrade', (request, socket, head) => {
    const accept = () => ws.handleUpgrade(request, socket, head, peer => connections.push(peer));
    if (acceptConnections) accept();
    else handshakes.push(accept);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing relay port');
  try {
    await page.addInitScript(urls => localStorage.setItem('nostreddit.relays.v1', urls),
      defaultRelay + '\nws://127.0.0.1:' + address.port);
    await page.goto('/settings/network');
    const section = page.getByRole('region', { name: 'Relays', exact: true });
    const rows = section.getByRole('listitem');
    const sidebar = page.getByLabel('Main navigation');
    const summary = sidebar.getByRole('status');
    await expect(rows.nth(0)).toContainText('Connected');
    await expect(rows.nth(1)).toContainText('Connecting');
    await page.getByRole('link', { name: 'Nostreddit home' }).click();
    await expect(summary).toHaveText('1/2 relays connected');
    await summary.screenshot({ path: info.outputPath('sidebar-partial.png') });
    await expect.poll(() => handshakes.length).toBeGreaterThan(0);
    acceptConnections = true;
    handshakes.splice(0).forEach(accept => accept());
    await expect(summary).toHaveText('2/2 relays connected');
    await summary.screenshot({ path: info.outputPath('sidebar-connected.png') });
    await page.goBack();
    await expect(rows.nth(1)).toContainText('Connected');
    // No Nostr event or end-of-history response was sent by this relay.
    acceptConnections = false;
    connections.forEach(peer => peer.terminate());
    await expect(rows.nth(1)).toContainText('Disconnected');
    await expect(rows.nth(0)).toContainText('Connected');
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 850 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await section.screenshot({ path: info.outputPath('relay-rows-' + width + '.png') });
    }
    await section.getByRole('button', { name: 'Remove relay 1' }).click();
    await section.getByRole('button', { name: 'Save relays' }).click();
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(summary).toHaveText('0/1 relay connected');
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sidebar-offline-mobile.png') });
  } finally {
    await page.close();
    for (const peer of ws.clients) peer.terminate();
    server.closeAllConnections();
    server.close();
    ws.close();
  }
});
