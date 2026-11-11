<script lang="ts">
  import { onMount, tick } from 'svelte';
  import RouteView from './RouteView.svelte';
  import { warmGraph } from './lib/graph';
  import { start, clearRelaySearch, signerAuthUrl, cancelSignerRequests } from './lib/network';
  import { watchAppearance } from './lib/appearance';
  import { watchHotPreferences } from './lib/hot-preferences';
  import { watchFeedPreferences } from './lib/feed-preferences';

  type Entry = { id: string; url: string; scroll: number; focus?: HTMLElement;
    from?: string; anchor?: { node: HTMLElement; top: number } };
  const newEntry = (): Entry => ({ id: crypto.randomUUID(), url: location.pathname + location.search, scroll: 0 });
  let current = newEntry();
  let entries = [current];
  let recent = [current.id];
  let restoration = 0;
  let stopRestoring = () => {};
  function showSignerApproval(dialog: HTMLDialogElement) {
    dialog.showModal();
    return {destroy:() => dialog.close()};
  }
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
    stopRestoring();
    current.scroll = window.scrollY;
    const focused = document.activeElement;
    current.focus = focused instanceof HTMLElement ? focused : undefined;
    const view = document.querySelector<HTMLElement>('[data-route-active="true"]');
    const focusedCard = current.focus?.closest<HTMLElement>('.feed-list article');
    const cards = [...view?.querySelectorAll<HTMLElement>('.feed-list article') ?? []];
    const anchor = focusedCard && focusedCard.getBoundingClientRect().bottom > 80
      && focusedCard.getBoundingClientRect().top < innerHeight ? focusedCard
      : cards.find(card => card.getBoundingClientRect().top >= 80 && card.getBoundingClientRect().top < innerHeight)
        ?? cards.find(card => card.getBoundingClientRect().bottom > 80);
    current.anchor = anchor ? { node: anchor, top: anchor.getBoundingClientRect().top } : undefined;
    clearRelaySearch();
    current = entries.find(entry => entry.id === id) ?? { id, url: location.pathname + location.search, scroll: 0 };
    current.from = history.state?.nostredditFrom;
    recent = [...recent.filter(key => key !== id), id].slice(-6);
    entries = [...entries.filter(entry => entry.id !== id && recent.includes(entry.id)), current];
    await tick();
    if (version !== restoration) return;
    current.focus?.focus({ preventScroll: true });
    if (!current.focus?.isConnected) document.querySelector<HTMLElement>('[data-route-active="true"] main')?.focus({ preventScroll: true });
    const saved = current;
    const restore = () => {
      const anchor = saved.anchor;
      const top = anchor?.node.isConnected
        ? window.scrollY + anchor.node.getBoundingClientRect().top - anchor.top : saved.scroll;
      if (Math.abs(window.scrollY - top) > .5) window.scrollTo({ top, behavior: 'instant' });
    };
    restore();
    // A hidden feed can gain image dimensions before or just after returning.
    // Anchor the same card through that layout, and yield as soon as the reader acts.
    if (saved.anchor?.node.isConnected) {
      const target = document.querySelector<HTMLElement>('[data-route-active="true"]');
      const observer = new ResizeObserver(restore);
      if (target) observer.observe(target);
      const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
      const stop = () => {
        observer.disconnect(); clearTimeout(timeout);
        for (const input of inputs) window.removeEventListener(input, stop);
      };
      const timeout = setTimeout(stop, 1500);
      for (const input of inputs) window.addEventListener(input, stop, { passive: true });
      stopRestoring = stop;
    }
  }

  function navigate(path: string) {
    if (location.pathname + location.search === path) return;
    const entry = entries.find(entry => entry.url === path) ?? { ...newEntry(), url: path };
    history.pushState({ nostredditView: entry.id, nostredditFrom: current.id }, '', path);
    void activate(entry.id);
  }

  onMount(() => {
    const stop = start(location.pathname !== '/');
    warmGraph();
    const stopAppearance = watchAppearance();
    const stopHot = watchHotPreferences();
    const stopFeeds = watchFeedPreferences();
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
      stopRestoring();
      history.scrollRestoration = previousRestoration;
      stopFeeds(); stopHot(); stopAppearance(); stop();
    };
  });
</script>

{#each entries as entry (entry.id)}
  <div use:pauseHiddenView={entry.id === current.id} hidden={entry.id !== current.id} inert={entry.id !== current.id} data-route-active={entry.id === current.id} data-route-view={entry.id}>
    <RouteView active={entry.id === current.id} returnTo={entries.find(previous => previous.id === entry.from)?.url} {navigate} />
  </div>
{/each}
{#if $signerAuthUrl}
  <dialog class="modal signer-approval" aria-label="Signer approval" use:showSignerApproval oncancel={(event) => {event.preventDefault(); cancelSignerRequests()}}>
    <div class="dialog-content">
      <h2>Approve in your signer</h2>
      <p>Your signer needs your approval to continue.</p>
      <a class="primary wide" href={$signerAuthUrl} target="_blank" rel="noopener noreferrer">Approve in signer</a>
      <button class="text-button" onclick={cancelSignerRequests}>Cancel</button>
    </div>
  </dialog>
{/if}
