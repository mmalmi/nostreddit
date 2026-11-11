import { expect, test } from '@playwright/test';
test('relay settings validate, persist and restore', async ({ page }) => {
  await page.goto('/settings/network');
  const input = page.getByLabel('One relay address per line');
  await expect(input).toBeVisible();
  await input.fill('https://example.com');
  await page.getByRole('button', { name: 'Save relays', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('wss://');
  await input.fill('ws://127.0.0.1:43164/\nws://127.0.0.1:43164');
  await page.getByRole('button', { name: 'Save relays', exact: true }).click();
  await expect(input).toHaveValue('ws://127.0.0.1:43164');
  await page.reload();
  await expect(input).toHaveValue('ws://127.0.0.1:43164');
  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Relay settings saved.' })).toBeVisible();
  await page.screenshot({ path: '/tmp/nostreddit-relay-settings.png', fullPage: true });
});
