import { expect, test } from '@playwright/test';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test.beforeEach(async ({ context }) => allowFixtureAuthors(context));
const active = '[data-route-active="true"]';

test('back and forward retain the actual DOM and local directory state', async ({ page }, info) => {
  await page.goto('/topics');
  const filter = page.getByRole('textbox', { name: 'Find or open a topic' });
  await filter.fill('photo');
  const original = await filter.elementHandle();
  const directoryId = await page.locator(active).getAttribute('data-route-view');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL('/settings');
  const settingsId = await page.locator(active).getAttribute('data-route-view');
  await page.evaluate(() => window.scrollTo(0, 350));
  const settingsScroll = await page.evaluate(() => window.scrollY);
  await page.goBack();
  await expect(filter).toHaveValue('photo');
  expect(await filter.evaluate((node, previous) => node === previous, original)).toBe(true);
  await expect(page.locator(active)).toHaveAttribute('data-route-view', directoryId!);
  await page.goForward();
  await expect(page.locator(active)).toHaveAttribute('data-route-view', settingsId!);
  expect(await page.evaluate(() => window.scrollY)).toBe(settingsScroll);
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('link', { name: 'Explore all', exact: true }).click();
  await expect(filter).toHaveValue('photo');
  expect(await filter.evaluate((node, previous) => node === previous, original)).toBe(true);
  await page.screenshot({ path: info.outputPath('retained-settings.png') });
});

test('thread reply draft survives back and forward without remounting', async ({ page }) => {
  await page.goto('/t/photography');
  await page.getByRole('link', { name: 'Notes from the coast', exact: true }).first().click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in to leave a comment' }).click();
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const reply = page.getByLabel('Your reply', { exact: true });
  await reply.fill('A draft that should survive navigation.');
  await expect(page.getByRole('button', { name: 'Post reply', exact: true })).toBeEnabled();
  const original = await reply.elementHandle();
  await page.goBack();
  await expect(page).toHaveURL('/t/photography');
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await page.goForward();
  await expect(reply).toHaveValue('A draft that should survive navigation.');
  expect(await reply.evaluate((node, previous) => node === previous, original)).toBe(true);
});

test('retained views are bounded and evicted history still opens correctly', async ({ page }) => {
  await page.goto('/topics');
  for (let i = 0; i < 7; i++) {
    await page.getByRole('textbox', { name: 'Search Nostreddit' }).fill('query' + i);
    await page.getByRole('textbox', { name: 'Search Nostreddit' }).press('Enter');
    await expect(page).toHaveURL('/search?q=query' + i);
  }
  await expect(page.locator('[data-route-view]')).toHaveCount(6);
  for (let i = 0; i < 7; i++) await page.goBack();
  await expect(page).toHaveURL('/topics');
  await expect(page.getByRole('textbox', { name: 'Find or open a topic' })).toBeVisible();
  await expect(page.locator('[data-route-view]')).toHaveCount(6);
});
