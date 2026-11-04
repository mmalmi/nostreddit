// Dedicated browser, no sampling inside the app. CPU includes Chromium, renderers and workers.
import { chromium } from '@playwright/test';
const target = process.argv[2];
if (!target) throw new Error('Provide a running Nostreddit URL');
const browser = await chromium.launch();
async function sample(cdp) {
  const start = await cdp.send('SystemInfo.getProcessInfo');
  const at = performance.now();
  await new Promise(resolve => setTimeout(resolve, 6000));
  const finish = await cdp.send('SystemInfo.getProcessInfo');
  const elapsed = performance.now() - at;
  const previous = new Map(start.processInfo.map(p => [p.id,p.cpuTime]));
  const cpu = finish.processInfo.reduce((sum,p) => sum + Math.max(0,p.cpuTime-(previous.get(p.id) ?? 0)),0);
  return Number((100000*cpu/elapsed).toFixed(2));
}
try {
  const cdp = await browser.newBrowserCDPSession();
  const page = await browser.newPage();
  await page.goto(target);
  await page.locator('article').first().waitFor({timeout:20_000});
  await page.waitForTimeout(12_000);
  const foreground = await sample(cdp);
  await page.evaluate(() => {
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1500);
  const background = await sample(cdp);
  console.log(JSON.stringify({foregroundCorePercent:foreground,hiddenCorePercent:background,sampleSeconds:6}));
  if (Math.max(foreground,background)>10) process.exitCode = 1;
} finally { await browser.close(); }
