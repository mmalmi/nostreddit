<script lang="ts">
  import Avatar from '@iris/svelte-ui/Avatar.svelte';
  import type { Profile } from '../lib/network';
  import { imageProxySettings, imageRequest } from '../lib/image-proxy';
  import { proxyImage } from '../lib/image-load';
  import { safeURL, displayName } from '../lib/ui';

  export let pubkey: string;
  export let profile: Profile | undefined;
  export let size = 40;
  let failed='';
  $: picture=safeURL(profile?.picture);
  $: request=imageRequest(picture,{width:size,square:true},$imageProxySettings);
  $: requestKey=JSON.stringify([request.src,request.fallback]);
</script>
{#if request.src && failed!==requestKey}
  <img width={size} height={size} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
    use:proxyImage={{url:picture,width:size,height:size,square:true,unavailable:()=>failed=requestKey}}/>
{:else}
  <Avatar {pubkey} name={displayName(pubkey,profile)} picture="" {size} imgProxy={false}/>
{/if}

<style>img{display:block;flex:none;border-radius:50%;object-fit:cover}</style>
