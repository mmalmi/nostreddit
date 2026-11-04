import type { NostrEvent, NostrFilter } from 'nostr-pubsub';
import { asPost, discussionKinds, hexKey, type Post } from './posts';

const maxThreads = 32;
const maxEvents = 180;
const maxThreadBytes = 384 * 1024;
const pendingEvents = 256;
const pendingBytes = 640 * 1024;
const encoder = new TextEncoder();
const sizeOf = (event: NostrEvent) => encoder.encode(JSON.stringify(event)).length;

export function focusedThread(filters: readonly NostrFilter[]): string | undefined {
  const ids = filters.find(filter => filter.ids?.length === 1)?.ids;
  if (ids && hexKey.test(ids[0]) && filters.some(filter => filter['#e']?.includes(ids[0]))) return ids[0];
}

// Preserve the actual focus, then its descendants. A focused comment belongs to
// the original root, so filtering solely on the signed root would lose its subtree.
export function threadRecords(focus: string, events: readonly NostrEvent[]): NostrEvent[] {
  const posts = new Map<string, Post>();
  const children = new Map<string, NostrEvent[]>();
  for (const event of events) {
    if (posts.has(event.id)) continue;
    const post = asPost(event);
    if (!post) continue;
    posts.set(event.id, post);
    if (post.parent) {
      let siblings = children.get(post.parent);
      if (!siblings) children.set(post.parent, siblings = []);
      siblings.push(event);
    }
  }
  const head = posts.get(focus);
  if (!head) return [];
  const newest = (a:NostrEvent,b:NostrEvent) => b.created_at-a.created_at || a.id.localeCompare(b.id);
  for (const group of children.values()) group.sort(newest);
  const queue = [head.event];
  // Signed root markers keep orphaned replies available while their parent is missing.
  const orphans = [...posts.values()].filter(p=>p.root===focus && !posts.has(p.parent))
    .map(p=>p.event).sort(newest);
  const result: NostrEvent[] = [], seen = new Set<string>();
  let bytes = 0;
  for (let i=0; i<queue.length && result.length<maxEvents; i++) {
    const event = queue[i];
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const size = sizeOf(event);
    if (bytes + size > maxThreadBytes) {
      if (event.id === focus) return [];
      continue;
    }
    bytes += size;
    result.push(event);
    const group = children.get(event.id);
    if (group) queue.push(...group);
    if (event.id === focus) queue.push(...orphans);
  }
  return result;
}

type Stored = {id:string; visited:number; ids:string[]; events:NostrEvent[]};
type Session = {focus:string; candidates:Map<string,{event:NostrEvent;bytes:number}>; bytes:number; known:Set<string>};

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve,reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class VisitedThreads {
  private sessions = new Map<number,Session>();
  private opening?: Promise<IDBDatabase>;
  constructor(private scope: string) {}

  private database() {
    if (!this.opening) {
      this.opening = new Promise<IDBDatabase>((resolve,reject) => {
        const req = indexedDB.open('nostreddit-visited:'+this.scope,1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore('threads',{keyPath:'id'});
          store.createIndex('visited','visited');
          store.createIndex('eventIds','ids',{multiEntry:true});
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch(error => {this.opening = undefined; throw error;});
    }
    return this.opening;
  }

  async open(watchId:number, focus:string, hydrate:(events:NostrEvent[])=>Promise<void>) {
    const session:Session = {focus, candidates:new Map(),bytes:0,known:new Set([focus])};
    this.sessions.set(watchId,session);
    const db = await this.database();
    const read = () => db.transaction('threads').objectStore('threads');
    const exact = await result<Stored | undefined>(read().get(focus));
    const stored = exact ?? await result<Stored | undefined>(read().index('eventIds').get(focus));
    if (!stored || !Array.isArray(stored.events) || this.sessions.get(watchId)!==session) return;
    // A previously seen reply can be opened by permalink without revisiting its root.
    const events = exact ? stored.events : threadRecords(focus,stored.events);
    for (const event of events) session.known.add(event.id);
    await hydrate(events);
  }
  close(watchId:number) { this.sessions.delete(watchId); }

  async saveBatch(events:NostrEvent[]) {
    if (!this.sessions.size) return;
    for (const session of this.sessions.values()) {
      let related = false;
      for (const event of events) {
        if (!discussionKinds.includes(event.kind)) continue;
        const post = asPost(event);
        if (!post || (post.id !== session.focus && !post.parent)) continue;
        if (session.known.has(post.id) || session.known.has(post.parent) || post.root===session.focus) related = true;
        if (session.candidates.has(event.id)) continue;
        const bytes = sizeOf(event);
        if (bytes > maxThreadBytes) continue;
        session.candidates.set(event.id,{event,bytes});
        session.bytes += bytes;
        // The focus might arrive after its children, or a NIP-22 parent after its replies.
        // Keep a small candidate window only while the corresponding route is open.
        while (session.candidates.size>pendingEvents || session.bytes>pendingBytes) {
          // An initial query can emit more than the staging limit at once. Protect the focus.
          const keys = session.candidates.keys();
          let key = keys.next().value!;
          if (key === session.focus) key = keys.next().value!;
          session.bytes -= session.candidates.get(key)!.bytes;
          session.candidates.delete(key);
        }
      }
      if (related) await this.merge(session);
    }
  }

  private async merge(session: Session) {
    const db = await this.database();
    // Re-read and merge inside one read/write transaction so two tabs viewing
    // the same discussion cannot clobber each other's newly discovered replies.
    const tx = db.transaction('threads','readwrite');
    const done = new Promise<void>((resolve,reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Thread cache update failed.'));
    });
    const store = tx.objectStore('threads');
    const update = async () => {
      const old = await result<Stored | undefined>(store.get(session.focus));
      const candidates = [...session.candidates.values()].map(value=>value.event);
      const events = threadRecords(session.focus,[...(old?.events || []),...candidates]);
      if (!events.length) return;
      session.known = new Set(events.map(event=>event.id));
      const now = Date.now();
      if (old && now-old.visited<60_000 && old.events.length===events.length &&
          old.events.every((event,i)=>event.id===events[i].id)) return;
      store.put({id:session.focus,visited:now,ids:events.map(event=>event.id),events} satisfies Stored);
      if (old) return;
      const excess = await result(store.count())-maxThreads;
      if (excess<=0) return;
      const oldest = await result(store.index('visited').getAllKeys(undefined,excess+1));
      for (const key of oldest.filter(key=>key!==session.focus).slice(0,excess)) store.delete(key);
    };
    await Promise.all([update(),done]);
  }
}
