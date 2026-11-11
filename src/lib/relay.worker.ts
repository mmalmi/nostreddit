import { MemoryEventStore, NostrRuntime, type NostrEvent, type NostrFilter, type RuntimeSubscribeOptions, type RuntimeSubscription } from 'nostr-pubsub';
import { discussionKinds } from './posts';
import { focusedThread, VisitedThreads } from './visited-threads';
import { queryDirectory } from './contactDirectory';
import { relayFilters } from './discovery/discussions';
import { readSearchPage, type SearchHistory } from './discovery/relay-search';
import { planPostSearch } from './discovery/query';
import { checkSearch } from './search';
import { relayUrls, searchRelayUrls, testRelays, type Request, type Response } from './relayTypes';

const runtime = new NostrRuntime({
  relays: [], store: new MemoryEventStore(2300), batchWindowMs: 50,
  historyTimeoutMs: 6500, publishTimeoutMs: 8500, maxSubscriptions: 80,
});
let configuredRelayUrls = [...relayUrls];
let configuredSearchRelayUrls = [...searchRelayUrls];
let searchController = new AbortController();
const reply = (data: Response) => self.postMessage(data);
// Hand a request's results over as relays deliver them, a frame's worth at a time.
function streamTo(id: number) {
  let batch: NostrEvent[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (batch.length) reply({type:'found', id, events:batch});
    batch = [];
  };
  return {add(events: NostrEvent[]) { batch.push(...events); timer ??= setTimeout(flush, 30); }, flush};
}
// One-shot history as an open subscription: every event is reported on arrival.
function readHistory(filters: NostrFilter[], history: SearchHistory, options: RuntimeSubscribeOptions) {
  let ended = false;
  const sub: RuntimeSubscription = runtime.subscribe(filters, {
    onEvent: event => history.onEvent(event),
    onEose(status) { ended = true; queueMicrotask(() => sub.close()); history.onEose(status); },
  }, options);
  return () => { if (!ended) sub.close(); };
}
const watches = new Map<number, RuntimeSubscription>();
const queue = new Map<string, NostrEvent>();
let connectionState: 'live' | 'offline' | undefined;
function setConnection(connected:boolean) {
  const value = connected ? 'live' : 'offline';
  if (value !== connectionState) { connectionState = value; reply({type:'status',value}); }
}
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let cacheTimer: ReturnType<typeof setTimeout> | undefined;
const cacheKey = testRelays ? relayUrls.join(',') : 'public';
const visited = new VisitedThreads(cacheKey);
let delivery = Promise.resolve();
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('nostreddit-feed-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
}).catch(() => null);

function emit(event: NostrEvent) {
  if (event.content.length > 64000 || event.tags.length > ([3,10000].includes(event.kind) ? 20000 : 5000) ||
      !Number.isSafeInteger(event.created_at) || event.created_at < 0 || event.created_at > Date.now()/1000+600) return;
  queue.set(event.id, event);
  if (flushTimer === undefined) flushTimer = setTimeout(() => {
    const events = [...queue.values()];
    queue.clear();
    flushTimer = undefined;
    // Commit visited discussions before presenting this batch. A page reload can
    // terminate the worker as soon as the reader sees a reply.
    delivery = delivery.then(async () => {
      await visited.saveBatch(events).catch(() => {});
      reply({type: 'events', events});
    });
  }, 55);
}

async function saveSnapshot() {
  const db = await database;
  if (!db) return;
  const events = await runtime.store.query([
    { kinds: discussionKinds, limit: 200 }, { kinds: [0], limit: 170 },
    { kinds: [5, 7, 9735], limit: 200 }, { kinds: [3, 10000], limit: 40 },
  ]);
  // Bound disk use even when individual profiles or contact lists are enormous.
  let bytes = 0;
  const snapshot = events.filter(event => {
    const size = JSON.stringify(event).length;
    if (size > 120000 || bytes + size > 850000) return false;
    bytes += size;
    return true;
  });
  await new Promise<void>((resolve,reject) => {
    const tx = db.transaction('snapshots','readwrite');
    tx.objectStore('snapshots').put(snapshot,cacheKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function scheduleSnapshot() {
  if (cacheTimer !== undefined) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = undefined;
    void saveSnapshot().catch(() => {});
  }, 1200);
}

async function admitSnapshot(raw: unknown) {
  if (!Array.isArray(raw)) return;
  for (const event of raw.slice(0, 620)) {
    try {
      if (event && typeof event.content === 'string' && event.content.length < 64000 &&
          await runtime.ingest(event, 'snapshot')) emit(event);
    } catch { /* Discard invalid or malformed signed events individually. */ }
  }
}
async function restore() {
  const db = await database;
  if (!db) return;
  const events = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction('snapshots').objectStore('snapshots').get(cacheKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await admitSnapshot(events);
}
void restore().catch(() => {});

self.onmessage = async (message: MessageEvent<Request>) => {
  const req = message.data;
  if (req.type === 'configure') {
    searchController.abort();
    searchController = new AbortController();
    configuredRelayUrls = [...req.urls];
    const defaults = new Set(relayUrls.map(url => url.replace(/\/$/, '')));
    const selected = new Set(req.urls.map(url => url.replace(/\/$/, '')));
    const usingDefaults = defaults.size === selected.size && [...defaults].every(url => selected.has(url));
    configuredSearchRelayUrls = usingDefaults ? [...searchRelayUrls] : [...req.urls];
    runtime.setRelays(req.urls);
    return;
  }
  try {
    if (req.type === 'close') { visited.close(req.id); watches.get(req.id)?.close(); watches.delete(req.id); return; }
    if (req.type === 'watch') {
      const focus = req.live ? focusedThread(req.filters) : undefined;
      if (focus) void visited.open(req.id, focus, admitSnapshot).catch(() => {});
      const sub = runtime.subscribe(req.filters, {
        onEvent(event, info) {
          emit(event);
          if (!info.cached && /^wss?:/.test(info.source)) {
            scheduleSnapshot(); setConnection(true);
          }
        },
        onEose() {
          setConnection(runtime.getRelayStats().some(r => r.connected));
          if (!req.live) { sub.close(); watches.delete(req.id); }
        },
      }, {deadline: Date.now() + 6500});
      watches.set(req.id, sub);
      return;
    }
    if (req.type === 'publish') {
      const published = await runtime.publish(req.event, { requireAck: true });
      if (!published.remoteAccepted) {
        const rejection=published.sources.find(source=>source.error && /blocked:|invalid:|restricted:|rejected|denied/i.test(source.error));
        throw new Error(rejection ? 'Relay rejected this change: '+rejection.error : 'No relay has acknowledged this change yet.');
      }
      emit(req.event);
      await saveSnapshot().catch(() => {});
      reply({type: 'result', id: req.id, events: [req.event]});
      return;
    }
    if (req.type === 'contacts') {
      const stream = streamTo(req.id);
      try {
        const events = await queryDirectory(runtime, cacheKey, req, stream.add);
        stream.flush();
        reply({type:'result',id:req.id,events});
      } finally { stream.flush(); }
      return;
    }
    if (req.type === 'search') {
      const query = checkSearch(req.query);
      const filters = relayFilters(planPostSearch(query), req.expansion);
      if (!filters.length) { reply({type:'result', id:req.id, events:[], cursors:[]}); return; }
      // Only the newest search reads relays; its results stream to the page.
      searchController.abort();
      const {signal} = searchController = new AbortController();
      const stream = streamTo(req.id);
      try {
        const page = await readSearchPage(filters, req.cursors ?? [], (filter, history) => readHistory([filter], history, {
          cache: 'network-only', relays: filter.search ? configuredSearchRelayUrls : configuredRelayUrls,
          deadline: Date.now() + 6500, signal,
        }), stream.add, signal);
        stream.flush();
        reply({type:'result', id:req.id, events:[], cursors:page.cursors});
      } finally { stream.flush(); }
      return;
    }
    const result = await runtime.query([{ kinds: [req.kind], authors: [req.pubkey], limit: 1 }], {
      cache: 'network-only', deadline: Date.now() + 5500,
    });
    if (!result.sources.some(source => source.complete))
      throw new Error('Could not read your existing profile or follows. Try again when a relay is reachable.');
    if (result.events.some(e => e.created_at > Date.now()/1000 + 600))
      throw new Error('Your existing list has a future timestamp. Check your device clock before editing it.');
    reply({type: 'result', id: req.id, events: result.events});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relay request failed.';
    if (req.type === 'latest' || req.type === 'publish' || req.type === 'search' || req.type === 'contacts')
      reply({type: 'result', id: req.id, events: [], error: message});
  }
};
