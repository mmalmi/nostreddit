// Save small public photos only when a reader opens them. The feed keeps native
// lazy loading, and hosts that disallow cross-origin reads retain normal browser caching.
const name='nostreddit-opened-photos-v1';
const limit=2*1024*1024, entries=24;
const supported=/^image\/(?:jpeg|png|webp|avif)$/i;

export async function cachedPhoto(url:string) {
  if (typeof caches==='undefined') return;
  const response=await (await caches.open(name)).match(url);
  return response ? await response.blob() : undefined;
}

export async function rememberPhoto(url:string, displayedUrl:string) {
  if (typeof caches==='undefined' || navigator.onLine===false) return;
  const cache=await caches.open(name);
  if (await cache.match(url)) return;
  const response=await fetch(displayedUrl,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(7000)});
  const type=response.headers.get('Content-Type')?.split(';')[0] || '';
  if (!response.ok || !response.body || !supported.test(type) || Number(response.headers.get('Content-Length'))>limit ||
      /(?:no-store|private)/i.test(response.headers.get('Cache-Control') || '')) {
    await response.body?.cancel(); return;
  }
  const reader=response.body.getReader(), chunks:Uint8Array<ArrayBuffer>[]=[];
  let length=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      length+=value.byteLength;
      if (length>limit) {await reader.cancel(); return;}
      chunks.push(new Uint8Array(value));
    }
  } finally {reader.releaseLock();}
  const write=async () => {
    if (await cache.match(url)) return;
    const previous=await cache.keys();
    for (const key of previous.slice(0,Math.max(0,previous.length-entries+1))) await cache.delete(key);
    await cache.put(url,new Response(new Blob(chunks,{type}),{headers:{'Content-Type':type}}));
  };
  if (navigator.locks) await navigator.locks.request(name,write); else await write();
}
