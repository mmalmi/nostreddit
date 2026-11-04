<script lang="ts">
  import { onMount, tick } from 'svelte';
  import RouteView from './RouteView.svelte';
  import { start, clearRelaySearch } from './lib/network';
  import { watchAppearance } from './lib/appearance';
  import { watchHotPreferences } from './lib/hot-preferences';

  type Entry = { id: string; url: string; scroll: number; focus?: HTMLElement };
  const newEntry = (): Entry => ({ id: crypto.randomUUID(), url: location.pathname + location.search, scroll: 0 });
  let current = newEntry();
  let entries = [current];
  let recent = [current.id];
  let restoration = 0;
  const previousRestoration = history.scrollRestoration;
  history.scrollRestoration = 'manual';
  history.replaceState({ ...history.state, nostredditView: current.id }, '');

  function pauseHiddenView(node: HTMLElement, active: boolean) {
    return { update(nextActive: boolean) {
      if (active && !nextActive) {
        node.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause());
        node.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
      }
      active = nextActive;
    } };
  }

  async function activate(id: string) {
    const version = ++restoration;
    current.scroll = window.scrollY;
    const focused = document.activeElement;
    current.focus = focused instanceof HTMLElement ? focused : undefined;
    clearRelaySearch();
    current = entries.find(entry => entry.id === id) ?? { id, url: location.pathname + location.search, scroll: 0 };
    recent = [...recent.filter(key => key !== id), id].slice(-6);
    entries = [...entries.filter(entry => entry.id !== id && recent.includes(entry.id)), current];
    await tick();
    if (version !== restoration) return;
    current.focus?.focus({ preventScroll: true });
    if (!current.focus?.isConnected) document.querySelector<HTMLElement>('[data-route-active="true"] main')?.focus({ preventScroll: true });
    window.scrollTo({ top: current.scroll, behavior: 'instant' });
  }

  function navigate(path: string) {
    if (location.pathname + location.search === path) return;
    const entry = entries.find(entry => entry.url === path) ?? { ...newEntry(), url: path };
    history.pushState({ nostredditView: entry.id }, '', path);
    void activate(entry.id);
  }

  onMount(() => {
    const stop = start();
    const stopAppearance = watchAppearance();
    const stopHot = watchHotPreferences();
    const pop = () => {
      let id = history.state?.nostredditView;
      if (typeof id !== 'string') {
        id = crypto.randomUUID();
        history.replaceState({ ...history.state, nostredditView: id }, '');
      }
      void activate(id);
    };
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      history.scrollRestoration = previousRestoration;
      stopHot(); stopAppearance(); stop();
    };
  });
</script>

{#each entries as entry (entry.id)}
  <div use:pauseHiddenView={entry.id === current.id} hidden={entry.id !== current.id} inert={entry.id !== current.id} data-route-active={entry.id === current.id} data-route-view={entry.id}>
    <RouteView active={entry.id === current.id} {navigate} />
  </div>
{/each}
