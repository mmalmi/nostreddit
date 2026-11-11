import { expect, test, type Page } from '@playwright/test';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const background = (page: Page) => page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor);

test('system mode follows live changes and explicit modes override the device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings');
  const mode = page.getByLabel('Display mode');
  await expect(mode).toHaveValue('system');
  await expect(page.getByRole('radio', { name: 'Forest' })).toBeChecked();
  const light = await background(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => background(page)).not.toBe(light);
  const dark = await background(page);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', dark);

  await mode.selectOption('light');
  await expect.poll(() => background(page)).toBe(light);
  await mode.selectOption('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => background(page)).toBe(dark);
  await mode.selectOption('system');
  await expect.poll(() => background(page)).toBe(light);
});

test('all palettes work in both modes and survive navigation and reload', async ({ page, context }, testInfo) => {
  await allowFixtureAuthors(context);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings');
  const mode = page.getByLabel('Display mode');
  const accents = new Set<string>();
  for (const display of ['light', 'dark']) {
    await mode.selectOption(display);
    for (const theme of ['Forest', 'Ocean', 'Plum', 'Ember']) {
      const choice = page.getByRole('radio', { name: theme });
      await choice.check();
      await expect(choice).toBeChecked();
      accents.add(await page.locator('.create-button').evaluate(el => getComputedStyle(el).backgroundColor));
    }
  }
  expect(accents.size).toBe(8);
  await page.getByRole('radio', { name: 'Ocean' }).check();
  await page.getByRole('link', { name: 'Nostreddit home', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Notes from the coast', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
  await expect(page.getByRole('link', { name: 'Notes from the coast', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dark-ocean-feed.png') });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(mode).toHaveValue('dark');
  await expect(page.getByRole('radio', { name: 'Ocean' })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('dark-ocean-settings.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/appearance');
  await mode.selectOption('light');
  const plum = page.getByRole('radio', { name: 'Plum' });
  await page.getByRole('radio', { name: 'Ocean' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(plum).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('light-plum-mobile.png') });
});

test('a deep link restores the saved appearance before the app mounts', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('nostreddit.ui.appearance', JSON.stringify({ mode: 'dark', theme: 'ember' })));
  await page.route('**/assets/*.js', route => route.abort());
  await page.goto('/topics');
  await expect(page.locator('#app')).toBeEmpty();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
});

test('settings still work for the current visit when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {
      if (key === 'nostreddit.ui.appearance') throw new DOMException('Storage unavailable', 'SecurityError');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === 'nostreddit.ui.appearance') throw new DOMException('Storage unavailable', 'SecurityError');
      setItem.call(this, key, value);
    };
  });
  await page.goto('/settings');
  const mode = page.getByLabel('Display mode');
  await expect(mode).toHaveValue('system');
  await mode.selectOption('dark');
  await page.getByRole('radio', { name: 'Ember' }).check();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
});
