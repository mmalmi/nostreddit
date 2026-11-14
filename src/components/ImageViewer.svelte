<script lang="ts">
  import { proxyImage } from '../lib/image-load';
  import Icon from './Icon.svelte';

  export let url = '';
  export let alt = '';
  export let items: {url: string; alt: string; clickToLoad?: boolean}[] = [];
  export let start = 0;
  export let enlargeSmall = false;
  export let onclose: () => void;
  let index = Math.max(0, start);
  $: list = items.length ? items : [{url, alt}];
  $: multi = list.length > 1;
  $: current = list[Math.min(index, list.length - 1)];

  $: slides = [...new Set([
    current,
    list[(index + 1) % list.length],
    list[(index + list.length - 1) % list.length],
  ])].filter(slide => slide === current || !slide.clickToLoad);

  function step(by: number) { index = (index + by + list.length) % list.length; }
  function arrowKeys(event: KeyboardEvent) {
    if (!multi || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  }

  function showImageDialog(node: HTMLDialogElement) {
    const previousFocus = document.activeElement;
    function closeOnBackdrop(event: MouseEvent) {
      if (event.target !== node) return;
      const bounds = node.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) onclose();
    }
    node.addEventListener('click', closeOnBackdrop);
    node.addEventListener('keydown', arrowKeys);
    node.showModal();
    return { destroy() {
      node.removeEventListener('click', closeOnBackdrop);
      node.removeEventListener('keydown', arrowKeys);
      if (node.open) node.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({preventScroll:true});
    } };
  }
</script>

<dialog class="viewer" aria-label="Expanded image" use:showImageDialog
  oncancel={event => { event.preventDefault(); onclose(); }}
  onclose={event => { if (event.currentTarget.isConnected) onclose(); }}>
  <div class="viewer-tools">
    {#if multi}<span class="count" aria-live="polite">{index + 1} / {list.length}</span>{/if}
    <a href={current.url} target="_blank" rel="noopener noreferrer">Open original <Icon name="external" size={14}/></a>
    <button type="button" aria-label="Close image" onclick={onclose}><Icon name="close" size={20}/></button>
  </div>
  <div class="stage" class:multi>
    {#each slides as slide (slide.url)}
      <div hidden={slide !== current}>
        <img class:enlargeSmall use:proxyImage={{url:slide.url,offline:true,remember:slide === current}}
          alt={slide.alt} referrerpolicy="no-referrer"/>
      </div>
    {/each}
    {#if multi}
      <button type="button" class="step previous" aria-label="Previous image" onclick={() => step(-1)}><Icon name="back" size={22}/></button>
      <button type="button" class="step" aria-label="Next image" onclick={() => step(1)}><Icon name="next" size={22}/></button>
    {/if}
  </div>
</dialog>

<style>
  .viewer {max-width:96vw;max-height:96dvh;border:0;border-radius:10px;background:#15211b;color:white;padding:8px}
  .viewer::backdrop {background:#0b1510dd}
  .stage {position:relative;display:grid;place-items:center}
  .stage.multi {width:90vw;height:79dvh}
  .stage img {display:block;max-width:90vw;max-height:79dvh;object-fit:contain;margin:auto}
  .stage .enlargeSmall {min-width:min(320px,90vw)}
  .step {position:absolute;top:50%;right:6px;transform:translateY(-50%);display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#0b1510cc;color:white}
  .step.previous {right:auto;left:6px}
  .step:hover {background:#0b1510}
  .count {margin-right:auto;font-size:13px;font-variant-numeric:tabular-nums}
  .viewer-tools {display:flex;align-items:center;justify-content:flex-end;gap:14px;padding:0 3px 6px}
  .viewer-tools a,.viewer-tools button {display:inline-flex;align-items:center;gap:5px;color:inherit;font-size:13px}
  .viewer-tools button {padding:4px}
</style>
