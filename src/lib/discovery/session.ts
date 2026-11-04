import { writable } from 'svelte/store';
import type { Post } from '../posts';
import { collectFilterHints, type SearchPlan } from './query';
import { discussionDocument, noExpansion, type Expansion } from './discussions';
import type { SearchReply, SearchWork } from './messages';

type Status = 'idle' | 'loading' | 'ranking' | 'ready' | 'unavailable';
interface SearchState { status: Status; scores: ReadonlyMap<string, number>; expansion: Expansion }
const initial: SearchState = {status:'idle', scores:new Map(), expansion:noExpansion};

export function createSearchSession() {
  const store = writable(initial);
  let state = initial, worker: Worker | undefined, watchdog: ReturnType<typeof setTimeout>;
  let run = 0, query = '', ids = '';
  function set(next: SearchState) { state = next; store.set(next); }
  function stop() {
    clearTimeout(watchdog); worker?.terminate(); worker = undefined;
  }
  function failed() {
    stop();
    set({...initial, status:'unavailable'});
  }
  function armWatchdog() {
    clearTimeout(watchdog); watchdog = setTimeout(failed, 45000);
  }
  function reset() {
    if (!query) return;
    run++; stop(); query = ''; ids = ''; set(initial);
  }
  function update(plan: SearchPlan | undefined, posts: Post[]) {
    if (!plan) { reset(); return; }
    const window = posts.slice(0, 160);
    const nextIds = window.map(post => post.id).join(',');
    const same = query === plan.text;
    if (same && (nextIds === ids || state.status === 'unavailable')) return;
    query = plan.text; ids = nextIds; run++;
    const scores = new Map<string, number>();
    if (same) for (const post of window) {
      const existing = state.scores.get(post.id);
      if (existing !== undefined) scores.set(post.id, existing);
    }
    set({...initial, scores, status:'loading'});
    try {
      if (!worker) {
        worker = new Worker(new URL('./meaning.worker.ts', import.meta.url), {type:'module'});
        worker.onerror = failed;
        worker.onmessageerror = failed;
        worker.onmessage = ({data}: MessageEvent<SearchReply>) => {
          if (data.run !== run) return;
          if (data.type === 'error') { failed(); return; }
          if (data.type === 'plan') set({...state, status:'ranking', expansion:data.expansion});
          else {
            const scores = new Map(state.scores);
            for (const [id, score] of data.scores) scores.set(id, score);
            set({...state, scores, status:data.done ? 'ready' : 'ranking'});
          }
          if (state.status === 'ready') clearTimeout(watchdog);
          else armWatchdog();
        };
      }
      armWatchdog();
      worker.postMessage({
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
  return {subscribe:store.subscribe, update, reset, relayExpansion};
}
