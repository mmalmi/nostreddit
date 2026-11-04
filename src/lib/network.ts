import { derived, get, writable, type Writable } from 'svelte/store';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type EventTemplate } from 'nostr-tools/pure';
import { decode, nsecEncode } from 'nostr-tools/nip19';
import type { NostrEvent, NostrFilter } from 'nostr-pubsub';
import { graphViewer, graphInfo, graphStatus, observeEventAuthors, observeGraphEvent, observeProfile, profileRelations, setGraphPeers, setGraphRoot } from './graph';
import { asPost, commentDraft, hexKey, postDraft, resolveCommunityThreads, topicSlug, type Post } from './posts';
import { snapshotRoot } from './graph-model';
import { authorPolicy, visibilitySettings } from './visibility';
import { matchesZapReceipt, signedZapAuthor, type ZapInvoice } from './zaps';
import { relayUrls, type Request, type Response } from './relayTypes';
import { readLocal, writeLocal } from './ui';
export { relayUrls, type Post };

export interface Profile {name:string; about:string; picture:string; banner:string; website:string; lud16:string; lud06:string; nip05:string; display_name:string}
export interface Account {pubkey:string; method:'local'|'extension'}
export const account = writable<Account|null>(null);
const rawPosts = writable<Post[]>([]), rawComments = writable<Post[]>([]);
const rawProfiles = writable<Record<string,Profile>>({});
const rawLikes = writable<Record<string,string[]>>({});
const rawReceipts = writable<Record<string,NostrEvent[]>>({});
export const follows = writable<string[]>([]), mutes = writable<string[]>([]);
export const status = writable<'loading'|'live'|'offline'>('loading');
const rawNotifications = writable<NostrEvent[]>([]);
let notificationOwner = '', pinnedThread = '', pinnedTopic = '', pinnedAuthor = '';
const roots = new Map<string,Post>(), replies = new Map<string,Post>();
const metadata = new Map<string,NostrEvent>(), contacts = new Map<string,NostrEvent>();
const muteEvents = new Map<string,NostrEvent>();
const reactions = new Map<string,Map<string,NostrEvent>>();
const reactionIds = writable(0);
const reactionTargets = new Map<string,string>();
const deleted = new Map<string,NostrEvent>();
const ownReactionTime = new Map<string,number>();
const rawCommunities = writable<NostrEvent[]>([]);
const keyStorage = 'nostreddit.account.v1';
let secret: Uint8Array | undefined;
const noop = () => {};
const newest = (a:NostrEvent, b?:NostrEvent) => !b || a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

// Keep verified source records available to relay routing, replaceable-event merges and deletions.
// Public readers see a projection that changes immediately with graph settings and viewer identity.
const viewerLists = derived([account, follows, mutes], ([session]) => {
  const viewer = session?.pubkey ?? snapshotRoot;
  const keys = (event?: NostrEvent) => new Set(event?.tags.filter(t => t[0] === 'p' && hexKey.test(t[1])).map(t => t[1]));
  return { viewer, follows: keys(contacts.get(viewer)), mutes: keys(muteEvents.get(viewer)) };
});
export const canSeeAuthor = derived([viewerLists, visibilitySettings, graphViewer, graphInfo, graphStatus],
  ([lists, options, graphRoot, info, status]) => {
    const sameViewer = lists.viewer === graphRoot;
    return authorPolicy(lists, options, sameViewer ? info : {}, sameViewer && status === 'ready');
  });
function visibleList<T extends {pubkey:string}>(raw: Writable<T[]>) {
  return derived([raw, canSeeAuthor], ([items, allowed]) => items.filter(item => allowed(item.pubkey)));
}
export const posts = visibleList(rawPosts), comments = visibleList(rawComments);
export const notifications = visibleList(rawNotifications), communities = visibleList(rawCommunities);
const readNotificationIds = writable(new Set<string>());
export const unreadNotificationIds = derived([notifications, readNotificationIds], ([events, read]) =>
  new Set(events.filter(event => !read.has(event.id)).map(event => event.id)));
export const profiles = derived([rawProfiles, canSeeAuthor], ([items, allowed]) =>
  Object.fromEntries(Object.entries(items).filter(([key]) => allowed(key))));
export const likes = derived([rawLikes, canSeeAuthor], ([items, allowed]) =>
  Object.fromEntries(Object.entries(items).map(([id, keys]) => [id, keys.filter(allowed)])) as Record<string,string[]>);

const zapAuthors = new WeakMap<NostrEvent, string | null>();
function zapAuthor(receipt: NostrEvent): string | null {
  if (zapAuthors.has(receipt)) return zapAuthors.get(receipt)!;
  const sender = signedZapAuthor(receipt);
  zapAuthors.set(receipt, sender);
  return sender;
}
export const receipts = derived([rawReceipts, canSeeAuthor], ([items, allowed]) =>
  Object.fromEntries(Object.entries(items).map(([id, events]) => [id, events.filter(event => {
    const key = zapAuthor(event);
    return key !== null && allowed(key);
  })])) as Record<string,NostrEvent[]>);
export const hiddenPostIds = derived([rawPosts, rawComments, canSeeAuthor], ([roots, replies, allowed]) =>
  new Set([...roots, ...replies].filter(post => !allowed(post.pubkey)).map(post => post.id)));

// Paying an invoice is an explicit user action, including guest zaps from an ephemeral key.
// Confirm it only against the exact signed request and provider; never expose raw receipt records.
export function watchZapPayment(id: string, zap: ZapInvoice, set: (confirmed:boolean) => void) {
  let paid = false;
  return rawReceipts.subscribe(records => {
    if (paid) return;
    paid = (records[id] ?? []).some(event => event.pubkey === zap.provider &&
      event.tags.some(t => t[0] === 'description' && t[1] === zap.description) && matchesZapReceipt(event, zap));
    set(paid);
  });
}

function jsonObject(input:string): Record<string,unknown> {
  try { const value = JSON.parse(input); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
const emptyProfile: Profile = {name:'',about:'',picture:'',banner:'',website:'',lud16:'',lud06:'',nip05:'',display_name:''};
function readProfile(event:NostrEvent) {
  const raw = jsonObject(event.content), clean = {...emptyProfile};
  for (const key of Object.keys(clean) as (keyof Profile)[]) {
    if (typeof raw[key] === 'string') clean[key] = (raw[key] as string).slice(0,5000);
  }
  return clean;
}
function ordered(map: Map<string,Post>, limit:number) {
  const result = [...map.values()].sort((a,b) => b.created_at-a.created_at || a.id.localeCompare(b.id));
  if (result.length <= limit) return result;
  const retained = new Set(result.filter(p => p.id===pinnedThread || p.root===pinnedThread && !!pinnedThread ||
    p.parent===pinnedThread && !!pinnedThread || p.topic===pinnedTopic || p.pubkey===pinnedAuthor).slice(0,160).map(p=>p.id));
  if (map.has(pinnedThread)) retained.add(pinnedThread);
  for (const post of result) {
    if (retained.size < limit) retained.add(post.id);
    else if (!retained.has(post.id)) map.delete(post.id);
  }
  return result.filter(p=>map.has(p.id));
}
function trimRecord<T>(record:Record<string,T>, limit:number) {
  const keys = Object.keys(record);
  for (const key of keys.slice(0,Math.max(0,keys.length-limit))) delete record[key];
}
function apply(events:NostrEvent[]) {
  const authors = new Set<string>();
  for (const event of events) {
    if (event.kind === 9735) {
      const sender = zapAuthor(event);
      if (sender) authors.add(sender);
    } else if ([0,1,7,1111,34550].includes(event.kind)) authors.add(event.pubkey);
  }
  if (authors.size) observeEventAuthors([...authors]);
  if (notificationOwner && get(account)?.pubkey === notificationOwner) {
    const matches = events.filter(e => [1,7,1111].includes(e.kind) && e.pubkey !== notificationOwner &&
      e.tags.some(t => t[0] === 'p' && t[1] === notificationOwner));
    if (matches.length) {
      const previous = get(rawNotifications), byId = new Map(previous.map(e => [e.id,e]));
      for (const event of matches) byId.set(event.id,event);
      if (byId.size !== previous.length) rawNotifications.set([...byId.values()].sort((a,b) => b.created_at-a.created_at || a.id.localeCompare(b.id)).slice(0,100));
    }
  }
  let rootsDirty = false, repliesDirty = false, profilesDirty = false, likesDirty = false, receiptsDirty = false;
  const ps = get(rawProfiles), ls = get(rawLikes), rs = get(rawReceipts);
  for (const event of events) {
    if (event.kind === 3 || event.kind === 10000) observeGraphEvent(event);
    if (event.kind === 3 && event.pubkey === get(account)?.pubkey && newest(event,contacts.get(event.pubkey))) {
      contacts.set(event.pubkey,event);
      updateFollows(event);
    } else if (event.kind === 10000 && event.pubkey === (get(account)?.pubkey ?? snapshotRoot) && newest(event,muteEvents.get(event.pubkey))) {
      muteEvents.set(event.pubkey,event);
      if (event.pubkey === (get(account)?.pubkey ?? snapshotRoot)) updateMutes(event);
    } else if (event.kind === 34550) {
      const previous = get(rawCommunities);
      if (!previous.some(e => e.id === event.id)) rawCommunities.set([event,...previous].slice(0,80));
    } else if (event.kind === 0 && newest(event,metadata.get(event.pubkey))) {
      metadata.set(event.pubkey,event); ps[event.pubkey] = readProfile(event); profilesDirty = true;
    } else if (event.kind === 5) {
      for (const tag of event.tags.filter(t => t[0] === 'e' && hexKey.test(t[1]))) {
        const key = event.pubkey+':'+tag[1], prior = deleted.get(key);
        if (prior && !newest(event,prior)) continue;
        deleted.set(key,event);
        const root = roots.get(tag[1]), comment = replies.get(tag[1]);
        if (root?.pubkey === event.pubkey && root.created_at <= event.created_at) { roots.delete(root.id); rootsDirty = true; }
        if (comment?.pubkey === event.pubkey && comment.created_at <= event.created_at) { replies.delete(comment.id); repliesDirty = true; }
        const target = reactionTargets.get(tag[1]);
        const entries = target && reactions.get(target);
        const reaction = entries && entries.get(tag[1]);
        if (!target || !entries || !reaction || reaction.pubkey !== event.pubkey || reaction.created_at > event.created_at) continue;
        reactionTargets.delete(reaction.id);
        entries.delete(reaction.id);
        if (![...entries.values()].some(r => r.pubkey === event.pubkey)) {
          ls[target] = (ls[target] || []).filter(k => k !== event.pubkey);
          likesDirty = true;
        }
      }
      while (deleted.size > 3000) deleted.delete(deleted.keys().next().value!);
    } else if (event.kind === 7 || event.kind === 9735) {
      const target = event.tags.filter(t => t[0] === 'e' && hexKey.test(t[1])).at(-1)?.[1];
      if (!target) continue;
      if (event.kind === 7 && ['', '+'].includes(event.content)) {
        const tombstone = deleted.get(event.pubkey+':'+event.id);
        if (tombstone && tombstone.created_at >= event.created_at) continue;
        const entries = reactions.get(target) || new Map<string,NostrEvent>();
        if (!entries.has(event.id) && entries.size < 1000) {
          entries.set(event.id,event); reactions.set(target,entries); reactionTargets.set(event.id,target);
          reactionIds.update(count => count+1);
          if (!ls[target]?.includes(event.pubkey)) { ls[target] = [...(ls[target] || []),event.pubkey]; likesDirty = true; }
        }
      } else if (event.kind === 9735 && zapAuthor(event) && !rs[target]?.some(receipt => receipt.id === event.id)) {
        rs[target] = [...(rs[target] || []),event].slice(-160); receiptsDirty = true;
      }
    } else if (!roots.has(event.id) && !replies.has(event.id)) {
      const tombstone = deleted.get(event.pubkey+':'+event.id);
      if (tombstone && tombstone.created_at >= event.created_at) continue;
      const post = asPost(event);
      if (!post) continue;
      if (post.parent) { replies.set(post.id,post); repliesDirty = true; }
      else { roots.set(post.id,post); rootsDirty = true; }
    }
  }
  if (rootsDirty) rawPosts.set(ordered(roots,700));
  if (repliesDirty) {
    resolveCommunityThreads(replies);
    rawComments.set(ordered(replies,1400));
  }
  if (profilesDirty) {
    while (metadata.size > 1500) {
      const key = metadata.keys().next().value!;
      if (key === get(account)?.pubkey) { const own = metadata.get(key)!; metadata.delete(key); metadata.set(key,own); continue; }
      metadata.delete(key); delete ps[key];
    }
    rawProfiles.set(ps);
  }
  if (likesDirty || reactionTargets.size > 4000) {
    trimRecord(ls,1200);
    for (const [key,entries] of reactions) {
      if (ls[key]) continue;
      for (const id of entries.keys()) reactionTargets.delete(id);
      reactions.delete(key);
    }
    while (reactionTargets.size > 4000) {
      const [id,key] = reactionTargets.entries().next().value!;
      reactionTargets.delete(id);
      const entries = reactions.get(key), old = entries?.get(id);
      entries?.delete(id);
      if (old && entries && ![...entries.values()].some(e=>e.pubkey===old.pubkey))
        ls[key] = (ls[key] || []).filter(k=>k !== old.pubkey);
    }
    rawLikes.set(ls);
  }
  if (receiptsDirty) { trimRecord(rs,600); rawReceipts.set(rs); }
}

type Interest = Extract<Request,{type:'watch'}>;
const interests = new Map<number,Interest>();
const waiting = new Map<number,{resolve:(events:NostrEvent[])=>void; reject:(reason:Error)=>void}>();
let seq = 0, worker: Worker|undefined, active = false, watching = false;
function shutdown() {
  worker?.terminate(); worker = undefined; watching = false;
  for (const {reject} of waiting.values()) reject(new Error('The connection closed. Please try again.'));
  waiting.clear();
}
function visible() { return document.visibilityState !== 'hidden'; }
function connect() {
  if (worker) return worker;
  const next = new Worker(new URL('./relay.worker.ts', import.meta.url), {type:'module'});
  worker = next;
  next.onmessage = ({data}:MessageEvent<Response>) => {
    if (worker !== next) return;
    if (data.type === 'events') apply(data.events);
    else if (data.type === 'status') status.set(data.value);
    else {
      const pending = waiting.get(data.id); waiting.delete(data.id);
      if (data.error) pending?.reject(new Error(data.error));
      else pending?.resolve(data.events);
      if (!visible() && !waiting.size) shutdown();
    }
  };
  next.onerror = () => { if (worker === next) { shutdown(); status.set('offline'); } };
  watching = visible();
  if (watching) for (const interest of interests.values()) next.postMessage(interest);
  return next;
}
function watch(filters:NostrFilter[], live = false) {
  if (!filters.length) return noop;
  const id = ++seq, interest:Interest = {type:'watch',id,filters,live};
  if (active && visible()) {
    const existing = worker;
    if (!existing) connect();
    worker?.postMessage(interest);
  }
  interests.set(id,interest);
  return () => { interests.delete(id); worker?.postMessage({type:'close',id} satisfies Request); };
}
function request(payload: {type:'publish';event:NostrEvent}|{type:'latest';kind:number;pubkey:string}|{type:'search';query:string}) {
  return new Promise<NostrEvent[]>((resolve,reject) => {
    const id = ++seq;
    let owner:Worker;
    try { owner = connect(); } catch { reject(new Error('Nostr connections are unavailable in this browser.')); return; }
    waiting.set(id,{resolve,reject}); owner.postMessage({...payload,id});
  });
}

export async function searchRelays(query: string): Promise<Post[]> {
  const events = await request({type:'search',query});
  apply(events);
  return events.map(asPost).filter((post): post is Post => !!post && !post.parent);
}

export const homeTopics = ['nostr','bitcoin','technology','art','photography','music','science','gaming','books','asknostr','memes','general'];
export function start() {
  active = true;
  restoreAccount();
  const home = watch([{kinds:[1,1111], '#t':homeTopics, limit:80}]);
  const unsub = account.subscribe(current => {
    setGraphRoot(current?.pubkey ?? null);
    updateFollows(current ? contacts.get(current.pubkey) : undefined);
    updateMutes(current ? muteEvents.get(current.pubkey) : undefined);
  });
  let ownStop = noop, stopNotifications = noop, friendsStop = noop;
  const own = account.subscribe(current => {
    ownStop();
    stopNotifications();
    stopNotifications = current ? loadNotifications(current.pubkey) : noop;
    ownStop = current ? watch([{kinds:[0,3,10000],authors:[current.pubkey],limit:3},{kinds:[1,1111],authors:[current.pubkey],limit:40}], true) : noop;
  });
  const friends = follows.subscribe(keys => {
    friendsStop();
    setGraphPeers(keys);
    const filters:NostrFilter[] = [];
    if (keys.length) filters.push({kinds:[3,10000], authors:keys.slice(0,64), limit:128});
    for (let i = 0; i < Math.min(2048, keys.length); i += 256) filters.push({kinds:[1,1111],authors:keys.slice(i,i+256),limit:40});
    friendsStop = watch(filters);
  });
  function syncVisibility() {
    if (visible()) {
      if (!worker) connect();
      else if (!watching) {
        watching = true;
        for (const interest of interests.values()) worker.postMessage(interest);
      }
    } else if (!waiting.size) shutdown();
    else if (worker && watching) {
      watching = false;
      for (const id of interests.keys()) worker.postMessage({type:'close',id} satisfies Request);
    }
  }
  document.addEventListener('visibilitychange',syncVisibility);
  const reconnect = () => {
    if (!visible()) return;
    if (!worker) { connect(); return; }
    for (const interest of interests.values()) {
      worker.postMessage({type:'close',id:interest.id} satisfies Request);
      worker.postMessage(interest);
    }
  };
  window.addEventListener('online',reconnect);
  return () => {
    document.removeEventListener('visibilitychange',syncVisibility);
    window.removeEventListener('online',reconnect);
    unsub(); own(); friends(); ownStop(); stopNotifications(); friendsStop(); home(); shutdown(); active = false;
  };
}
export function loadTopic(topic:string) {
  const slug = topicSlug(topic);
  if (!slug) return noop;
  pinnedTopic = slug;
  const stop = watch([{kinds:[1,1111],'#t':[slug],limit:90},{kinds:[34550],'#d':[slug],limit:3}], true);
  let last = '', closeAddress = noop;
  const unsubscribe = rawCommunities.subscribe(list => {
    const addresses = [...new Set(list.filter(e => e.tags.some(t => t[0] === 'd' && t[1] === slug))
      .map(e => '34550:'+e.pubkey+':'+slug))].sort().slice(0,3);
    if (last === addresses.join()) return;
    last = addresses.join(); closeAddress();
    closeAddress = addresses.length ? watch([{kinds:[1,1111],'#a':addresses,limit:60},{kinds:[1111],'#A':addresses,limit:60}]) : noop;
  });
  return () => { stop(); unsubscribe(); closeAddress(); if (pinnedTopic === slug) pinnedTopic = ''; };
}
export function loadProfile(pubkey:string) {
  if (!hexKey.test(pubkey)) return noop;
  pinnedAuthor = pubkey;
  const stop = watch([{kinds:[0],authors:[pubkey],limit:1},{kinds:[1,1111],authors:[pubkey],limit:80}]);
  let scope = '', labels = '', closeLists = noop, closeNames = noop;
  let peers: string[] = [];
  const syncLists = () => {
    const viewer = get(account)?.pubkey || '';
    const direct = viewer ? get(follows).slice(0,256) : [];
    const key = [viewer || 'guest', ...direct].join(',');
    if (scope === key) return;
    scope = key;
    peers = direct;
    observeProfile(pubkey, direct);
    closeLists();
    const filters: NostrFilter[] = [{kinds:[3], authors:[pubkey], limit:1}];
    if (direct.length) filters.push({kinds:[3], authors:direct, '#p':[pubkey], limit:60});
    closeLists = watch(filters);
  };
  const stopViewer = account.subscribe(syncLists), stopPeers = follows.subscribe(syncLists);
  const syncNames = () => {
    const social = get(profileRelations);
    const candidates = social?.subject === pubkey ? social.mutuals : [];
    observeEventAuthors([pubkey, ...candidates]);
    const permitted = get(canSeeAuthor);
    const known = permitted(pubkey) ? candidates.filter(permitted) : [];
    const key = [scope, ...known].join(',');
    if (labels === key) return;
    labels = key;
    closeNames();
    const filters: NostrFilter[] = known.length ? [{kinds:[0],authors:known,limit:known.length}] : [];
    // Check the latest lists for the displayed mutuals, including unfollows absent from reverse-tag queries.
    const refresh = known.filter(friend => peers.includes(friend)).slice(0,6);
    if (refresh.length) filters.push({kinds:[3],authors:refresh,limit:refresh.length});
    closeNames = watch(filters);
  };
  const stopLabels = profileRelations.subscribe(syncNames), stopPolicy = canSeeAuthor.subscribe(syncNames);
  return () => {
    stop(); stopViewer(); stopPeers(); stopLabels(); stopPolicy(); closeLists(); closeNames();
    if (pinnedAuthor === pubkey) { pinnedAuthor = ''; observeProfile('', []); }
  };
}
export function loadThread(id:string) {
  if (!hexKey.test(id)) return noop;
  pinnedThread = id;
  const stop = watch([{ids:[id]}, {kinds:[1,1111,7,9735],'#e':[id],limit:180},{kinds:[1111],'#E':[id],limit:140}],true);
  let scope = '', closeScope = noop;
  const check = () => {
    const thread = roots.get(id) || replies.get(id);
    if (!thread) return;
    const address = thread.event.tags.find(t => t[0] === 'A' && t[1]?.startsWith('34550:'))?.[1] || '';
    // A permalink to a nested NIP-10 comment needs its original root's replies.
    // Later descendants generally tag the root and immediate parent, not this focus.
    const root = thread.root !== id && hexKey.test(thread.root) ? thread.root : '';
    const next = root + '/' + address;
    if (next === scope) return;
    scope = next;
    closeScope();
    const filters: NostrFilter[] = [];
    if (root) filters.push({kinds:[1,1111], '#e':[root], limit:180}, {kinds:[1111], '#E':[root], limit:140});
    if (address) filters.push({kinds:[1111], '#A':[address], limit:180});
    closeScope = filters.length ? watch(filters, !!root) : noop;
  };
  const stopRoots = rawPosts.subscribe(check), stopReplies = rawComments.subscribe(check);
  return () => { stop(); stopRoots(); stopReplies(); closeScope(); if (pinnedThread === id) pinnedThread = ''; };
}
export function notificationPostId(event:NostrEvent) {
  return event.kind === 7 ? event.tags.filter(t => t[0] === 'e' && hexKey.test(t[1])).at(-1)?.[1] : event.id;
}
function storedReadIds(pubkey:string): string[] {
  const ids = readLocal<unknown>('readNotifications.'+pubkey, []);
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && hexKey.test(id)) : [];
}
export function readPostNotifications(id:string, events:NostrEvent[]) {
  if (!notificationOwner || get(account)?.pubkey !== notificationOwner) return;
  const read = get(readNotificationIds);
  const matches = events.filter(event => !read.has(event.id) &&
    (notificationPostId(event) === id || (event.kind !== 7 && asPost(event)?.parent === id)));
  if (!matches.length) return;
  const ids = new Set([...storedReadIds(notificationOwner), ...read, ...matches.map(event => event.id)]);
  // Keep room for older relay pages as well as the 100 events in the inbox.
  const recent = [...ids].slice(-1000);
  readNotificationIds.set(new Set(recent));
  writeLocal('readNotifications.'+notificationOwner, recent);
}
export function loadNotifications(pubkey:string) {
  if (!hexKey.test(pubkey) || get(account)?.pubkey !== pubkey) return noop;
  notificationOwner = pubkey; rawNotifications.set([]);
  const syncRead = () => readNotificationIds.set(new Set(storedReadIds(pubkey)));
  syncRead();
  const storageChanged = (event:StorageEvent) => {
    if (event.key === 'nostreddit.ui.readNotifications.'+pubkey || event.key === null) syncRead();
  };
  globalThis.addEventListener?.('storage',storageChanged);
  const stop = watch([{kinds:[1,7,1111],'#p':[pubkey],limit:100}],true);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; stop();
    globalThis.removeEventListener?.('storage',storageChanged);
    if (notificationOwner === pubkey) { notificationOwner = ''; rawNotifications.set([]); readNotificationIds.set(new Set()); }
  };
  const stopAccount = account.subscribe(current => { if (current?.pubkey !== pubkey) close(); });
  return () => { stopAccount(); close(); };
}
export function observeNotificationAuthors() {
  let authorKey = '', stopAuthors = noop, timer:ReturnType<typeof setTimeout>|undefined;
  const stopNames = notifications.subscribe(events => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const authors = [...new Set(events.map(e => e.pubkey))].sort().slice(0,60);
      if (authorKey === authors.join()) return;
      authorKey = authors.join(); stopAuthors();
      stopAuthors = authors.length ? watch([{kinds:[0],authors,limit:authors.length}]) : noop;
    },150);
  });
  return () => { stopNames(); clearTimeout(timer); stopAuthors(); };
}
export function observe(ids:string[]) {
  const visibleIds = [...new Set(ids)].filter(id => hexKey.test(id)).slice(0,60);
  if (!visibleIds.length) return noop;
  const authors = [...new Set(visibleIds.map(id => (roots.get(id) || replies.get(id))?.pubkey).filter((key):key is string => Boolean(key)))];
  const stats = watch([...(authors.length ? [{kinds:[0],authors,limit:authors.length}] : []), {kinds:[7,9735,1,1111,5],'#e':visibleIds,limit:190}]);
  let timer:ReturnType<typeof setTimeout>|undefined, last = '', closeDeletions = noop;
  const stop = reactionIds.subscribe(() => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      const ids = visibleIds.flatMap(id => [...(reactions.get(id)?.keys() || [])]).slice(0,220);
      const key = ids.join();
      if (key === last) return;
      last = key; closeDeletions();
      closeDeletions = ids.length ? watch([{kinds:[5],'#e':ids,limit:120}]) : noop;
    },220);
  });
  return () => { stop(); clearTimeout(timer); stats(); closeDeletions(); };
}
function updateFollows(event?:NostrEvent) {
  const keys = event?.tags.filter(t => t[0] === 'p' && hexKey.test(t[1])).map(t => t[1]) || [];
  const next = [...new Set(keys)], current = get(follows);
  if (current.length !== next.length || next.some((v,i) => v !== current[i])) follows.set(next);
}
function updateMutes(event?:NostrEvent) {
  const keys = event?.tags.filter(t => t[0] === 'p' && hexKey.test(t[1])).map(t => t[1]) || [];
  mutes.set([...new Set(keys)]);
}
function remember(session:Account, sk?:Uint8Array) {
  try { localStorage.setItem(keyStorage,JSON.stringify({...session,...(sk ? {nsec:nsecEncode(sk)} : {})})); }
  catch { throw new Error('Allow local storage to save your sign-in on this device.'); }
  secret?.fill(0); secret = sk; account.set(session);
}
function restoreAccount() {
  try {
    const raw = JSON.parse(localStorage.getItem(keyStorage) || 'null');
    if (!raw || !hexKey.test(raw.pubkey)) return;
    if (raw.method === 'local') {
      if (typeof raw.nsec !== 'string') return;
      const data = decode(raw.nsec as string);
      if (data.type !== 'nsec' || getPublicKey(data.data) !== raw.pubkey) return;
      secret = data.data;
    } else if (raw.method !== 'extension') return;
    account.set({pubkey:raw.pubkey,method:raw.method});
  } catch { /* Invalid or unavailable local account storage leaves guest mode active. */ }
}
type Extension = {getPublicKey():Promise<string>; signEvent(event:EventTemplate):Promise<NostrEvent>};
function extension() {
  const signer = (window as Window & {nostr?:Extension}).nostr;
  if (!signer) throw new Error('No Nostr signing extension was found. Install a NIP-07 signer or use a local key.');
  return signer;
}
export async function signInExtension() {
  const pubkey = await extension().getPublicKey();
  if (!hexKey.test(pubkey)) throw new Error('The extension returned an invalid public key.');
  remember({pubkey,method:'extension'});
}
export async function importAccount(input:string) {
  let sk:Uint8Array;
  try { const decoded = decode(input.trim()); if (decoded.type !== 'nsec') throw Error(); sk = decoded.data; getPublicKey(sk); }
  catch { throw new Error('Enter a valid Nostr secret key starting with nsec1.'); }
  remember({pubkey:getPublicKey(sk),method:'local'},sk);
}
export async function createProfile(name: string) {
  const displayName = name.trim();
  if (!displayName || displayName.length > 60) throw new Error('Choose a display name of up to 60 characters.');
  if (/nsec1[0-9a-z]+/i.test(displayName)) throw new Error('Use the secret key to sign in to your existing profile.');
  const sk = generateSecretKey();
  remember({ pubkey: getPublicKey(sk), method: 'local' }, sk);
  await publish({kind:0, tags:[], content:JSON.stringify({name:displayName, display_name:displayName})});
}
export function exportKey() {
  if (!secret) throw new Error('Your signing extension manages this key.');
  return nsecEncode(secret);
}
export function signOut() {
  localStorage.removeItem(keyStorage); secret?.fill(0); secret = undefined; retryEvents.clear(); account.set(null);
}
export async function signEvent(template:EventTemplate):Promise<NostrEvent> {
  const session = get(account);
  if (!session) throw new Error('Sign in to continue.');
  const signed = session.method === 'local' && secret ? finalizeEvent(template,secret) : structuredClone(await extension().signEvent(structuredClone(template)));
  if (!verifyEvent(signed) || signed.pubkey !== session.pubkey || signed.kind !== template.kind ||
      signed.content !== template.content || signed.created_at !== template.created_at || JSON.stringify(signed.tags) !== JSON.stringify(template.tags))
    throw new Error('Your signer returned an event that does not match this action.');
  if (get(account)?.pubkey !== session.pubkey) throw new Error('The signed-in profile changed. Please try again.');
  return signed;
}
type Draft = Omit<EventTemplate,'created_at'> & {created_at?:number};
// Reuse the signed event for a deliberate retry when a relay may have accepted
// the previous send but its acknowledgment was lost. Never resend on a timer.
const retryEvents = new Map<string,{signed:NostrEvent; expires:number}>();
async function publish(draft:Draft) {
  const owner = get(account)?.pubkey;
  if (!owner) throw new Error('Sign in to continue.');
  const key = JSON.stringify([owner,draft]);
  const retry = retryEvents.get(key);
  const event = retry && retry.expires > Date.now() ? retry.signed :
    await signEvent({...draft,created_at:draft.created_at ?? Math.floor(Date.now()/1000)});
  retryEvents.set(key,{signed:event,expires:Date.now()+300000});
  while (retryEvents.size > 12) retryEvents.delete(retryEvents.keys().next().value!);
  await request({type:'publish',event}); retryEvents.delete(key); apply([event]);
  return event;
}
export async function publishPost(data:Parameters<typeof postDraft>[0]) {
  return asPost(await publish(postDraft(data)))!;
}
export async function publishComment(parent:Post, body:string) {
  return asPost(await publish(commentDraft(parent,body)))!;
}
export async function like(post:Post) {
  const me = get(account);
  if (!me) throw new Error('Sign in to like a post.');
  if (get(rawLikes)[post.id]?.includes(me.pubkey)) return;
  const key = me.pubkey+':'+post.id;
  const created_at = Math.max(Math.floor(Date.now()/1000), (ownReactionTime.get(key) ?? 0)+1);
  const event = await publish({kind:7, created_at,tags:[['e',post.id,'',post.pubkey],['p',post.pubkey],['k',String(post.event.kind)]],content:'+'});
  ownReactionTime.set(key,event.created_at);
}
export async function unlike(post:Post) {
  const me = get(account);
  if (!me) throw new Error('Sign in to change your like.');
  const mine = [...(reactions.get(post.id)?.values() || [])].filter(event => event.pubkey === me.pubkey);
  if (!mine.length) return;
  const time = Math.max(Math.floor(Date.now()/1000),...mine.map(e => e.created_at));
  await publish({kind:5,created_at:time,tags:[...mine.map(e => ['e',e.id]),['k','7']],content:''});
  ownReactionTime.set(me.pubkey+':'+post.id,time);
}
let modifying = false;
async function updateReplaceable(kind:0|3|10000, create:(latest?:NostrEvent)=>Draft|null) {
  if (modifying) throw new Error('Please wait for your previous update.');
  const me = get(account);
  if (!me) throw new Error('Sign in to continue.');
  modifying = true;
  try {
    const candidates = await request({type:'latest',kind,pubkey:me.pubkey});
    const stored = (kind === 0 ? metadata : kind === 3 ? contacts : muteEvents).get(me.pubkey);
    const latest = [stored,...candidates].filter((e):e is NostrEvent => Boolean(e)).sort((a,b) => b.created_at-a.created_at || a.id.localeCompare(b.id))[0];
    if (get(account)?.pubkey !== me.pubkey) throw new Error('The signed-in profile changed. Please try again.');
    const draft = create(latest);
    if (draft) await publish({...draft,created_at:Math.max(Math.floor(Date.now()/1000),(latest?.created_at ?? 0)+1)});
  } finally { modifying = false; }
}
export async function saveProfile(fields:Partial<Profile>) {
  return updateReplaceable(0,event => {
    const raw = jsonObject(event?.content || '{}');
    for (const key of Object.keys(emptyProfile) as (keyof Profile)[]) if (typeof fields[key] === 'string') raw[key] = fields[key]!.trim().slice(0,5000);
    return {kind:0,tags:event?.tags ?? [],content:JSON.stringify(raw)};
  });
}
async function changePerson(kind:3|10000, pubkey:string, enabled:boolean) {
  if (!hexKey.test(pubkey)) throw new Error('This profile has an invalid public key.');
  return updateReplaceable(kind,event => {
    const tags = event?.tags ?? [], already = tags.some(t => t[0] === 'p' && t[1] === pubkey);
    if (already === enabled) return null;
    return {kind, content:event?.content ?? '', tags:enabled ? [...tags,['p',pubkey]] : tags.filter(t => !(t[0] === 'p' && t[1] === pubkey))};
  });
}
export const follow = (pubkey:string, followed:boolean) => changePerson(3,pubkey,followed);
export const mute = (pubkey:string, muted:boolean) => changePerson(10000,pubkey,muted);
