import { expect, test } from '@playwright/test';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test('startup defers optional views and revisiting settings keeps its controls mounted', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    await allowFixtureAuthors(context);
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('button', { name: 'Create a post', exact: true })).toBeVisible();
    const optional = () => requests.filter(path => /\/(SettingsPage|ThreadComments|ProfileHeader|AccountPanel|Composer|ZapPanel)-.*\.js$/.test(path));
    expect(optional()).toEqual([]);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    const sorting = page.getByLabel('Feed order', { exact: true });
    await expect(sorting).toBeVisible();
    const original = await sorting.elementHandle();
    await sorting.selectOption('New');
    await page.getByRole('link', { name: 'Home feed', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(sorting).toHaveValue('New');
    expect(await sorting.evaluate((node, previous) => node === previous, original)).toBe(true);
    expect(optional().filter(path => path.includes('/SettingsPage-'))).toHaveLength(1);
  } finally { await context.close(); }
});

test('a failed deferred view exposes an accessible recovery action', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    await allowFixtureAuthors(context);
    await context.route('**/SettingsPage-*.js', route => route.abort());
    const page = await context.newPage();
    await page.goto('/settings');
    await expect(page.getByRole('alert')).toHaveText('Could not load this page.');
    await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeVisible();
  } finally { await context.close(); }
});

for (const width of [390, 1440]) {
  test(`a deferred profile header reserves its final height at ${width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width, height: 960 } });
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    try {
      await allowFixtureAuthors(context);
      const page = await context.newPage();
      await page.goto('/t/photography');
      const profilePath = await page.getByRole('main').getByRole('link', { name: 'Field Observer', exact: true }).first().getAttribute('href');
      await context.route('**/ProfileHeader-*.js', async route => { await ready; await route.continue(); });
      await page.goto(profilePath!);
      const loading = page.locator('.profile-loading');
      await expect(loading).toBeVisible();
      const before = await loading.boundingBox();
      await page.screenshot({ path: test.info().outputPath('profile-loading.png') });
      release();
      const header = page.getByRole('region', { name: 'Profile', exact: true });
      await expect(header.locator('.avatar')).toBeVisible();
      const after = await header.boundingBox();
      expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
    } finally { release(); await context.close(); }
  });
}
