import { writable } from 'svelte/store';

/** Keep painted rows in place while relay history, graph scores and reactions
 * arrive independently. Store IDs only: visibility and content stay live. */
export function createFeedPresentation() {
  const store = writable<string[]>([]);
  let shown: string[] = [], latest: string[] = [], scope: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, started = 0;
  const cancel = () => { clearTimeout(timer); timer = undefined; started = 0; };
  const set = (ids: string[]) => { shown = ids; store.set(ids); };
  function flush() {
    cancel();
    const available = new Set(latest), existing = new Set(shown);
    set([...shown.filter(id => available.has(id)), ...latest.filter(id => !existing.has(id))]);
  }
  return {
    subscribe: store.subscribe,
    update(nextScope: string, ids: string[], active: boolean) {
      latest = ids;
      if (scope !== nextScope) {
        const alreadyPainted = shown.length > 0;
        cancel(); scope = nextScope;
        // A deliberate sort/profile change applies once, without blanking cards.
        set(alreadyPainted ? latest : []);
      }
      const available = new Set(latest);
      const permitted = shown.filter(id => available.has(id));
      if (permitted.length !== shown.length) set(permitted);
      if (!active) { cancel(); return; }
      const existing = new Set(shown);
      if (!latest.some(id => !existing.has(id))) { cancel(); return; }
      started ||= performance.now();
      clearTimeout(timer);
      // A bounded burst window, never a background polling timer.
      timer = setTimeout(flush, Math.max(0, Math.min(120, 480 - (performance.now() - started))));
    },
    reveal() { cancel(); set([...latest]); },
    destroy: cancel,
  };
}
