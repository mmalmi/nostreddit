<script lang="ts">
  import { profileUrl } from '../lib/profile-url';
  import { profiles } from '../lib/network';
  import { noteParts, partText } from '../lib/mentions';
  export let text: string;
  export let tags: string[][] = [];
  export let full = false;
  $: parts = noteParts(text, tags);
</script>

<div class="note-text" class:clamped={!full}>{#each parts as part}{#if part.url}<a href={part.url} target="_blank" rel="noopener noreferrer">{part.text}</a>{:else if part.person}<a href={profileUrl(part.person)}>{partText(part,$profiles)}</a>{:else}{part.text}{/if}{/each}</div>
