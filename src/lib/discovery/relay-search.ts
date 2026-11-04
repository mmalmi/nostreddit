import type { NostrEvent, NostrFilter, RuntimeQueryResult } from 'nostr-pubsub';
import { matchesRetrieval } from './discussions';

// Each query has its own history: an old synonym result must not skip newer
// results for the original subject. undefined starts a query; null finishes it.
export type SearchCursors = (number | null | undefined)[];
export interface RelaySearchPage { events: NostrEvent[]; cursors: SearchCursors }

export async function readSearchPage(
  filters: NostrFilter[], cursors: SearchCursors,
  query: (filter: NostrFilter) => Promise<RuntimeQueryResult>,
): Promise<RelaySearchPage> {
  if (!filters.length || filters.every((_, index) => cursors[index] === null))
    return {events: [], cursors: filters.map(() => null)};
  const pages = await Promise.all(filters.map(async (filter, index) => {
    const until = cursors[index];
    if (until === null) return {events: [], cursor: null, responded: false};
    const result = await query({...filter, ...(until === undefined ? {} : {until})});
    const raw = result.events.filter(event => Number.isSafeInteger(event.created_at) && event.created_at >= 0 &&
      event.created_at <= (until ?? Math.floor(Date.now()/1000) + 600));
    const responded = raw.length > 0 || result.sources.some(source => source.complete);
    // A short page may just be a relay's own limit, or contain hidden authors.
    // Only an empty response establishes the end of that query's history.
    const oldest = raw.length ? Math.min(...raw.map(event => event.created_at)) : undefined;
    const cursor = oldest === undefined ? (responded ? null : until) : oldest > 0 ? oldest - 1 : null;
    return {events: raw.filter(event => matchesRetrieval(event, [filter])), cursor, responded};
  }));
  if (!pages.some(page => page.responded))
    throw new Error('No search relay responded. Your results are still available. Try again.');
  return {
    events: [...new Map(pages.flatMap(page => page.events).map(event => [event.id, event])).values()],
    cursors: pages.map(page => page.cursor),
  };
}
