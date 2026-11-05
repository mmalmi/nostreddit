import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`slow page loading waits two seconds, then reveals (${reducedMotion})`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/SettingsPage-*.js', async route => { await pending; await route.continue(); });
    try {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      const loading = page.locator('[data-route-active="true"] .loading-state').filter({ hasText: 'Loading…' });
      await expect(loading).toBeAttached();
      await expect(loading).toBeHidden();
      await expect(loading).toHaveCSS('animation-delay', '2s');
      await expect(loading).toHaveCSS('animation-duration', reducedMotion === 'reduce' ? '0.001s' : '0.18s');
      await page.waitForTimeout(1200);
      await expect(loading).toBeHidden();
      await expect(loading).toBeVisible({ timeout: 2000 });
      await page.screenshot({ path: info.outputPath(`slow-loading-${reducedMotion}.png`) });
      release();
      await expect(page.getByLabel('Maximum follow distance')).toBeVisible();
      await expect(loading).toHaveCount(0);
    } finally { release(); }
  });
}

test('a fast page never shows the placeholder and a failed page shows its error immediately', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/SettingsPage-*.js', async route => { await pending; await route.continue(); });
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  const loading = page.locator('[data-route-active="true"] .loading-state').filter({ hasText: 'Loading…' });
  await expect(loading).toBeAttached();
  await expect(loading).toBeHidden();
  release();
  await expect(page.getByLabel('Maximum follow distance')).toBeVisible();
  await expect(loading).toHaveCount(0);
  await page.route('**/ProfileConnections-*.js', route => route.abort());
  await page.goto('/u/' + 'a'.repeat(64) + '/following', { waitUntil: 'domcontentloaded' });
  const error = page.getByRole('alert').filter({ hasText: 'Could not load this page.' });
  await expect(error).toBeVisible({ timeout: 1500 });
  await expect(error).toHaveCSS('animation-name', 'none');
});
