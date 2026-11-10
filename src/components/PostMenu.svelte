<script lang="ts">
  import { onDestroy } from 'svelte';
  import { noteEncode } from 'nostr-tools/nip19';
  import type { Post } from '../lib/posts';
  import Icon from './Icon.svelte';

  export let post: Post;
  export let saved = false;
  export let onaction: (action: string, post: Post) => void;
  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let dialog: HTMLDialogElement;
  let open = false;
  let status = '';
  let raw = '';
  let statusTimer: ReturnType<typeof setTimeout>;
  onDestroy(() => clearTimeout(statusTimer));
  let left = 0, top = 0;
  // Keep local annotations and application state out of the signed event.
  function eventJSON() {
    return JSON.stringify({
      id: post.event.id, pubkey: post.event.pubkey, created_at: post.event.created_at,
      kind: post.event.kind, tags: post.event.tags, content: post.event.content, sig: post.event.sig,
    }, null, 2);
  }

  function toggleMenu() {
    if (open) { closeMenu(); return; }
    status = '';
    const bounds = trigger.getBoundingClientRect();
    left = Math.max(8, Math.min(bounds.right - 224, innerWidth - 232));
    top = Math.max(8, Math.min(bounds.bottom + 6, innerHeight - 240));
    menu.showPopover();
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function closeMenu(restoreFocus = true) {
    menu.hidePopover();
    if (restoreFocus) trigger.focus({preventScroll:true});
  }
  function choose(action: string) { closeMenu(); onaction(action, post); }
  function showRaw() { closeMenu(); raw = eventJSON(); status = ''; dialog.showModal(); }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); status = label + ' copied'; }
    catch { if (!dialog.open) showRaw(); status = 'Could not copy. Select and copy the data below.'; }
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status = '', 4000);
  }
  async function copyFromMenu(value: string, label: string) {
    closeMenu();
    await copy(value,label);
  }
  function menuKeys(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') { closeMenu(); return; }
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length :
      event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length :
      event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); buttons[next].focus();
  }
  function closeOnBackdrop(event: MouseEvent) {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }
</script>

<svelte:window onresize={() => { if (open) closeMenu(false); }}/>
<div class="post-menu">
  <button class="menu-trigger" bind:this={trigger} type="button" aria-label="Post options" title="Post options"
    aria-haspopup="menu" aria-expanded={open} onclick={toggleMenu}><Icon name="more" size={20}/></button>
  <div class="menu-panel" bind:this={menu} popover="auto" role="menu" tabindex="-1" aria-label="Post options"
    style:left={left + 'px'} style:top={top + 'px'} onkeydown={menuKeys}
    ontoggle={event => { open = event.newState === 'open'; }}>
    <button role="menuitem" onclick={() => choose('copy-link')}><Icon name="link" size={17}/>Copy post link</button>
    <button role="menuitem" onclick={() => copyFromMenu(noteEncode(post.id),'Note ID')}><Icon name="copy" size={17}/>Copy note ID</button>
    <button role="menuitem" onclick={() => choose('save')}><Icon name="save" size={17}/>{saved ? 'Remove bookmark' : 'Save post'}</button>
    <div class="divider"></div>
    <button role="menuitem" onclick={showRaw}><Icon name="tech" size={17}/>View raw event</button>
    <button role="menuitem" onclick={() => copyFromMenu(eventJSON(),'Event JSON')}><Icon name="copy" size={17}/>Copy event JSON</button>
  </div>
  <span class="copy-status" role="status">{!dialog?.open ? status : ''}</span>
</div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Native dialog backdrop dismissal.) -->
<dialog class="raw-event" bind:this={dialog} aria-label="Raw Nostr event" onclick={closeOnBackdrop}
  onclose={() => { raw = ''; trigger.focus({preventScroll:true}); }}>
  <header><div><h3>Raw event</h3><p>The original signed Nostr data.</p></div>
    <button type="button" aria-label="Close raw event" onclick={() => dialog.close()}><Icon name="close" size={20}/></button>
  </header>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll and select the raw data.) -->
  <pre role="region" tabindex="0" aria-label="Event JSON">{raw}</pre>
  <footer><span role="status">{status}</span><button class="copy-json" type="button" onclick={() => copy(raw,'Event JSON')}><Icon name="copy" size={16}/>Copy JSON</button></footer>
</dialog>

<style>
  .post-menu {margin-left:auto;flex:none}
  .menu-trigger {display:grid;place-items:center;width:30px;height:30px;border-radius:7px;color:var(--muted)}
  .menu-trigger:hover,.menu-trigger[aria-expanded="true"] {background:var(--light);color:var(--accent)}
  .menu-trigger :global(svg) {stroke-width:4}
  .menu-panel {position:fixed;inset:auto;margin:0;width:224px;max-width:calc(100vw - 16px);padding:5px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--body-text);box-shadow:0 8px 30px #0003}
  .menu-panel button {display:flex;align-items:center;gap:10px;width:100%;min-height:40px;text-align:left;padding:8px 10px;border-radius:6px;font:500 13px var(--sans)}
  .menu-panel button:hover,.menu-panel button:focus-visible {background:var(--light);color:var(--accent)}
  .divider {height:1px;background:var(--line);margin:4px 6px}
  .copy-status:empty {display:none}
  .copy-status {position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:1000;background:var(--paper);color:var(--body-text);border:1px solid var(--line);border-radius:8px;padding:10px 16px;box-shadow:0 4px 18px #0002;font-size:13px}
  .raw-event {width:min(760px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:90dvh;padding:0;border:1px solid var(--line);border-radius:14px;background:var(--paper);color:var(--body-text)}
  .raw-event::backdrop {background:#0b1510bb}
  header {display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px 16px;border-bottom:1px solid var(--line)}
  header h3 {font:650 20px/1.3 var(--sans);margin:0;letter-spacing:-.3px}
  header p {margin:5px 0 0;font-size:13px;color:var(--muted)}
  header button {display:grid;place-items:center;min-width:32px;min-height:32px;border-radius:6px}
  header button:hover {background:var(--light)}
  pre {font:12px/1.6 var(--mono,monospace);white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:58dvh;margin:0;padding:18px 22px;tab-size:2;user-select:text}
  footer {display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
  .copy-json {display:flex;align-items:center;gap:7px;flex:none;background:var(--light);color:var(--accent);border:1px solid var(--line);border-radius:7px;padding:9px 12px;font-weight:650}
  @media (max-width:600px) {.menu-trigger {width:34px;height:34px} header,footer {padding:14px 16px} pre {padding:16px}}
</style>
