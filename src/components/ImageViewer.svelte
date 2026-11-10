<script lang="ts">
  import { proxyImage } from '../lib/image-load';
  import Icon from './Icon.svelte';

  export let url: string;
  export let alt: string;
  export let enlargeSmall = false;
  export let onclose: () => void;

  function showImageDialog(node: HTMLDialogElement) {
    const previousFocus = document.activeElement;
    function closeOnBackdrop(event: MouseEvent) {
      if (event.target !== node) return;
      const bounds = node.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) onclose();
    }
    node.addEventListener('click', closeOnBackdrop);
    node.showModal();
    return { destroy() {
      node.removeEventListener('click', closeOnBackdrop);
      if (node.open) node.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({preventScroll:true});
    } };
  }
</script>

<dialog class="viewer" aria-label="Expanded image" use:showImageDialog
  oncancel={event => { event.preventDefault(); onclose(); }}
  onclose={event => { if (event.currentTarget.isConnected) onclose(); }}>
  <div class="viewer-tools">
    <a href={url} target="_blank" rel="noopener noreferrer">Open original <Icon name="external" size={14}/></a>
    <button type="button" aria-label="Close image" onclick={onclose}><Icon name="close" size={20}/></button>
  </div>
  <img class:enlargeSmall use:proxyImage={{url,offline:true,remember:true}} {alt} referrerpolicy="no-referrer"/>
</dialog>

<style>
  .viewer {max-width:96vw;max-height:96dvh;border:0;border-radius:10px;background:#15211b;color:white;padding:8px}
  .viewer::backdrop {background:#0b1510dd}
  .viewer > img {display:block;max-width:90vw;max-height:79dvh;object-fit:contain;margin:auto}
  .viewer > .enlargeSmall {min-width:min(320px,90vw)}
  .viewer-tools {display:flex;align-items:center;justify-content:flex-end;gap:14px;padding:0 3px 6px}
  .viewer-tools a,.viewer-tools button {display:inline-flex;align-items:center;gap:5px;color:inherit;font-size:13px}
  .viewer-tools button {padding:4px}
</style>
