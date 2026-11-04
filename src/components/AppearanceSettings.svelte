<script lang="ts">
  import { appearance, modes, themes, setAppearance } from '../lib/appearance';
  import Icon from './Icon.svelte';

  const title = (word: string) => word[0].toUpperCase() + word.slice(1);
</script>

<section class="preferences appearance" aria-labelledby="appearance-title">
  <h2 id="appearance-title">Appearance</h2>
  <label>
    <span>Display mode</span>
    <select value={$appearance.mode} onchange={(event) => {
      const value = event.currentTarget.value;
      const mode = modes.find(mode => mode === value);
      if (mode) setAppearance({ ...$appearance, mode });
    }}>
      {#each modes as mode}<option value={mode}>{title(mode)}</option>{/each}
    </select>
  </label>
  <fieldset>
    <legend>Color theme</legend>
    <div class="themes">
      {#each themes as theme}
        <label class="theme" data-theme={theme}>
          <input type="radio" name="color-theme" value={theme} checked={$appearance.theme === theme}
            onchange={() => setAppearance({ ...$appearance, theme })} />
          <span class="swatch" aria-hidden="true">
            {#if $appearance.theme === theme}<Icon name="check" size={14}/>{/if}
          </span>
          {title(theme)}
        </label>
      {/each}
    </div>
  </fieldset>
</section>

<style>
  .appearance { margin-bottom: 14px; }
  fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
  legend { width: 100%; padding: 13px 0 9px; border-top: 1px solid var(--line); }
  .themes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .theme {
    position: relative; justify-content: flex-start; gap: 7px; padding: 7px 11px;
    border: 1px solid var(--line); border-radius: 7px; cursor: pointer; font-size: 13px;
  }
  .theme:has(:checked) { border-color: var(--accent); background: var(--light); font-weight: 650; }
  .theme:has(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .theme input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .swatch {
    display: grid; place-items: center; width: 19px; height: 19px; border-radius: 50%;
    background: var(--accent); color: var(--on-accent);
  }
  @media (max-width: 710px) {
    .themes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
