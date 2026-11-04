/// <reference lib="webworker" />
import { precacheAndRoute, matchPrecache } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

const shell = [], optional = new Set<string>();
const optionalCache = 'nostreddit-optional-v1';
for (const asset of self.__WB_MANIFEST) {
  const entry = typeof asset === 'string' ? {url:asset,revision:null} : asset;
  const pathname = new URL(entry.url, self.location.href).pathname;
  if (pathname.startsWith('/assets/search/')) {
    optional.add(pathname);
  } else {
    // The production host redirects /index.html to /. Cache the canonical page:
    // browsers reject redirected responses for some offline navigations.
    shell.push({...entry,url:pathname === '/index.html' ? '/' : pathname});
  }
}

// Navigation comes first so an online reload can see the current deployment,
// even while the next worker waits for tabs from the previous build to close.
registerRoute(new NavigationRoute(async ({request}) => {
  try {
    const page = await fetch(request);
    if (page.status < 500) return page;
  } catch { /* Offline or interrupted navigation. */ }
  return await matchPrecache('/') ?? Response.error();
}));
precacheAndRoute(shell,{ignoreURLParametersMatching:[/^v$/, /^utm_/, /^fbclid$/]});
registerRoute(({url,request}) => url.origin === self.location.origin && !url.search &&
  optional.has(url.pathname) && !request.headers.has('Range'), new CacheFirst({cacheName:optionalCache}));

async function activate() {
  const cache = await caches.open(optionalCache);
  // Remove old release files only after its clients have released the old worker.
  for (const request of await cache.keys()) {
    if (!optional.has(new URL(request.url).pathname)) await cache.delete(request);
  }
  for (const name of await caches.keys()) {
    if (!name.startsWith('nostreddit-shell-')) continue;
    const previous = await caches.open(name);
    // Keep opted-in, content-hashed search resources through the migration.
    // Leave the old cache intact if storage is temporarily full.
    try {
      for (const request of await previous.keys()) {
        const path = new URL(request.url).pathname;
        if (!optional.has(path) || await cache.match(path)) continue;
        const response = await previous.match(request);
        if (response?.status === 200) await cache.put(path,response);
      }
      await caches.delete(name);
    } catch { /* Retry migration on the next activation. */ }
  }
  await self.clients.claim();
}
self.addEventListener('activate', event => event.waitUntil(activate()));
