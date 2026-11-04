import { expect, test } from '@playwright/test';

test('the topic heading follows the available sidebar space without membership controls', async ({page}, testInfo) => {
  await page.goto('/t/bitcoin');
  const sidebar = page.getByRole('complementary',{name:'Topic information'});
  const main = page.getByRole('main');
  const title = {name:'t/bitcoin',exact:true} as const;
  await expect(sidebar.getByRole('heading',title)).toBeVisible();
  await expect(sidebar.locator('.about p')).toHaveCount(0);
  await expect(sidebar).not.toContainText('Bitcoin and Lightning');
  await expect(main.getByRole('heading',title)).toHaveCount(0);
  await expect(page.getByRole('button',{name:/join|create community/i})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'All topics',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('topic-desktop.png')});

  await page.setViewportSize({width:390,height:844});
  await expect(main.getByRole('heading',title)).toBeVisible();
  await expect(main).not.toContainText('Bitcoin and Lightning');
  await expect(main).not.toContainText('A public Nostr topic');
  await expect(page.getByRole('button',{name:/join|create community/i})).toHaveCount(0);
  await expect(sidebar).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('topic-mobile.png')});
});
