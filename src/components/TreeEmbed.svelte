<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { TreeAttachment } from '../lib/tree-embeds';
  import type { TreeResult } from '../lib/tree-reader';
  import Icon from './Icon.svelte';

  export let attachment: TreeAttachment;

  let current = '', objectUrl = '', error = '', loading = false;
  let result: TreeResult | null = null;
  let active: AbortController | undefined, dialog: HTMLDialogElement, video: HTMLVideoElement;
  let playing = false;

  function clear() {
    active?.abort();
    active = undefined;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = ''; error = ''; result = null; loading = false; playing = false;
  }
  function select(url: string) {
    if (current !== url) { clear(); current = url; }
  }
  $: select(attachment.url);
  onDestroy(clear);

  async function load() {
    if (loading || attachment.mutable) return;
    const controller = new AbortController();
    active = controller; error = ''; loading = true;
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const {loadTreeAttachment} = await import('../lib/tree-reader');
      const content = await loadTreeAttachment(attachment,controller.signal);
      if (active !== controller) return;
      if (content.type === 'file') objectUrl = URL.createObjectURL(content.blob);
      result = content;
    } catch (cause) {
      if (active === controller) error = controller.signal.aborted ? 'The attachment timed out.' :
        cause instanceof Error ? cause.message : 'Could not load this attachment.';
    } finally {
      clearTimeout(timer);
      if (active === controller) { active = undefined; loading = false; }
    }
  }

  function pauseWhenHidden(element: HTMLVideoElement) {
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) element.pause(); });
    const visibility = () => { if (document.hidden) element.pause(); };
    observer.observe(element);
    document.addEventListener('visibilitychange',visibility);
    return {destroy() { observer.disconnect(); document.removeEventListener('visibilitychange',visibility); }};
  }
  function play() {
    video.play().catch(() => { error = 'This browser could not play the video. You can still download it.'; });
  }
  $: action = attachment.kind === 'tree' ? 'Inspect tree' : attachment.kind === 'file' ? 'Load file' : 'Load '+attachment.kind;
</script>

<div class="tree-embed">
  <header><span>Hashtree</span><strong>{attachment.name}</strong></header>
  {#if result?.type === 'directory'}
    <ul aria-label="Directory contents">{#each result.entries as entry}
      <li><a href={entry.href} target="_blank" rel="noopener noreferrer"><Icon name={entry.directory?'book':'link'} size={15}/>{entry.name}{entry.directory?'/':''}</a></li>
    {/each}</ul>
    {#if !result.total}<small>Empty directory</small>{:else if result.total > result.entries.length}<small>Showing {result.entries.length} of {result.total} entries</small>{/if}
  {:else if objectUrl && attachment.kind === 'image'}
    <button class="photo" aria-label={'Expand '+attachment.name} onclick={() => dialog.showModal()}>
      <img src={objectUrl} alt={attachment.name} /><span class="expand">⤢</span>
    </button>
    <dialog bind:this={dialog} aria-label={attachment.name}><button class="close" onclick={() => dialog.close()} aria-label="Close image"><Icon name="close"/></button><img src={objectUrl} alt={attachment.name} /></dialog>
  {:else if objectUrl && attachment.kind === 'video'}
    <div class="video">
      <!-- svelte-ignore a11y_media_has_caption (A shared external file may not provide captions.) -->
      <video use:pauseWhenHidden bind:this={video} src={objectUrl} controls playsinline preload="metadata" onplay={() => playing=true} onpause={() => playing=false} onended={() => playing=false}></video>
      {#if !playing}<button class="play" aria-label={'Play '+attachment.name} onclick={play}>▶</button>{/if}
    </div>
  {:else if objectUrl && attachment.kind === 'audio'}
    <audio src={objectUrl} controls preload="metadata"></audio>
  {/if}
  {#if error}<p role="status">{error}</p>{/if}
  <footer>
    {#if !result && !attachment.mutable}<button class="outline compact" disabled={loading} onclick={load}>{loading ? 'Loading…' : action}</button>{/if}
    {#if objectUrl}<a class="outline compact" download={attachment.name} href={objectUrl}>Download file</a>{/if}
    <a class="drive" href={attachment.viewerUrl} target="_blank" rel="noopener noreferrer">Open in Iris Drive <Icon name="external" size={12}/></a>
  </footer>
</div>

<style>
  .tree-embed {margin:10px 0;border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
  header,footer,.drive,li a {display:flex;align-items:center;gap:8px}
  header {margin-bottom:8px;align-items:baseline;flex-wrap:wrap;}
  header span {font:10px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  header strong {font-size:14px;overflow-wrap:anywhere}
  footer {margin-top:8px;flex-wrap:wrap}
  .drive {font-size:12px;color:var(--green)}
  p,small {color:var(--muted);font-size:13px}
  ul {padding:0;margin:0;list-style:none;max-height:250px;overflow:auto} li a {padding:4px;overflow-wrap:anywhere}
  li a:hover,.drive:hover {text-decoration:underline}
  .photo,.video {position:relative;display:block;max-width:100%;border-radius:8px;overflow:hidden;background:var(--bg)}
  .photo {width:100%;cursor:zoom-in}
  .photo img,video {display:block;width:100%;max-height:420px;object-fit:contain}
  .expand,.close,.play {position:absolute;background:#18231de6;color:#fff;border-radius:50%;display:grid;place-items:center;}
  .expand,.close {right:8px;top:8px;width:30px;height:30px}
  .play {top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;font-size:20px}
  audio {width:100%}
  dialog {padding:0;border:0;min-width:54px;min-height:54px;max-width:94vw;background:#142018;border-radius:10px}
  dialog::backdrop {background:#111a14ba}
  dialog img {display:block;max-width:94vw;max-height:88dvh;object-fit:contain;margin:auto}
</style>
