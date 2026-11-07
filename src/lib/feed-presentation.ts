import { writable } from 'svelte/store';

function sameOrder(a: string[], b: string[]) {
  return a === b || (a.length === b.length && a.every((id, i) => id === b[i]));
}

/** Store IDs only: visibility and card content stay live while ranked arrivals are batched. */
export function createFeedPresentation(viewportSlots: () => number) {
  let shown: string[] = [], latest: string[] = [], scope: string | undefined;
  let pending = false, active = false;
  const store = writable({ ids: shown, pending });
  let timer: ReturnType<typeof setTimeout> | undefined, started = 0;
  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    started = 0;
  }
  function set(ids: string[], hasPending: boolean) {
    if (sameOrder(ids, shown)) ids = shown;
    if (ids === shown && hasPending === pending) return;
    shown = ids;
    pending = hasPending;
    store.set({ ids, pending });
  }
  function flush() {
    cancel();
    const slots = shown.length ? viewportSlots() : 0;
    const retained = shown.slice(0, slots);
    // If even the next empty slot is on screen, wait before extending a short feed.
    const hasPending = retained.some((id, i) => latest[i] !== id)
      || (slots > shown.length && latest.length > shown.length);
    if (!hasPending) {
      set(latest, false);
    } else if (slots > shown.length) {
      set(shown, true);
    } else {
      const existing = new Set(retained);
      set([...retained, ...latest.filter(id => !existing.has(id))], true);
    }
  }
  function schedule() {
    started ||= performance.now();
    clearTimeout(timer);
    // A bounded burst window. Measure the viewport when the batch actually paints.
    timer = setTimeout(flush, Math.max(0, Math.min(120, 480 - (performance.now() - started))));
  }
  return {
    subscribe: store.subscribe,
    viewportChanged() {
      if (active && pending && timer === undefined) schedule();
    },
    update(nextScope: string, ids: string[], isActive: boolean) {
      latest = ids;
      active = isActive;
      if (scope !== nextScope) {
        cancel();
        scope = nextScope;
        // A deliberate sort/profile change applies once, without blanking cards.
        if (shown.length) set(latest, false);
      }
      const available = new Set(latest);
      const permitted = shown.filter(id => available.has(id));
      if (permitted.length !== shown.length) set(permitted, pending);
      if (sameOrder(shown, latest)) {
        cancel();
        set(shown, false);
      } else if (active) {
        schedule();
      } else {
        cancel();
      }
    },
    reveal() { cancel(); set(latest, false); },
    destroy: cancel,
  };
}
