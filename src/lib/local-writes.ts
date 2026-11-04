import type { NostrEvent } from 'nostr-pubsub';
import { relayUrls, testRelays } from './relayTypes';

export type Change = {kind:0; fields:Record<string,string>} | {kind:3|10000; key:string; enabled:boolean};
export type QueuedWrite = {
  seq:number; owner:string; event?:NostrEvent; change?:Change;
  attempts:number; retryAt:number; error?:string; hold?:boolean;
  prepared?:{baseId:string; through:number; event:NostrEvent};
};
type Saved = {key:string; owner:string; event:NostrEvent; saved:number};
const scope = testRelays ? relayUrls.join(',') : 'public';
let opening: Promise<IDBDatabase> | undefined;
export const journalChannel = 'nostreddit-writes:' + scope;

function database() {
  if (!opening) opening = new Promise<IDBDatabase>((resolve,reject) => {
    const req = indexedDB.open(journalChannel,1);
    req.onupgradeneeded = () => {
      const pending = req.result.createObjectStore('pending',{keyPath:'seq',autoIncrement:true});
      pending.createIndex('owner','owner');
      pending.createIndex('eventId','event.id',{unique:true});
      const saved = req.result.createObjectStore('events',{keyPath:'key'});
      saved.createIndex('owner','owner');
      saved.createIndex('saved','saved');
      req.result.createObjectStore('leases',{keyPath:'owner'});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(error => {opening = undefined; throw error;});
  return opening;
}
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve,reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction)=>Promise<T>): Promise<T> {
  const db = await database();
  const tx = db.transaction(stores,mode);
  const done = new Promise<void>((resolve,reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Local save was interrupted.'));
    tx.onerror = () => reject(tx.error);
  });
  try { const [value] = await Promise.all([run(tx), done]); return value; }
  catch(error) { try {tx.abort();} catch { /* Already finished. */ } throw error; }
}

export function readWrites(owner:string) {
  return transaction(['pending'],'readonly',tx =>
    result<QueuedWrite[]>(tx.objectStore('pending').index('owner').getAll(owner)));
}
export function readOwnEvents(owner:string) {
  return transaction(['events'],'readonly',async tx =>
    (await result<Saved[]>(tx.objectStore('events').index('owner').getAll(owner))).map(row=>row.event));
}
export async function enqueueWrite(owner:string, data:{event:NostrEvent} | {change:Change}) {
  await transaction(['pending'],'readwrite',async tx => {
    const store = tx.objectStore('pending');
    if ('event' in data && await result(store.index('eventId').getKey(data.event.id)) !== undefined) return;
    if (await result(store.index('owner').count(owner)) >= 2000) throw new Error('The local outbox is full. Sync pending changes before adding more.');
    await result(store.add({owner,...data,attempts:0,retryAt:0}));
  });
}
export function updateWrites(ids:number[], patch:Partial<Pick<QueuedWrite,'attempts'|'retryAt'|'error'|'hold'|'prepared'>>) {
  return transaction(['pending'],'readwrite', async tx => {
    const store = tx.objectStore('pending');
    for (const id of ids) {
      const row:QueuedWrite|undefined = await result(store.get(id));
      if (row) await result(store.put({...row,...patch}));
    }
  });
}
function replaceable(kind:number) { return kind === 0 || kind === 3 || kind === 10000; }
async function saveEvent(store:IDBObjectStore,event:NostrEvent) {
  const key = replaceable(event.kind) ? event.pubkey+':'+event.kind : event.id;
  const old:Saved|undefined = await result(store.get(key));
  if (old && (old.event.created_at > event.created_at || (old.event.created_at === event.created_at && old.event.id <= event.id))) return;
  await result(store.put({key,owner:event.pubkey,event,saved:Date.now()} satisfies Saved));
}
// The queue is never evicted. Keep recent delivered activity for offline reopening;
// replaceable baselines have one record per profile and kind.
async function trimHistory(store:IDBObjectStore) {
  let extra = await result(store.count()) - 1600;
  if (extra <= 0) return;
  const request = store.index('saved').openCursor();
  await new Promise<void>((resolve,reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || extra <= 0) return resolve();
      if (!replaceable((cursor.value as Saved).event.kind)) {cursor.delete();extra--;}
      cursor.continue();
    };
  });
}
export function cacheOwnEvents(events:NostrEvent[]) {
  return transaction(['events'],'readwrite', async tx => {
    const store = tx.objectStore('events');
    for (const event of events) await saveEvent(store,event);
    await trimHistory(store);
  });
}
export function finishWrites(ids:number[], event?:NostrEvent) {
  return transaction(['pending','events'],'readwrite', async tx => {
    const events = tx.objectStore('events');
    if (event) await saveEvent(events,event);
    for (const id of ids) await result(tx.objectStore('pending').delete(id));
    await trimHistory(events);
  });
}
// Older browsers without Web Locks can still coordinate a short-lived delivery lease.
export function claimLease(owner:string, token:string, release=false) {
  return transaction(['leases'],'readwrite', async tx => {
    const store=tx.objectStore('leases'), now=Date.now(), lease=await result(store.get(owner));
    if (release) {if (lease?.token===token) await result(store.delete(owner));return true;}
    if (lease && lease.token!==token && lease.until>now) return false;
    await result(store.put({owner,token,until:now+120000}));return true;
  });
}

export function mergeChanges(kind:0|3|10000, changes:readonly Change[], base?:NostrEvent) {
  let tags = base?.tags ?? [], content = base?.content ?? '';
  if (kind === 0) {
    let metadata:Record<string,unknown> = {};
    if (content) {
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The current profile metadata is invalid.');
      metadata = parsed;
    }
    for (const change of changes) if (change.kind===0) Object.assign(metadata,change.fields);
    content=JSON.stringify(metadata);
  } else {
    for (const change of changes) {
      if (change.kind!==kind) continue;
      const present=tags.some(tag=>tag[0]==='p' && tag[1]===change.key);
      if (change.enabled && !present) tags=[...tags,['p',change.key]];
      if (!change.enabled && present) tags=tags.filter(tag=>!(tag[0]==='p' && tag[1]===change.key));
    }
  }
  return {kind,tags,content};
}
