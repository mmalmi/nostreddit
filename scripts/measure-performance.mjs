// Reproducible browser measurements against a production build and a fixed relay fixture.
// Run serially on a quiet host; cold contexts exclude service-worker precaching.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const target = process.argv[2];
if (!target) throw new Error('Usage: node scripts/measure-performance.mjs URL [output.json] [runs]');
const runs = Number(process.argv[4] || 5);
const browser = await chromium.launch();
const results = [];
const browserSession = await browser.newBrowserCDPSession();
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
try {
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({serviceWorkers:'block', viewport:{width:390,height:844}});
    await context.addInitScript(() => {
      localStorage.setItem('nostreddit.ui.graphVisibility', JSON.stringify({maxDistance:null,hideOvermuted:false}));
      window.__perf = { lcp:0, cls:0, longTasks:[], interactions:[] };
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perf.lcp=e.startTime; }).observe({type:'largest-contentful-paint',buffered:true});
      new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.cls+=e.value; }).observe({type:'layout-shift',buffered:true});
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perf.longTasks.push(e.duration); }).observe({type:'longtask',buffered:true});
      new PerformanceObserver(list => { for (const e of list.getEntries()) if(e.interactionId) window.__perf.interactions.push(e.duration); }).observe({type:'event',buffered:true,durationThreshold:16});
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {offline:false,latency:80,downloadThroughput:200000,uploadThroughput:100000});
    await session.send('Emulation.setCPUThrottlingRate',{rate:4});
    await session.send('Performance.enable');
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(target, {waitUntil:'load'});
    await page.locator('[data-route-active="true"] article').first().waitFor({timeout:30000});
    await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const cold = await page.evaluate(() => {
      const nav=performance.getEntriesByType('navigation')[0];
      const resources=performance.getEntriesByType('resource');
      return {feedReadyMs:performance.now(),fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
        lcp:window.__perf.lcp,cls:window.__perf.cls,domContentLoaded:nav.domContentLoadedEventEnd,load:nav.loadEventEnd,
        transferBytes:resources.reduce((n,r)=>n+r.transferSize,nav.transferSize),
        jsBytes:resources.filter(r=>new URL(r.name).pathname.endsWith('.js')).reduce((n,r)=>n+r.encodedBodySize,0),
        longTasks:window.__perf.longTasks.length,blockingMs:window.__perf.longTasks.reduce((n,ms)=>n+Math.max(0,ms-50),0)};
    });
    await page.waitForTimeout(1000);
    cold.settledCls = await page.evaluate(() => window.__perf.cls);
    cold.settledLcp = await page.evaluate(() => window.__perf.lcp);
    await page.reload({waitUntil:'load'});
    await page.locator('[data-route-active="true"] article').first().waitFor({timeout:30000});
    await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const warm=await page.evaluate(()=>({fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      load:performance.getEntriesByType('navigation')[0].loadEventEnd}));
    const navigation=[];
    for (const name of ['Explore all','Settings','Following','In network','Saved posts','Home feed','Settings','Home feed']) {
      // Mobile sidebar must be opened through its real control.
      const link=page.getByRole('link',{name,exact:true}).first();
      if (!await link.isVisible()) await page.getByRole('button',{name:'Toggle navigation'}).click();
      const start=performance.now();
      await link.click();
      await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      navigation.push({name,ms:performance.now()-start});
    }
    await session.send('Emulation.setCPUThrottlingRate',{rate:1});
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const getMetrics=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const first=await getMetrics();
    const processStart=await browserSession.send('SystemInfo.getProcessInfo');
    const sampleStart=performance.now();
    await page.waitForTimeout(2000);
    const last=await getMetrics();
    const elapsed=performance.now()-sampleStart;
    const processEnd=await browserSession.send('SystemInfo.getProcessInfo');
    const previous=new Map(processStart.processInfo.map(p=>[p.id,p.cpuTime]));
    const cpu=processEnd.processInfo.reduce((sum,p)=>sum+Math.max(0,p.cpuTime-(previous.get(p.id)??0)),0);
    const idleCorePercent=100000*cpu/elapsed;
    const details=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,mountedViews:document.querySelectorAll('[data-route-view]').length,maxInteractionMs:Math.max(0,...window.__perf.interactions)}));
    const row={run,cold,warm,navigation,idleCorePercent,idleMainThreadMs:1000*(last.TaskDuration-first.TaskDuration),heapBytes:last.JSHeapUsedSize,...details,errors};
    results.push(row); console.log(JSON.stringify(row));
    await context.close();
  }
  const summary={runs,conditions:{viewport:'390x844',cpuSlowdown:4,latencyMs:80,downloadBytesPerSecond:200000,serviceWorkers:'blocked',idleCpuSlowdown:1,idleSampleMs:2000},
    median:Object.fromEntries(['fcp','lcp','cls','feedReadyMs','domContentLoaded','load','transferBytes','jsBytes','blockingMs'].map(key=>[key,median(results.map(r=>r.cold[key]))])),
    medianMaxInteractionMs:median(results.map(r=>r.maxInteractionMs)),
    medianWarmFcp:median(results.map(r=>r.warm.fcp)),medianIdleCorePercent:median(results.map(r=>r.idleCorePercent)),
    medianIdleMainThreadMs:median(results.map(r=>r.idleMainThreadMs)),medianHeapBytes:median(results.map(r=>r.heapBytes)),
    navigationReuseMedianMs:median(results.flatMap(r=>r.navigation.slice(-2).map(n=>n.ms))),
    navigationMedianMs:median(results.flatMap(r=>r.navigation.map(n=>n.ms))),results};
  if(process.argv[3]) await writeFile(process.argv[3],JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({...summary,results:undefined}));
  if(results.some(r=>r.errors.length)) process.exitCode=1;
} finally { await browser.close(); }
