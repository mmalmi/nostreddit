import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Version the complete shell, including the public data used on a first visit.
export async function writeOfflineShell(directory) {
  const assets = (await readdir(path.join(directory, 'assets'), {recursive:true, withFileTypes:true}))
    .filter(entry => entry.isFile())
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  const optional = assets.filter(file => file.startsWith('assets/search/')).sort();
  const files = [...assets,'index.html','favicon.svg','starter-feed.json','socialGraph.bin'].sort();
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(file);
    digest.update(await readFile(path.join(directory, file)));
  }
  const cacheName = 'nostreddit-shell-v2-' + digest.digest('hex').slice(0,20);
  const script = `
const cacheName = ${JSON.stringify(cacheName)};
const shell = new Set(${JSON.stringify(files.filter(file => !optional.includes(file)).map(file => file === 'index.html' ? '/' : '/' + file))});
const optional = new Set(${JSON.stringify(optional.map(file => '/' + file))});
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll([...shell].map(url => new Request(url, {cache:'reload'})))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('nostreddit-shell-') && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const {request} = event, url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(cacheName).then(cache => cache.match('/'))));
  } else if (optional.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone()).catch(() => {});
      return response;
    })());
  } else if (shell.has(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  }
});
`;
  await writeFile(path.join(directory,'sw.js'),script.trimStart());
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await writeOfflineShell(process.argv[2] || 'dist');
}
