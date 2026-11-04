import { writable } from 'svelte/store';
import type { Event as NostrEvent } from 'nostr-tools';
import { snapshotRoot, type GraphBadge, type GraphRequest, type GraphReply } from './graph-model';

export const graphInfo = writable<Record<string, GraphBadge>>({});
export const graphStatus = writable<'loading' | 'ready' | 'unavailable'>('loading');

let root = snapshotRoot;
let authors: string[] = [];
let authorKey = '';
let version = 0;
let busy = false;
let scheduled = false;
let failed = false;
let worker: Worker | undefined;
const pending = new Map<string, NostrEvent>();
const hex = /^[a-f0-9]{64}$/;

function unavailable() {
  failed = true;
  busy = false;
  worker?.terminate();
  worker = undefined;
  graphInfo.set({});
  graphStatus.set('unavailable');
}

function schedule() {
  if (scheduled || busy || failed || typeof Worker === 'undefined' || document.hidden) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    if (document.hidden) return;
    try {
      if (!worker) {
        worker = new Worker(new URL('./graph-worker.ts', import.meta.url), { type: 'module' });
        worker.onerror = unavailable;
        worker.onmessage = ({ data }: MessageEvent<GraphReply>) => {
          busy = false;
          if ('error' in data) return unavailable();
          if (data.version !== version) return schedule();
          graphInfo.set(data.badges);
          graphStatus.set('ready');
        };
      }
      const events = [...pending.values()];
      pending.clear();
      busy = true;
      worker.postMessage({ root, authors, events, version } satisfies GraphRequest);
    } catch { unavailable(); }
  }, 40);
}

export function observeAuthors(pubkeys: readonly string[]) {
  const next = [...new Set(pubkeys.filter(key => hex.test(key)))].slice(0, 256).sort();
  const key = next.join(',');
  if (key === authorKey) return;
  authorKey = key;
  authors = next;
  version++;
  schedule();
}

export function setGraphRoot(pubkey: string | null) {
  const next = pubkey && hex.test(pubkey) ? pubkey : snapshotRoot;
  if (root === next) return;
  root = next;
  pending.clear();
  graphInfo.set({});
  graphStatus.set('loading');
  version++;
  schedule();
}

// Only verified events for the viewer's own lists are admitted here by the network layer.
export function observeGraphEvent(event: NostrEvent) {
  if (event.pubkey !== root || (event.kind !== 3 && event.kind !== 10000) || event.tags.length > 20_000) return;
  const key = String(event.kind);
  const prev = pending.get(key);
  if (prev && (prev.created_at > event.created_at || prev.id === event.id)) return;
  pending.set(key, event);
  version++;
  schedule();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (pending.size || authors.length) && !busy) schedule();
  });
}
