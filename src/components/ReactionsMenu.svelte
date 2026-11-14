<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { observeReferences, profiles } from '../lib/network';
  import { profileUrl } from '../lib/profile-url';
  import { displayName } from '../lib/ui';
  import ProxyAvatar from './ProxyAvatar.svelte';

  export let likers: string[];
  let panel: HTMLDivElement, trigger: HTMLElement | undefined;
  let open = false, left = 0, top = 0, stopNames = () => {};
  const LIMIT = 100;
  $: shown = likers.slice(0, LIMIT);
  onDestroy(() => { stopNames(); removeEventListener('pointerdown', outside, true); });
  // Manual popover: auto light-dismiss would close it when the long-press finger lifts.
  function outside(event: PointerEvent) {
    const target = event.target as Node;
    if (!panel.contains(target) && !trigger?.contains(target)) panel.hidePopover();
  }

  export async function show(button: HTMLElement) {
    if (open) return;
    trigger = button;
    stopNames();
    stopNames = observeReferences([], shown.slice(0, 24));
    panel.showPopover();
    await tick();
    const bounds = button.getBoundingClientRect(), box = panel.getBoundingClientRect();
    left = Math.max(8, Math.min(bounds.left, innerWidth - box.width - 8));
    top = bounds.bottom + 6 + box.height <= innerHeight - 8 ? bounds.bottom + 6 : Math.max(8, bounds.top - box.height - 6);
    panel.querySelector<HTMLElement>('a')?.focus({preventScroll:true});
  }
  function close() { panel.hidePopover(); trigger?.focus({preventScroll:true}); }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const links = [...panel.querySelectorAll<HTMLAnchorElement>('a')];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === 'ArrowDown' ? (i + 1) % links.length : event.key === 'ArrowUp' ? (i - 1 + links.length) % links.length : -1;
    if (next < 0 || !links.length) return;
    event.preventDefault(); links[next].focus();
  }
</script>

<div class="reactions" bind:this={panel} popover="manual" role="dialog" tabindex="-1" aria-label="Upvotes"
  style:left={left + 'px'} style:top={top + 'px'} onkeydown={keys}
  ontoggle={event => {
    open = event.newState === 'open';
    if (open) addEventListener('pointerdown', outside, true);
    else { stopNames(); removeEventListener('pointerdown', outside, true); }
  }}>
  <header>Upvotes · {likers.length}</header>
  {#if likers.length}
    <ul>
      {#each shown as pubkey (pubkey)}
        <li><a href={profileUrl(pubkey)} onclick={() => panel.hidePopover()}>
          <ProxyAvatar {pubkey} profile={$profiles[pubkey]} size={24}/><span>{displayName(pubkey, $profiles[pubkey])}</span></a></li>
      {/each}
    </ul>
    {#if likers.length > LIMIT}<p>and {likers.length - LIMIT} more</p>{/if}
  {:else}<p>No upvotes yet</p>{/if}
</div>

<style>
  .reactions {position:fixed;inset:auto;margin:0;width:min(260px,calc(100vw - 16px));max-height:min(360px,60vh);overflow:auto;
    padding:6px;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgb(0 0 0 / .25)}
  header {padding:6px 8px 8px;font-size:12px;font-weight:650;color:var(--muted)}
  ul {list-style:none;margin:0;padding:0}
  a {display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:7px;color:var(--ink);text-decoration:none;font-size:14px;min-width:0}
  a:hover, a:focus-visible {background:var(--surface)}
  a :global(img) {border-radius:50%;flex:none}
  span {overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  p {margin:4px 8px 6px;font-size:13px;color:var(--muted)}
</style>
