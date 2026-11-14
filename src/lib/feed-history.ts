import { HistoryCursor, relaySource, type NostrFilter, type NostrVerifiedEvent } from 'nostr-pubsub';
import type { FeedPageEnd } from './relayTypes';

export const historyPageSize = 90;

// Keep the next filter on the page so a backgrounded or restarted relay worker
// can resume it. Only verified network deliveries participate in the cursor.
export function trackFeedPage(relay: string, filter: NostrFilter) {
  const source = relaySource(new URL(relay).href);
  const cursor = new HistoryCursor(source.id, filter, Math.floor(Date.now()/1000) + 600, 1440);
  const page = cursor.beginPage()!;
  return {
    observe(event: NostrVerifiedEvent, from: string) {
      if (from === source.id) cursor.observe(page.token, {event, source, priority:0});
    },
    finish(complete: boolean): FeedPageEnd {
      const outcome = cursor.finishPage(page.token, complete ? 'complete' : 'partial');
      if (outcome.status === 'retry') return {state:'retry'};
      if (outcome.status === 'limited') return {state:'limited'};
      const next = cursor.beginPage();
      if (!next) return {state:'end'};
      const until = next.filter.until!;
      // Restore the ordinary page size once a dense boundary second is cleared.
      const limit = until === page.filter.until ? next.filter.limit! : historyPageSize;
      return {state:'more', until, limit, boundaryOnly:outcome.oldest === page.filter.until && until < page.filter.until!};
    },
  };
}

type OpenPage = (relay: string, until: number | undefined, limit: number, live: boolean,
  done: (page: FeedPageEnd) => void) => () => void;
export type FeedHistoryState = FeedPageEnd['state'] | 'loading';

export function openFeedHistory(relays: string[], open: OpenPage, changed: (state: FeedHistoryState, canFill:boolean) => void) {
  const sources = relays.map(relay => ({
    relay, until:undefined as number | undefined, limit:historyPageSize, state:'loading' as FeedHistoryState, autoPages:0,
  }));
  const stops = new Set<() => void>();
  const canFill = (source:typeof sources[number]) => source.state === 'more' && source.autoPages < 4;
  function update() {
    changed(sources.some(s => s.state === 'more') ? 'more' : sources.some(s => s.state === 'loading') ? 'loading'
      : sources.some(s => s.state === 'retry') ? 'retry' : sources.some(s => s.state === 'limited') ? 'limited' : 'end',
      sources.some(canFill));
  }
  function read(source: typeof sources[number], live: boolean, probeBoundary = true) {
    source.state = 'loading';
    let settled = false;
    const stop = open(source.relay, source.until, source.limit, live, page => {
      if (settled) return;
      settled = true;
      if (!live) { stop(); stops.delete(stop); }
      source.state = page.state;
      if (page.state === 'more') {
        source.until = page.until; source.limit = page.limit;
        // An inclusive page can contain only duplicates from the previous one.
        if (page.boundaryOnly && probeBoundary) read(source, false, false);
      }
      update();
    });
    stops.add(stop);
  }
  for (const source of sources) read(source, true);
  update();
  return {
    more(mode:'manual'|'automatic' = 'manual') {
      for (const source of sources) {
        if (mode === 'automatic') {
          if (!canFill(source)) continue;
          source.autoPages++;
        } else {
          source.autoPages = 0;
          if (source.state !== 'more' && source.state !== 'retry') continue;
        }
        read(source, false);
      }
      update();
    },
    close() { for (const stop of stops) stop(); stops.clear(); },
  };
}
