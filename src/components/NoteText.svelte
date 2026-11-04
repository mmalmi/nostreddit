<script lang="ts">
  import { onMount } from 'svelte';
  import { topicPath } from '../lib/hashtags';
  import { profileUrl } from '../lib/profile-url';
  import { postUrl } from '../lib/post-url';
  import { profiles, observeReferences } from '../lib/network';
  import { noteParts, partText } from '../lib/mentions';
  import SocialBadge from './SocialBadge.svelte';
  import NoteQuote from './NoteQuote.svelte';
  export let text: string;
  export let tags: string[][] = [];
  export let full = false;
  export let showPreviews = true;
  export let inline = false;
  export let previewsOnly = false;
  let mounted = false;
  let stop = () => {};
  $: parts = noteParts(text, tags);
  $: quoteIds = showPreviews && !inline ? [...new Set(parts.flatMap(part=>part.event ? [part.event] : []))].slice(0,4) : [];
  $: people = [...new Set(parts.flatMap(part=>part.person ? [part.person] : []))].slice(0,24);
  $: scope = quoteIds.join(',')+'|'+people.join(',');
  $: if (mounted) watch(scope);
  function watch(scope:string) {
    stop();
    const [events,people] = scope.split('|');
    stop = observeReferences(events.split(',').filter(Boolean),people.split(',').filter(Boolean));
  }
  onMount(() => { mounted = true; return () => stop(); });
</script>

{#if !previewsOnly}<svelte:element this={inline ? 'span' : 'div'} class:note-text={!inline} class:clamped={!full && !inline}>{#each parts as part}{#if part.url}<a href={part.url} target="_blank" rel="noopener noreferrer">{part.text}</a>{:else if part.topic}<a href={topicPath(part.topic)}>{part.text}</a>{:else if part.person}<a href={profileUrl(part.person)} aria-label={partText(part,$profiles)}>{partText(part,$profiles)} <SocialBadge pubkey={part.person}/></a>{:else if part.event}<a href={postUrl(part.event)} aria-label={'Open post '+partText(part,$profiles)}>{partText(part,$profiles)}</a>{:else}{part.text}{/if}{/each}</svelte:element>{/if}
{#each quoteIds as id (id)}<NoteQuote {id}/>{/each}
