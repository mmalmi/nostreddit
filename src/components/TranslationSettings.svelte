<script lang="ts">
  import { onMount } from 'svelte';
  import { languageChoices, onPreferences, preferences, supported, updatePreferences } from '../lib/translation';
  let prefs = preferences();
  onMount(() => onPreferences(() => prefs = preferences()));
  $: choices = languageChoices(prefs);
</script>

{#if supported}
  <section class="preferences" aria-labelledby="translation-settings">
    <h2 id="translation-settings">Translation</h2>
    <label>Automatically translate posts and bios
      <input type="checkbox" checked={prefs.auto} onchange={e => updatePreferences({auto:e.currentTarget.checked})} />
    </label>
    <label>Translate into
      <select value={prefs.target} onchange={e => updatePreferences({target:e.currentTarget.value})}>
        {#each choices as {code, name}}<option value={code}>{name}</option>{/each}
      </select>
    </label>
    <label>Languages I read
      <select value="" onchange={e => { updatePreferences({read:[...prefs.read,e.currentTarget.value]}); e.currentTarget.value = ''; }}>
        <option value="">Add a language…</option>
        {#each choices.filter(({code}) => code !== prefs.target && !prefs.read.includes(code)) as {code,name}}
          <option value={code}>{name}</option>
        {/each}
      </select>
    </label>
    {#each prefs.read as code}
      <button class="read-language" aria-label={'Remove ' + choices.find(c => c.code === code)?.name}
        onclick={() => updatePreferences({read:prefs.read.filter(item => item !== code)})}>
        {choices.find(c => c.code === code)?.name} ×
      </button>
    {/each}
  </section>
{/if}

<style>
  .read-language {border:1px solid var(--line);border-radius:6px;padding:3px 8px;margin:3px 6px 0 0;color:var(--body-text)}
</style>
