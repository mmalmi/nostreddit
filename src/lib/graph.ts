import { writable } from 'svelte/store';
import type { Event as NostrEvent } from 'nostr-tools';
import { summarizeProfileList, snapshotRoot, type RelationshipKind, type ProfileList, type ProfileRelations, type GraphBadge, type GraphRequest, type PendingEdges, type GraphReply } from './graph-model';

export const graphInfo = writable<Record<string, GraphBadge>>({});
export const graphViewer = writable(snapshotRoot);
export const graphDiscoveryRoot = writable(snapshotRoot);
export const graphStatus = writable<'loading' | 'ready' | 'unavailable'>('loading');
export const profileRelations = writable<ProfileRelations | null>(null);

const hex = /^[a-f0-9]{64}$/;
const batchSize = 256;
const maxAuthors = 12288;
const interested = new Set<string>();
const missing = new Set<string>();
const latestLists = new Map<string, NostrEvent>();
const pending = new Map<string, NostrEvent>();
const profileLists = new Map<string, ProfileList>();
let root = snapshotRoot;
let edges:PendingEdges = {follows:{},mutes:{}};
let edgeKey = JSON.stringify(edges);
let selectedProfile = '';
let selectedDirectory: RelationshipKind | null = null;
let profilePeers = new Set<string>(), graphPeers = new Set<string>();
let profileVersion = 0, profileDirty = false, version = 0;
let cached: Record<string, GraphBadge> = {};
let busy = false, scheduled = false, failed = false;
let ranking=false;
let worker: Worker | undefined;
let sentProfileVersion = -1;

function unavailable() {
  failed = true;
  busy = false;
  worker?.terminate(); worker = undefined;
  cached = {};
  graphInfo.set(cached); profileRelations.set(null); graphStatus.set('unavailable');
}

function schedule() {
  if (scheduled || busy || failed || typeof Worker === 'undefined' || document.hidden) return;
  if (!missing.size && !pending.size && !profileDirty) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    if (document.hidden) return;
    try {
      if (!worker) {
        worker = new Worker(new URL('./graph-worker.ts', import.meta.url), {type:'module'});
        worker.onerror = unavailable;
        worker.onmessage = ({data}: MessageEvent<GraphReply>) => {
          busy = false;
          if ('error' in data) return unavailable();
          if (data.version === version) {
            graphDiscoveryRoot.set(data.discoveryRoot);
            const accepted = Object.entries(data.badges).filter(([key]) => interested.has(key));
            if (accepted.length) {
              cached = {...cached, ...Object.fromEntries(accepted)};
              graphInfo.set(cached);
            }
            if (sentProfileVersion === profileVersion && data.profile?.subject === selectedProfile) profileRelations.set(data.profile);
            graphStatus.set('ready');
          }
          schedule();
        };
      }
      const authors: string[] = [];
      for (const key of missing) {
        authors.push(key); missing.delete(key);
        if (authors.length === batchSize) break;
      }
      const events = [...pending.values()];
      pending.clear();
      const profile = profileDirty ? selectedProfile : '';
      sentProfileVersion = profile ? profileVersion : -1;
      profileDirty = false;
      busy = true;
      worker.postMessage({root, ranking, edges, authors, events, version, profile, directory:selectedDirectory, lists:profile ? [...profileLists.values()] : []} satisfies GraphRequest);
    } catch { unavailable(); }
  }, 24);
}

function invalidate() {
  version++;
  if (Object.keys(cached).length) { cached = {}; graphInfo.set(cached); }
  for (const key of interested) missing.add(key);
  if (selectedProfile) profileDirty = true;
  graphStatus.set(failed ? 'unavailable' : 'loading');
  schedule();
}

// Register verified event authors before filtering presentation. Lookups are
// incremental and bounded; an idle tab with no new authors sends no requests.
export function observeEventAuthors(keys: readonly string[]) {
  let evicted = false;
  for (const key of keys) {
    if (!hex.test(key) || interested.has(key)) continue;
    if (interested.size >= maxAuthors) {
      const oldest = interested.values().next().value!;
      interested.delete(oldest); missing.delete(oldest);
      if (cached[oldest]) {
        if (!evicted) cached = {...cached};
        delete cached[oldest]; evicted = true;
      }
    }
    interested.add(key); missing.add(key);
  }
  if (evicted) graphInfo.set(cached);
  schedule();
}

export function observeAuthors(keys: readonly string[]) { observeEventAuthors(keys.slice(0,batchSize)); }

export function setGraphRanking(enabled:boolean) {
  if(ranking===enabled)return;
  ranking=enabled;invalidate();
}

export function setGraphRoot(pubkey: string | null) {
  const next = pubkey && hex.test(pubkey) ? pubkey : snapshotRoot;
  if (root === next) return;
  root = next;
  edges={follows:{},mutes:{}}; edgeKey=JSON.stringify(edges);
  pending.clear(); latestLists.clear(); profileLists.clear(); graphPeers.clear();
  profileRelations.set(null);
  invalidate();
  graphViewer.set(next);
}

export function setPendingEdges(next:PendingEdges) {
  const key=JSON.stringify(next);
  if (key===edgeKey) return;
  edges=next; edgeKey=key;
  invalidate();
}

export function setGraphPeers(peers: readonly string[]) {
  graphPeers = new Set(peers.slice(0,64));
  for (const [key, event] of latestLists) {
    if (event.pubkey !== root && !graphPeers.has(event.pubkey)) { latestLists.delete(key); pending.delete(key); }
  }
}

export function observeProfile(subject: string, peers: readonly string[], directory: RelationshipKind | null = null) {
  if (selectedProfile !== subject || selectedDirectory !== directory) {
    profileLists.clear(); profileRelations.set(null);
  }
  selectedProfile = subject; selectedDirectory = directory;
  profilePeers = new Set(peers);
  for (const key of profileLists.keys()) if (!selectedDirectory && key !== subject && !profilePeers.has(key)) profileLists.delete(key);
  profileVersion++; profileDirty = !!subject;
  if (subject) observeEventAuthors([subject]);
  schedule();
}

// Reverse-tag matches are candidates only. Admit other authors here exclusively after
// the contact-list query has checked their latest untagged kind-3 records.
export function observeDirectoryLists(subject: string, events: readonly NostrEvent[]) {
  if (selectedProfile !== subject) return;
  let changed = false;
  for (const event of events) {
    if (event.kind !== 3 || event.tags.length > 20000) continue;
    const previous = profileLists.get(event.pubkey);
    if (previous && (previous.at > event.created_at || (previous.at === event.created_at && previous.id <= event.id))) continue;
    profileLists.set(event.pubkey, summarizeProfileList(event,subject,root,selectedDirectory === 'following'));
    changed = true;
  }
  if (changed) { profileVersion++; profileDirty = true; schedule(); }
}

export function observeGraphEvent(event: NostrEvent) {
  if (event.tags.length > 20000 || (event.kind !== 3 && event.kind !== 10000)) return;
  if (event.kind === 3 && selectedProfile && (event.pubkey === selectedProfile || profilePeers.has(event.pubkey))) {
    observeDirectoryLists(selectedProfile,[event]);
  }
  if (event.pubkey !== root && !graphPeers.has(event.pubkey)) return;
  const key = event.kind + ':' + event.pubkey;
  const prev = latestLists.get(key);
  if (prev && (prev.created_at > event.created_at || (prev.created_at === event.created_at && prev.id <= event.id))) return;
  latestLists.set(key,event); pending.set(key,event);
  invalidate();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  window.addEventListener('online', () => {
    if (!failed) return;
    failed = false;
    for (const [key,event] of latestLists) pending.set(key,event);
    invalidate();
  });
}
