import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const build = path.resolve(process.env.PWA_TEST_BUILD_DIR || '.work/test-dist');
async function optionalFile() {
  const file = (await readdir(path.join(build,'assets/search'))).find(name=>name.endsWith('.mjs'));
  if (!file) throw new Error('Missing hashed search runtime in the test build');
  return '/assets/search/'+file;
}

test('install precaches the app and graph, keeps optional assets lazy, and serves direct routes offline', async ({page,context}) => {
  const optionalRequests: string[] = [];
  context.on('request',req=>{
    if (new URL(req.url()).pathname.startsWith('/assets/search/')) optionalRequests.push(req.url());
  });
  await page.goto('/');
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');
  const devtools = await context.newCDPSession(page);
  try {
    expect((await devtools.send('Page.getAppManifest')).errors).toEqual([]);
    expect((await devtools.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  } finally { await devtools.detach(); }
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({id:'/',start_url:'/',scope:'/',display:'standalone',name:'Nostreddit'});
  for (const [size,purpose] of [[192,'any'],[512,'any'],[512,'maskable']] as const) {
    const icon = manifest.icons.find((x:{sizes:string;purpose:string})=>x.sizes===size+'x'+size && x.purpose===purpose);
    expect(icon.type).toBe('image/png');
    const bytes = await (await page.request.get(icon.src)).body();
    expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([size,size]);
  }
  const paths = await page.evaluate(async()=>{
    const groups = await Promise.all((await caches.keys()).map(async key=>(await (await caches.open(key)).keys()).map(r=>new URL(r.url).pathname)));
    return groups.flat();
  });
  expect(paths).toEqual(expect.arrayContaining(['/','/socialGraph.bin','/starter-feed.json','/manifest.webmanifest']));
  expect(paths.some(p=>p.startsWith('/assets/search/'))).toBe(false);
  expect(paths.some(p=>p.includes('/tree-reader-'))).toBe(true);
  expect(optionalRequests).toHaveLength(0);

  const file = await optionalFile();
  const bytes = await page.evaluate(async url=>(await (await fetch(url)).arrayBuffer()).byteLength,file);
  expect(bytes).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(async url=>Boolean(await caches.match(url)),file)).toBe(true);
  await context.setOffline(true);
  await page.goto('/settings');
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  expect(await page.evaluate(async url=>(await (await fetch(url)).arrayBuffer()).byteLength,file)).toBe(bytes);
  expect(await page.evaluate(async()=> (await fetch('/socialGraph.bin?v=085ba69fa37725c9')).status)).toBe(200);
});

test('upgrade waits for the old tabs, migrates opted-in files, and survives the production index redirect', async ({browser}) => {
  const file = await optionalFile(), oldCache = 'nostreddit-shell-v2-acceptance';
  const legacy = `
const cacheName=${JSON.stringify(oldCache)};
self.addEventListener('install',e=>e.waitUntil(caches.open(cacheName).then(c=>c.add('/'))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  if (new URL(e.request.url).pathname===${JSON.stringify(file)}) e.respondWith((async()=>{
    const cache=await caches.open(cacheName),r=await fetch(e.request); await cache.put(e.request,r.clone()); return r;
  })());
});`;
  let upgraded = false;
  const server = createServer(async (req,res)=>{
    try {
      const url = new URL(req.url!,'http://localhost');
      if (url.pathname==='/index.html') {res.writeHead(307,{Location:'/'}).end();return;}
      if (url.pathname==='/sw.js' && !upgraded) {res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(legacy);return;}
      const asset = url.pathname==='/' || !path.extname(url.pathname) ? 'index.html' : url.pathname.slice(1);
      const types:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
      const data = await readFile(path.join(build,asset));
      res.writeHead(200,{'Content-Type':types[path.extname(asset)]||'application/octet-stream','Cache-Control':'no-store'}).end(data);
    } catch {res.writeHead(404).end();}
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address = server.address();
  if (!address || typeof address==='string') throw new Error('No loopback port');
  const url = 'http://127.0.0.1:'+address.port;
  const context = await browser.newContext();
  try {
    const one = await context.newPage(), two = await context.newPage();
    await one.goto(url);
    await one.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
    await two.goto(url+'/settings');
    await two.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
    await one.evaluate(async file=>{await (await fetch(file)).arrayBuffer();},file);
    expect(await one.evaluate(async name=>(await caches.keys()).includes(name),oldCache)).toBe(true);
    upgraded = true;
    await one.evaluate(async()=>{await (await navigator.serviceWorker.ready).update();});
    await expect.poll(()=>one.evaluate(async()=> (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    await one.close();
    expect(await two.evaluate(async name=>(await caches.keys()).includes(name),oldCache)).toBe(true);
    expect(await two.evaluate(async()=> Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    await two.close();

    const fresh = await context.newPage();
    await fresh.goto(url+'/settings');
    await expect.poll(()=>fresh.evaluate(async name=>(await caches.keys()).includes(name),oldCache)).toBe(false);
    expect(await fresh.evaluate(async file=>Boolean(await (await caches.open('nostreddit-optional-v1')).match(file)),file)).toBe(true);
    await context.setOffline(true);
    await fresh.goto(url+'/topics');
    await expect(fresh.getByRole('heading',{name:'Communities',exact:true})).toBeVisible();
  } finally {await context.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
