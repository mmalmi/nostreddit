import { getEventHash, verifyEvent } from 'nostr-tools/pure';
import type { NostrEvent, NostrRuntime } from 'nostr-pubsub';
import type { ContactQuery } from './relayTypes';

const hex = /^[a-f0-9]{64}$/;
const maximumAuthors = 120;
const maximumSubjectBytes = 2_500_000;
type CachedDirectory = {subject: string; events: NostrEvent[]; reverseChecked: boolean; saved: number};

export function freshestContactLists(events: readonly NostrEvent[]): NostrEvent[] {
  const records = new Map<string,NostrEvent>();
  for (const event of events) {
    if (event.kind !== 3 || event.tags.length > 20000 || event.created_at > Date.now()/1000 + 600) continue;
    const previous = records.get(event.pubkey);
    if (!previous || event.created_at > previous.created_at || (event.created_at === previous.created_at && event.id < previous.id)) {
      records.set(event.pubkey,event);
    }
  }
  return [...records.values()];
}

let database: Promise<IDBDatabase|null> | undefined;
function db(namespace: string) {
  return database ??= new Promise<IDBDatabase>((resolve,reject) => {
    const req = indexedDB.open('nostreddit-directory-v1:' + namespace,1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('subjects',{keyPath:'subject'}).createIndex('saved','saved');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
}

const admitted = new Map<string,string>();
function verifyCached(event:NostrEvent) {
  try {
    // A page can read the same signed lists several times. Rehash a cache hit instead of repeating Schnorr verification.
    if (admitted.get(event.id) === event.sig && getEventHash(event) === event.id) return true;
    if (!verifyEvent(event)) return false;
    if (admitted.size >= 520) admitted.delete(admitted.keys().next().value!);
    admitted.set(event.id,event.sig);
    return true;
  } catch {return false;}
}

async function cachedSubject(namespace:string, subject:string) {
  const database = await db(namespace);
  if (!database) return null;
  const row = await new Promise<CachedDirectory|undefined>((resolve,reject) => {
    const req = database.transaction('subjects').objectStore('subjects').get(subject);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => undefined);
  return row ? {...row,events:row.events.filter(verifyCached)} : null;
}

function limitCache(subject:string, events:NostrEvent[]) {
  let bytes = 0;
  return freshestContactLists(events).sort((a,b) =>
    Number(b.pubkey === subject)-Number(a.pubkey === subject) || b.created_at-a.created_at || a.id.localeCompare(b.id)
  ).filter(event => {
    const size = JSON.stringify(event).length;
    if (bytes + size > maximumSubjectBytes) return false;
    bytes += size;
    return true;
  }).slice(0,260);
}

async function remember(namespace:string, subject:string, events:NostrEvent[], reverseChecked:boolean) {
  const database = await db(namespace);
  if (!database) return;
  await new Promise<void>((resolve,reject) => {
    // Merge inside one writer transaction so concurrent tabs can't roll the latest lists backward.
    const tx = database.transaction('subjects','readwrite'), store = tx.objectStore('subjects');
    const get = store.get(subject);
    get.onsuccess = () => {
      const old:CachedDirectory|undefined = get.result;
      store.put({subject, events:limitCache(subject,[...(old?.events || []),...events]),
        reverseChecked:reverseChecked || !!old?.reverseChecked, saved:Date.now()} satisfies CachedDirectory);
      const count = store.count();
      count.onsuccess = () => {
        let remove = count.result-12;
        if (remove <= 0) return;
        const cursor = store.index('saved').openKeyCursor();
        cursor.onsuccess = () => {
          if (cursor.result && remove-- > 0) {store.delete(cursor.result.primaryKey); cursor.result.continue();}
        };
      };
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function queryDirectory(runtime:NostrRuntime, namespace:string, query:ContactQuery) {
  const {subject, mode} = query;
  if (!hex.test(subject)) throw new Error('Invalid profile.');
  const stored = await cachedSubject(namespace,subject);
  const previous = stored?.events ?? [];
  if (query.cacheOnly) {
    if (!stored || (mode === 'followers' && !stored.reverseChecked && !previous.some(event=>
      event.pubkey !== subject && event.tags.some(tag=>tag[0] === 'p' && tag[1] === subject)))) throw new Error('No cached directory.');
    return previous;
  }
  let candidates: string[];
  let reverseChecked = false;
  const supplied = [...new Set((query.authors || []).filter(key => hex.test(key)))];
  const options = {cache:'network-only' as const, deadline:Date.now()+6500};
  if (mode === 'following') candidates = [subject];
  else if (mode === 'check') candidates = supplied.slice(0,30);
  else {
    const filter = {kinds:[3], '#p':[subject], limit:maximumAuthors, ...(mode === 'mutual' ? {authors:supplied.slice(0,256)} : {})};
    const result = await runtime.query([filter],options);
    reverseChecked = mode === 'followers' && result.sources.some(source => source.complete);
    // Reverse-tag hits nominate authors only: a retained superseded event is not proof of a current follow.
    candidates = [...new Set([...result.events.map(event=>event.pubkey), ...previous.filter(event =>
      event.pubkey !== subject && (mode === 'followers' || supplied.includes(event.pubkey))).map(event=>event.pubkey)])].slice(0,maximumAuthors);
    if (!candidates.length && !result.sources.some(source=>source.complete)) throw new Error('No search relay responded.');
  }
  const fresh: NostrEvent[] = [];
  if (candidates.length) {
    // Ask for each author's newest replaceable record without a #p condition.
    // Small groups keep the requests accepted by ordinary relays and bound relay traffic.
    const batches:string[][] = [];
    for(let i=0;i<candidates.length;i+=12) batches.push(candidates.slice(i,i+12));
    let complete = false;
    const deadline = Date.now()+6500;
    await Promise.all(batches.map(async authors => {
      const result = await runtime.query(authors.map(author=>({kinds:[3],authors:[author],limit:1})),
        {cache:'network-only',deadline});
      if (result.sources.some(source => source.complete)) {
        complete = true;
        fresh.push(...result.events.filter(event=>authors.includes(event.pubkey)));
      }
    }));
    if (!complete) throw new Error('No relay returned contact lists.');
  }
  if (fresh.length || reverseChecked) await remember(namespace,subject,fresh,reverseChecked).catch(()=>{});
  const latest = freshestContactLists([...previous,...fresh]);
  const relevant = mode === 'following' ? latest.filter(event=>event.pubkey === subject)
    : mode === 'check' ? latest.filter(event=>supplied.includes(event.pubkey)) : latest;
  return limitCache(subject,relevant);
}
