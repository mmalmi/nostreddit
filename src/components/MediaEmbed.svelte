<script lang="ts">
  import { tick } from 'svelte';
  import { proxyImage, proxyPoster } from '../lib/image-load';
  import { imageProxySettings, type ImageProxySettings } from '../lib/image-proxy';
  import type { MediaItem } from '../lib/media';
  import Icon from './Icon.svelte';

  export let item: MediaItem;
  export let compact = false;
  let openedUrl = '', failedUrl = '', enlargedUrl = '';
  let player: HTMLVideoElement | HTMLAudioElement | undefined;
  $: expanded = openedUrl === item.url;
  let failedSettings:ImageProxySettings | undefined;
  $: failed = failedUrl === item.url && failedSettings === $imageProxySettings;
  $: transferWidth = Math.min(2048, item.width || Math.min(650, window.innerWidth));
  function unavailable() {failedUrl=item.url; failedSettings=$imageProxySettings;}
  $: provider = item.kind === 'youtube' || item.kind === 'vimeo';
  $: video = item.kind === 'video' || provider;
  $: label = item.kind === 'youtube' ? 'YouTube' : item.kind === 'vimeo' ? 'Vimeo' : item.kind;
  $: host = new URL(item.url).hostname;

  function enlarge(e: MouseEvent) {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
    e.preventDefault();
    enlargedUrl = item.url;
  }
  function showImageDialog(node: HTMLDialogElement) {
    function closeOnBackdrop(event: MouseEvent) {
      if (event.target !== node) return;
      const bounds = node.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) node.close();
    }
    node.addEventListener('click', closeOnBackdrop);
    node.showModal();
    return { destroy() { node.removeEventListener('click', closeOnBackdrop); } };
  }
  async function loadPlayer() {
    openedUrl = item.url;
    // Playback begins only after an explicit Play action. If the browser declines,
    // leave its native controls visible so the reader can initiate it there.
    if (item.kind === 'video' || item.kind === 'audio') {
      await tick();
      await player?.play().catch(() => {});
    }
  }
  function pauseWhenHidden(node: HTMLMediaElement | HTMLIFrameElement) {
    function pause() {
      if (node instanceof HTMLMediaElement) node.pause();
      else openedUrl = '';
    }
    function visibilityChanged() { if (document.hidden) pause(); }
    document.addEventListener('visibilitychange', visibilityChanged);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) pause();
    });
    observer?.observe(node);
    return { destroy() {
      document.removeEventListener('visibilitychange', visibilityChanged);
      observer?.disconnect();
    }};
  }
</script>

<div class="media" class:compact>
  {#if failed}
    <a class="source unavailable" href={item.url} target="_blank" rel="noopener noreferrer">
      <Icon name="external" size={15}/>Open {label} on {host}
    </a>
  {:else if item.kind === 'image' && (!item.clickToLoad || expanded)}
    <a class="image-link" href={item.url} target="_blank" rel="noopener noreferrer" onclick={enlarge}
      aria-label={'Expand image: ' + (item.alt || host)}>
      <img use:proxyImage={{url:item.url,width:transferWidth,offline:true,unavailable}} alt={item.alt || 'Photo from ' + host} width={item.width} height={item.height}
        loading="lazy" decoding="async" referrerpolicy="no-referrer"/>
      <span class="expand-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7"/></svg>
      </span>
    </a>
    {#if enlargedUrl === item.url}
      <dialog class="viewer" aria-label="Expanded image" use:showImageDialog onclose={() => enlargedUrl = ''}>
        <div class="viewer-tools">
          <a href={item.url} target="_blank" rel="noopener noreferrer">Open original <Icon name="external" size={14}/></a>
          <form method="dialog"><button aria-label="Close image"><Icon name="close" size={20}/></button></form>
        </div>
        <img use:proxyImage={{url:item.url,offline:true,remember:true}} alt={item.alt || 'Photo from ' + host} referrerpolicy="no-referrer"/>
      </dialog>
    {/if}
  {:else}
    {#if (compact || provider || item.clickToLoad) && !expanded}
      <button type="button" class="load" class:video onclick={loadPlayer}>
        {#if video}
          {#if item.poster || (item.kind === 'video' && $imageProxySettings.enabled)}
            <img class="poster" use:proxyImage={{url:item.poster || item.url,width:transferWidth,videoThumbnail:!item.poster}} alt="" loading="lazy" referrerpolicy="no-referrer" />
          {/if}
          <span class="play-icon" aria-hidden="true">▶</span>
        {/if}
        <span class="load-label">{provider ? 'Load ' + label + ' player' : item.kind === 'image' ? 'Show image' : 'Play ' + label}</span>
      </button>
    {:else if provider && item.embedUrl}
      <iframe src={item.embedUrl} title={label + ' video player'} use:pauseWhenHidden
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="fullscreen; encrypted-media; picture-in-picture" allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"></iframe>
    {:else if item.kind === 'video'}
      <!-- svelte-ignore a11y_media_has_caption (Only the author's media URL is available.) -->
      <video controls playsinline preload="none" src={item.url} use:proxyPoster={{url:item.poster || item.url,width:transferWidth,videoThumbnail:!item.poster}} bind:this={player} use:pauseWhenHidden
        aria-label={item.alt || 'Video from ' + host} onerror={unavailable}></video>
    {:else if item.kind === 'audio'}
      <audio controls preload="none" src={item.url} bind:this={player} use:pauseWhenHidden
        aria-label={item.alt || 'Audio from ' + host} onerror={unavailable}></audio>
    {/if}
    <a class="source" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={'Open original on ' + host}>
      {host}<Icon name="external" size={12}/>
    </a>
  {/if}
</div>

<style>
  .media {width:100%;max-width:100%;min-width:0;margin:.55rem 0}
  .image-link {display:grid;place-items:center;position:relative;width:100%;min-height:5rem;border:1px solid var(--line);border-radius:8px;background:var(--bg);overflow:hidden;cursor:zoom-in}
  .image-link img {display:block;width:auto;height:auto;max-width:100%;max-height:min(70vh,550px);object-fit:contain}
  .compact .image-link img {max-height:clamp(220px,36vw,340px)}
  .expand-icon {position:absolute;right:7px;bottom:7px;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#12211ddd;color:white;pointer-events:none}
  .viewer {max-width:96vw;max-height:96vh;border:0;border-radius:10px;background:#15211b;color:white;padding:8px}
  .viewer::backdrop {background:#0b1510dd}
  .viewer > img {display:block;max-width:90vw;max-height:79vh;object-fit:contain;margin:auto}
  .viewer-tools {display:flex;align-items:center;justify-content:flex-end;gap:14px;padding:0 3px 6px}
  .viewer-tools a,.viewer-tools button {display:inline-flex;align-items:center;gap:5px;color:inherit;font-size:13px}
  .viewer-tools button {padding:4px}
  .media video,.media iframe {display:block;width:100%;aspect-ratio:16/9;max-height:440px;background:#17271f;border:0;border-radius:8px}
  .media audio {display:block;width:min(100%,380px)}
  .load {display:inline-flex;align-items:center;gap:.5rem;border:1px solid var(--line);border-radius:7px;padding:.4rem .65rem;background:var(--light);color:var(--green);font-weight:650;font-size:.84rem}
  .load.video {display:grid;place-items:center;position:relative;overflow:hidden;width:100%;height:clamp(120px,25vw,230px);background:linear-gradient(145deg,#2e4b3c,#172b21);color:#fff}
  .poster {position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .play-icon {z-index:1;display:grid;place-items:center;padding-left:2px;width:44px;height:44px;border-radius:50%;background:#0c1b13dc;color:#fff;border:1px solid #ffffff80}
  .video .load-label {position:absolute;bottom:8px;left:8px;padding:2px 7px;border-radius:3px;background:#11241dd9;color:white;font-size:.75rem}
  .source {display:inline-flex;align-items:center;gap:.3rem;color:var(--muted);font-size:.77rem;line-height:1.35;overflow-wrap:anywhere;margin:.2rem 0}
  .source:hover {color:var(--green);text-decoration:underline}
</style>
