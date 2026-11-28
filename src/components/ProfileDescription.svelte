<script lang="ts">
  import { collectMedia, stripAttachments } from '../lib/media';
  import { findTreeEmbeds } from '../lib/tree-embeds';
  import { noteParts, type NotePart } from '../lib/mentions';
  import { displayText, paragraphs, type Translations } from '../lib/ui';
  import NoteText from './NoteText.svelte';
  import MediaEmbed from './MediaEmbed.svelte';
  import TreeEmbed from './TreeEmbed.svelte';
  import TranslationButton from './TranslationButton.svelte';

  export let about: string;
  let expanded = false;
  let translated: Translations | undefined;

  // Cut labels after parsing so a shortened URL always keeps its full destination.
  function excerpt(parts: NotePart[]) {
    const visible: NotePart[] = [];
    let characters = 0, lines = 1;
    for (const part of parts) {
      let end = 0;
      for (const character of part.text) {
        if (characters === 240 || (character === '\n' && lines === 4)) {
          if (end) {
            let label = part.text.slice(0, end);
            if (!part.url && !part.topic && !/\s/u.test(character)) label = label.replace(/\s+\S{1,16}$/u, '');
            visible.push({...part, text:label.trimEnd()});
          }
          if (character !== '\n') visible.push({text:'…'});
          return visible;
        }
        if (character === '\n') lines++;
        characters++;
        end += character.length;
      }
      visible.push(part);
    }
    return parts;
  }

  $: groups = paragraphs(about);
  $: media = collectMedia(about, []);
  $: images = media.filter(item => item.kind === 'image');
  $: trees = findTreeEmbeds(about);
  $: attachments = [...media.map(item => item.url), ...trees.map(tree => tree.raw)];
  $: text = displayText(about, translated).trim().replace(/\r\n?/g, '\n');
  $: parts = noteParts(text, []);
  $: preview = excerpt(parts);
  $: hasMore = preview !== parts || attachments.length > 0 || parts.some(part => part.event);
  $: fullParts = expanded && attachments.length ? noteParts(stripAttachments(text, attachments), []) : parts;
</script>

<div class="description" data-translation-item>
  <NoteText parsedParts={expanded ? fullParts : preview} full showPreviews={expanded}/>
  {#if expanded}
    {#each media as item (item.url)}<MediaEmbed {item} compact gallery={images}/>{/each}
    {#each trees as attachment (attachment.url)}<TreeEmbed {attachment}/>{/each}
  {/if}
  {#if hasMore}
    <button type="button" class="toggle" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? 'Show less' : 'Show more'}</button>
  {/if}
  <TranslationButton {groups} ondisplay={value => translated = value}/>
</div>

<style>
  .description {margin-top:10px}
  .toggle {color:var(--green);font-size:13px;font-weight:650;padding:3px 0}
  .toggle:hover,.toggle:focus-visible {text-decoration:underline}
</style>
