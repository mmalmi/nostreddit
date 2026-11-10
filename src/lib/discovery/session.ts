import { writable } from 'svelte/store';
import type { Post } from '../posts';
import { collectFilterHints, type SearchPlan } from './query';
import { discussionDocument, noExpansion, type Expansion } from './discussions';
import type { SearchReply, SearchWork } from './messages';

type Status = 'idle' | 'loading' | 'ranking' | 'ready' | 'unavailable';
interface SearchState { status: Status; scores: ReadonlyMap<string, number>; expansion: Expansion }
const initial: SearchState = {status:'idle', scores:new Map(), expansion:noExpansion};

// One loaded model serves every search view. It follows the view being read and
// stays loaded for a minute after that view is left, so returning to results or
// refining a query reuses the model and the posts it has already read.
interface Holder { lost(): void }
let shared: Worker | undefined, holder: Holder | undefined, runs = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
function wake() { clearTimeout(idle); idle = undefined; }
function unload() {
  wake(); shared?.terminate(); shared = undefined;
  const previous = holder; holder = undefined; previous?.lost();
}

export function createSearchSession() {
  const store = writable(initial);
  let state = initial, watchdog: ReturnType<typeof setTimeout>;
  let run = 0, query = '', ids = '', paused = false;
  let pending: {plan: SearchPlan; posts: Post[]} | undefined;
  const busy = () => state.status === 'loading' || state.status === 'ranking';
  function set(next: SearchState) { state = next; store.set(next); }
  // The model moved to another view or was unloaded. Scores already published
  // remain valid. An unfinished window is ranked again when this view returns.
  const self: Holder = {lost() {
    clearTimeout(watchdog); pending = undefined;
    if (busy()) { run = 0; ids = ''; set({...state, status:'idle'}); }
  }};
  function stop() {
    clearTimeout(watchdog); pending = undefined; paused = false;
    if (holder === self) { holder = undefined; unload(); }
  }
  function failed() {
    // A failure nobody saw is retried when the reader returns.
    if (paused) { reset(); return; }
    stop();
    set({...initial, status:'unavailable'});
  }
  function armWatchdog() {
    clearTimeout(watchdog); watchdog = setTimeout(failed, 45000);
  }
  function reset() {
    if (!query) return;
    stop(); run = 0; query = ''; ids = ''; set(initial);
  }
  // A reader who opens a result usually comes straight back. Keep the ranking,
  // finish the window in progress and leave new arrivals for the return.
  function pause() {
    if (!query || paused) return;
    if (state.status === 'unavailable') { reset(); return; }
    paused = true; pending = undefined;
    // The unload timer also bounds a stalled model while nobody is looking.
    clearTimeout(watchdog);
    if (holder === self && idle === undefined) idle = setTimeout(unload, 60000);
  }
  function receive({data}: MessageEvent<SearchReply>) {
    if (data.run !== run) return;
    if (data.type === 'error') { failed(); return; }
    if (data.type === 'plan') set({...state, status:'ranking', expansion:data.expansion});
    else {
      const scores = new Map(state.scores);
      for (const [id, score] of data.scores) scores.set(id, score);
      set({...state, scores, status:data.done ? 'ready' : 'ranking'});
    }
    if (state.status === 'ready') {
      clearTimeout(watchdog);
      const next = pending; pending = undefined;
      if (next) update(next.plan, next.posts);
    }
  }
  function update(plan: SearchPlan | undefined, posts: Post[]) {
    if (!plan) { reset(); return; }
    if (paused) {
      paused = false;
      if (holder === self) { wake(); if (busy()) armWatchdog(); }
    }
    const window = posts.slice(0, 160);
    const nextIds = window.map(post => post.id).join(',');
    const same = query === plan.text;
    if (same && busy()) {
      // Let the current batch publish scores as new relay posts arrive. Cancelling
      // every batch on a busy feed can otherwise starve search indefinitely.
      pending = nextIds === ids ? undefined : {plan, posts:window};
      return;
    }
    if (same && (nextIds === ids || state.status === 'unavailable')) return;
    pending = undefined;
    query = plan.text; ids = nextIds; run = ++runs;
    const scores = new Map<string, number>();
    if (same) for (const post of window) {
      const existing = state.scores.get(post.id);
      if (existing !== undefined) scores.set(post.id, existing);
    }
    set({...initial, scores, expansion:same ? state.expansion : noExpansion, status:'loading'});
    try {
      if (holder !== self) { const previous = holder; holder = self; previous?.lost(); }
      wake();
      shared ??= new Worker(new URL('./meaning.worker.ts', import.meta.url), {type:'module'});
      shared.onerror = failed;
      shared.onmessageerror = failed;
      shared.onmessage = receive;
      armWatchdog();
      shared.postMessage({
        run, plan, documents:window.map(post => ({id:post.id,text:discussionDocument(post).text})),
        hints:collectFilterHints(window.map(p => p.event), window.map(p => p.topic)),
      } satisfies SearchWork);
    } catch { failed(); }
  }
  // A reader can request relays while the model is starting. Give planning a
  // short head start, then proceed with the literal subject on slow connections.
  function relayExpansion(text: string): Promise<Expansion> {
    if (query !== text || state.status !== 'loading') return Promise.resolve(query === text ? state.expansion : noExpansion);
    return new Promise(resolve => {
      const timer = setTimeout(() => { unsubscribe(); resolve(noExpansion); }, 2500);
      const unsubscribe = store.subscribe(value => {
        if (query !== text || value.status !== 'loading') {
          clearTimeout(timer); unsubscribe(); resolve(query === text ? value.expansion : noExpansion);
        }
      });
    });
  }
  return {subscribe:store.subscribe, update, pause, reset, relayExpansion};
}
