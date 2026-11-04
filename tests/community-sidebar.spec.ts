import { expect, test } from '@playwright/test';

test('the community summary and join control follow the available sidebar space', async ({page}, testInfo) => {
  await page.goto('/r/bitcoin');
  const sidebar = page.getByRole('complementary',{name:'Community information'});
  const main = page.getByRole('main');
  const title = {name:'r/bitcoin',exact:true} as const;
  await expect(sidebar.getByRole('heading',title)).toBeVisible();
  await expect(sidebar.locator('.about p')).toHaveCount(0);
  await expect(sidebar).not.toContainText('Bitcoin and Lightning');
  await expect(main.getByRole('heading',title)).toHaveCount(0);
  await sidebar.getByRole('button',{name:'Join community'}).click();
  await expect(sidebar.getByRole('button',{name:'Joined'})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:testInfo.outputPath('community-desktop.png')});

  await page.setViewportSize({width:390,height:844});
  await expect(main.getByRole('heading',title)).toBeVisible();
  await expect(main).not.toContainText('Bitcoin and Lightning');
  await expect(main).not.toContainText('A public Nostr topic');
  await main.getByRole('button',{name:'Joined'}).click();
  await expect(main.getByRole('button',{name:'Join community'})).toHaveAttribute('aria-pressed','false');
  await expect(sidebar).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('community-mobile.png')});
});
