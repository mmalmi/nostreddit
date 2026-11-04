<script lang="ts">
  import { safeURL } from '../lib/ui';
  export let text: string;
  export let full = false;
  $: segments = text.split(/(https?:\/\/[^\s<>]+)/gi);
</script>

<div class="note-text" class:clamped={!full}>
  {#each segments as s}{#if safeURL(s)}<a
        href={s}
        target="_blank"
        rel="noopener noreferrer">{s}</a
      >{:else}{s}{/if}{/each}
</div>
