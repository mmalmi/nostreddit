<script lang="ts">
  import type { Paragraphs, Translations } from '../lib/ui';
  const supported = 'LanguageDetector' in globalThis && 'Translator' in globalThis;
  export let groups: Paragraphs;
  export let ondisplay: (result?: Translations) => void;
  function attach(button: HTMLButtonElement, paragraphs: Paragraphs) {
    let stop = () => {}, current = paragraphs, destroyed = false;
    let load: Promise<typeof import('../lib/translation')> | undefined;
    function start(next: Paragraphs) {
      current = next;
      stop(); stop = () => {};
      void (load ??= import('../lib/translation')).then(({ attachTranslation }) => {
        if (!destroyed && current === next) stop = attachTranslation(button, next, ondisplay);
      });
    }
    start(paragraphs);
    return {
      update(next: Paragraphs) { ondisplay(); start(next); },
      destroy() { destroyed = true; stop(); }
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
