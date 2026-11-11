import type { NostrEvent, NostrFilter } from 'nostr-pubsub';
import { matchesRetrieval } from './discussions';

// Each query has its own history: an old synonym result must not skip newer
// results for the original subject. undefined starts a query; null finishes it.
export type SearchCursors = (number | null | undefined)[];
export interface RelaySearchPage { events: NostrEvent[]; cursors: SearchCursors }
export interface SearchHistory {
  onEvent(event: NostrEvent): void;
  /** Called once, when every relay has finished its stored results or the bound passed. */
  onEose(status: {sources: readonly {complete: boolean}[]}): void;
}
/** Opens one filter's history and returns its close function. */
export type OpenSearch = (filter: NostrFilter, history: SearchHistory) => () => void;

// Matches are handed to `found` as each relay delivers them. The returned page
// only settles the bookkeeping that needs finished history: where the next page
// starts, and whether any relay answered at all.
export function readSearchPage(
  filters: NostrFilter[], cursors: SearchCursors, open: OpenSearch,
  found: (events: NostrEvent[]) => void = () => {}, signal?: AbortSignal,
): Promise<RelaySearchPage> {
  if (!filters.length || filters.every((_, index) => cursors[index] === null))
    return Promise.resolve({events: [], cursors: filters.map(() => null)});
  return new Promise((resolve, reject) => {
    const shown = new Map<string, NostrEvent>();
    const next: SearchCursors = filters.map((_, index) => cursors[index]);
    const closers: (() => void)[] = [];
    let waiting = 0, opening = true, responded = false, settled = false;
    const close = () => { for (const stop of closers.splice(0)) stop(); };
    const abort = () => {
      if (settled) return;
      settled = true; close(); reject(new Error('Search was interrupted. Try again.'));
    };
    const finish = () => {
      if (settled || opening || waiting) return;
      settled = true; close(); signal?.removeEventListener('abort', abort);
      if (!responded) reject(new Error('No search relay responded. Your results are still available. Try again.'));
      else resolve({events: [...shown.values()], cursors: next});
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, {once: true});
    filters.forEach((filter, index) => {
      const until = cursors[index];
      if (until === null) return;
      waiting++;
      const raw = new Map<string, number>();
      let ended = false;
      const stop = open({...filter, ...(until === undefined ? {} : {until})}, {
        onEvent(event) {
          if (settled || ended || !Number.isSafeInteger(event.created_at) || event.created_at < 0 ||
              event.created_at > (until ?? Math.floor(Date.now()/1000) + 600)) return;
          if (raw.has(event.id)) return;
          // Relays can together return more than one page. Show what belongs to the
          // newest page so far; anything older is read again by the next page.
          const page = filter.limit === undefined || raw.size < filter.limit ||
            event.created_at >= [...raw.values()].sort((a, b) => b - a)[filter.limit - 1];
          raw.set(event.id, event.created_at);
          if (!page || shown.has(event.id) || !matchesRetrieval(event, [filter])) return;
          shown.set(event.id, event);
          found([event]);
        },
        onEose(status) {
          if (settled || ended) return;
          ended = true; waiting--;
          if (raw.size || status.sources.some(source => source.complete)) responded = true;
          // A short page may just be a relay's own limit, or contain hidden authors.
          // Only an empty response establishes the end of that query's history.
          // Several relays can each fill the limit; continue below the newest page
          // so a sparse relay's old result does not skip a busier relay's history.
          const page = [...raw.values()].sort((a, b) => b - a).slice(0, filter.limit ?? raw.size);
          const oldest = page.at(-1);
          next[index] = oldest === undefined ? (status.sources.some(source => source.complete) ? null : until)
            : oldest > 0 ? oldest - 1 : null;
          finish();
        },
      });
      if (settled || ended) stop(); else closers.push(stop);
    });
    opening = false;
    finish();
  });
}
