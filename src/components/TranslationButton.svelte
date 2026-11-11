<script lang="ts">
  import { attachTranslation, supported, type Paragraphs, type Translations } from '../lib/translation';
  export let groups: Paragraphs;
  export let ondisplay: (result?: Translations) => void;
  function attach(button: HTMLButtonElement, paragraphs: Paragraphs) {
    let stop = attachTranslation(button, paragraphs, ondisplay);
    return {
      update(next: Paragraphs) { stop(); ondisplay(); stop = attachTranslation(button, next, ondisplay); },
      destroy() { stop(); }
    };
  }
</script>

{#if supported && groups.length}
  <button type="button" class="translation-button" use:attach={groups}>Translate</button>
{/if}

<style>
  .translation-button {visibility:hidden;display:block;inline-size:9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:start;color:var(--muted);font:500 12px/20px var(--sans)}
  .translation-button:hover {color:var(--accent)}
</style>
