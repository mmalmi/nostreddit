import { writable } from 'svelte/store';

/** Keep painted rows in place while relay history, graph scores and reactions
 * arrive independently. Store IDs only: visibility and content stay live. */
export function createFeedPresentation(viewportCount: () => number) {
  const store = writable<string[]>([]);
  let shown: string[] = [], latest: string[] = [], scope: string | undefined;
  let mixUnread = false, readCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, started = 0;
  const cancel = () => { clearTimeout(timer); timer = undefined; started = 0; };
  const set = (ids: string[]) => { shown = ids; store.set(ids); };
  function markRead() {
    if (mixUnread) readCount = Math.max(readCount, Math.min(shown.length, viewportCount()));
  }
  function flush() {
    cancel();
    markRead();
    const retained = mixUnread ? shown.slice(0, readCount) : shown;
    const existing = new Set(retained);
    const next = [...retained, ...latest.filter(id => !existing.has(id))];
    if (next.length !== shown.length || next.some((id, i) => id !== shown[i])) set(next);
  }
  return {
    subscribe: store.subscribe,
    markRead,
    update(nextScope: string, ids: string[], active: boolean, rankUnread: boolean) {
      latest = ids;
      mixUnread = rankUnread;
      if (scope !== nextScope) {
        const alreadyPainted = shown.length > 0;
        cancel(); scope = nextScope; readCount = 0;
        // A deliberate sort/profile change applies once, without blanking cards.
        set(alreadyPainted ? latest : []);
      }
      const available = new Set(latest);
      const permitted = shown.filter(id => available.has(id));
      if (permitted.length !== shown.length) {
        markRead();
        readCount = shown.slice(0, readCount).filter(id => available.has(id)).length;
        set(permitted);
      }
      if (!active) { cancel(); return; }
      // All shown IDs are permitted. New IDs always need a flush; ranking
      // changes alone only affect Home Hot below the reader's high-water mark.
      if (latest.length === shown.length) {
        const read = new Set(shown.slice(0, readCount));
        if (!mixUnread || latest.filter(id => !read.has(id)).every((id, i) => id === shown[readCount + i])) {
          cancel(); return;
        }
      }
      started ||= performance.now();
      clearTimeout(timer);
      // A bounded burst window, never a background polling timer.
      timer = setTimeout(flush, Math.max(0, Math.min(120, 480 - (performance.now() - started))));
    },
    reveal() { cancel(); readCount = 0; set([...latest]); },
    destroy: cancel,
  };
}
