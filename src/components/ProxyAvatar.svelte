<script lang="ts">
  import Minidenticon from '@iris/svelte-ui/Minidenticon.svelte';
  import type { Profile } from '../lib/network';
  import { imageProxySettings, imageRequest } from '../lib/image-proxy';
  import { safeURL, displayName } from '../lib/ui';

  export let pubkey: string;
  export let profile: Profile | undefined;
  export let size = 40;
  let loadedSrc = '';
  $: src = imageRequest(safeURL(profile?.picture), {width:size, square:true}, $imageProxySettings).src;
</script>
<span class="thumbnail" style:width={size+'px'} style:height={size+'px'} aria-hidden="true">
  {#if !src || loadedSrc !== src}
    <Minidenticon seed={pubkey} title={displayName(pubkey,profile)} {size}/>
  {/if}
  {#if src}
    <img {src} width={size} height={size} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
      class:loaded={loadedSrc === src} onload={() => loadedSrc = src}
      onerror={() => loadedSrc = ''}/>
  {/if}
</span>

<style>
  .thumbnail {display:flex;position:relative;flex:none;border-radius:50%;overflow:hidden}
  img {position:absolute;inset:0;object-fit:cover;opacity:0}
  img.loaded {opacity:1}
</style>
