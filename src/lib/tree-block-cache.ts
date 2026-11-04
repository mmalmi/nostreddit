// Only verified wire blocks enter storage. Keys for decrypting CHK content are never cache keys or values.
export interface TreeBlockCache {
  read(hash:string): Promise<Uint8Array | null>;
  save(hash:string, bytes:Uint8Array): Promise<void>;
  remove(hash:string): Promise<void>;
}

export const cacheByteLimit = 80 * 1024 * 1024;
export const cacheBlockLimit = 512;
export type CacheEntry = {hash:string; size:number; used:number};

export function evictions(entries: readonly CacheEntry[], incoming: CacheEntry): string[] {
  const others = entries.filter(entry => entry.hash !== incoming.hash).sort((a,b) => a.used-b.used || a.hash.localeCompare(b.hash));
  let bytes = others.reduce((sum, entry) => sum+entry.size, incoming.size);
  let count = others.length+1;
  const discarded: string[] = [];
  for (const entry of others) {
    if (bytes <= cacheByteLimit && count <= cacheBlockLimit) break;
    discarded.push(entry.hash);
    bytes -= entry.size;
    count--;
  }
  return discarded;
}

let opening: Promise<IDBDatabase | null> | undefined;
function database() {
  opening ??= new Promise<IDBDatabase | null>(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const request = indexedDB.open('nostreddit-tree-blocks',1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('blocks');
      request.result.createObjectStore('entries',{keyPath:'hash'});
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
    request.onerror = request.onblocked = () => resolve(null);
  }).catch(() => null);
  return opening;
}

// Both object stores share a transaction so concurrent tabs cannot exceed the cache limits.
async function access<T>(perform:(blocks:IDBObjectStore, entries:IDBObjectStore, result:(v:T)=>void)=>void): Promise<T | null> {
  const db = await database();
  if (!db) return null;
  return new Promise<T | null>(resolve => {
    const tx = db.transaction(['blocks','entries'],'readwrite');
    let value:T | null = null;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => resolve(null);
    perform(tx.objectStore('blocks'),tx.objectStore('entries'),v => {value=v;});
  }).catch(() => null);
}

export const durableBlocks: TreeBlockCache = {
  async read(hash) {
    return access<Uint8Array>((blocks, entries, done) => {
      const req = blocks.get(hash);
      req.onsuccess = () => {
        if (req.result instanceof Uint8Array) {
          entries.put({hash, size:req.result.byteLength, used:Date.now()});
          done(req.result);
        }
      };
    });
  },
  async save(hash, bytes) {
    if (bytes.byteLength > cacheByteLimit) return;
    await access((blocks, entries) => {
      const req = entries.getAll();
      req.onsuccess = () => {
        const incoming = {hash, size:bytes.byteLength, used:Date.now()};
        for (const key of evictions(req.result, incoming)) {
          blocks.delete(key); entries.delete(key);
        }
        blocks.put(bytes, hash);
        entries.put(incoming);
      };
    });
  },
  async remove(hash) {
    await access((blocks, entries) => { blocks.delete(hash); entries.delete(hash); });
  },
};
