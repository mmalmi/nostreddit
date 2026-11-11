import { getEventHash, verifyEvent } from 'nostr-tools/pure';
import type { NostrEvent, NostrFilter, NostrRuntime, RuntimeSubscription } from 'nostr-pubsub';
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

type Completion = {sources: readonly {complete: boolean}[]};
// Read stored history through an open subscription so each event is handed on
// as its relay delivers it. Resolves whether any relay finished its history.
function readHistory(runtime:NostrRuntime, filters:NostrFilter[], onEvent:(event:NostrEvent)=>void, deadline:number) {
  return new Promise<boolean>(resolve => {
    const sub:RuntimeSubscription = runtime.subscribe(filters, {
      onEvent,
      onEose(status:Completion) {
        queueMicrotask(() => sub.close());
        resolve(status.sources.some(source => source.complete));
      },
    }, {cache:'network-only', deadline});
  });
}

// `found` receives every current-looking list as it arrives. The returned lists
// are the reconciled record once relay history has finished.
export async function queryDirectory(runtime:NostrRuntime, namespace:string, query:ContactQuery,
    found:(events:NostrEvent[])=>void = () => {}) {
  const {subject, mode} = query;
  if (!hex.test(subject)) throw new Error('Invalid profile.');
  const stored = await cachedSubject(namespace,subject);
  const previous = stored?.events ?? [];
  if (query.cacheOnly) {
    if (!stored || (mode === 'followers' && !stored.reverseChecked && !previous.some(event=>
      event.pubkey !== subject && event.tags.some(tag=>tag[0] === 'p' && tag[1] === subject)))) throw new Error('No cached directory.');
    return previous;
  }
  const supplied = [...new Set((query.authors || []).filter(key => hex.test(key)))];
  const fresh: NostrEvent[] = [];
  const nominated = new Set<string>(), reads: Promise<boolean>[] = [];
  let waiting: string[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  // Ask for each author's newest replaceable record without a #p condition.
  // Small groups keep the requests accepted by ordinary relays and bound relay traffic.
  const confirm = () => {
    clearTimeout(timer); timer = undefined;
    for (let i=0;i<waiting.length;i+=12) {
      const authors = waiting.slice(i,i+12);
      reads.push(readHistory(runtime, authors.map(author=>({kinds:[3],authors:[author],limit:1})), event => {
        if (event.kind !== 3 || !authors.includes(event.pubkey)) return;
        fresh.push(event); found([event]);
      }, Date.now()+6500));
    }
    waiting = [];
  };
  const nominate = (author:string) => {
    if (nominated.has(author) || nominated.size >= maximumAuthors) return;
    nominated.add(author); waiting.push(author);
    // Confirm nominees while the reverse lookup is still answering.
    if (waiting.length >= 12) confirm(); else timer ??= setTimeout(confirm,40);
  };
  let reverseChecked = false;
  if (mode === 'following') nominate(subject);
  else if (mode === 'check') supplied.slice(0,30).forEach(nominate);
  else {
    const filter = {kinds:[3], '#p':[subject], limit:maximumAuthors, ...(mode === 'mutual' ? {authors:supplied.slice(0,256)} : {})};
    // Reverse-tag hits nominate authors only: a retained superseded event is not proof of a current follow.
    const reverse = readHistory(runtime, [filter], event => nominate(event.pubkey), Date.now()+6500);
    const complete = await reverse;
    // Lists verified earlier are already on screen; recheck them in the remaining room.
    for (const event of previous)
      if (event.pubkey !== subject && (mode === 'followers' || supplied.includes(event.pubkey))) nominate(event.pubkey);
    reverseChecked = mode === 'followers' && complete;
    if (!nominated.size && !complete) throw new Error('No search relay responded.');
  }
  confirm();
  if (reads.length && !(await Promise.all(reads)).some(Boolean)) throw new Error('No relay returned contact lists.');
  if (fresh.length || reverseChecked) await remember(namespace,subject,fresh,reverseChecked).catch(()=>{});
  const latest = freshestContactLists([...previous,...fresh]);
  const relevant = mode === 'following' ? latest.filter(event=>event.pubkey === subject)
    : mode === 'check' ? latest.filter(event=>supplied.includes(event.pubkey)) : latest;
  return limitCache(subject,relevant);
}
