<script lang="ts">
  import { onMount } from 'svelte';
  import { topicPath } from '../lib/hashtags';
  import { profileUrl } from '../lib/profile-url';
  import { postUrl } from '../lib/post-url';
  import { profiles, observeReferences } from '../lib/network';
  import { referencePosts } from '../lib/note-references';
  import { noteParts, partText } from '../lib/mentions';
  import SocialBadge from './SocialBadge.svelte';
  import NoteQuote from './NoteQuote.svelte';
  export let text: string;
  export let tags: string[][] = [];
  export let full = false;
  export let showPreviews = true;
  export let inline = false;
  export let previewsOnly = false;
  export let embeddedIds: readonly string[] = [];
  let mounted = false;
  let stop = () => {};
  $: parts = noteParts(text, tags);
  $: quoteIds = showPreviews && !inline ? [...new Set(parts.flatMap(part=>part.event ? [part.event] : []))].slice(0,4) : [];
  $: embedded = new Set([...embeddedIds,...quoteIds.filter(id=>$referencePosts.has(id))]);
  $: visibleParts = parts.filter(part=>!part.event || !embedded.has(part.event));
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

{#if !previewsOnly && visibleParts.some(part=>part.text.trim())}<svelte:element this={inline ? 'span' : 'div'} class:note-text={!inline} class:clamped={!full && !inline}>{#each visibleParts as part}{#if part.url}<a href={part.url} target="_blank" rel="noopener noreferrer">{part.text}</a>{:else if part.topic}<a href={topicPath(part.topic)}>{part.text}</a>{:else if part.person}<a href={profileUrl(part.person)} aria-label={partText(part,$profiles)}><SocialBadge pubkey={part.person}/> {partText(part,$profiles)}</a>{:else if part.event}<a href={postUrl(part.event)}>{partText(part,$profiles,$referencePosts)}</a>{:else}{part.text}{/if}{/each}</svelte:element>{/if}
{#each quoteIds as id (id)}<NoteQuote {id}/>{/each}
