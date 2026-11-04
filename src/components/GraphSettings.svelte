<script lang="ts">
  import { graphStatus } from '../lib/graph';
  import { visibilitySettings, type VisibilitySettings } from '../lib/visibility';

  function changeDistance(value: string) {
    const distance = value === 'unlimited' ? null : Number(value) as VisibilitySettings['maxDistance'];
    visibilitySettings.set({ ...$visibilitySettings, maxDistance: distance });
  }
</script>

<section class="preferences graph-settings" aria-labelledby="graph-visibility">
  <h2 id="graph-visibility">Social graph</h2>
  <p class="graph-root">Guests and profiles without follows use the public Iris graph.</p>
  <label><span>Maximum follow distance</span>
    <select value={String($visibilitySettings.maxDistance ?? 'unlimited')} onchange={(event) => changeDistance(event.currentTarget.value)}>
      <option value="1">1 · Direct follows</option>
      <option value="2">2 · Friends of friends</option>
      {#each [3,4,5] as distance}<option value={String(distance)}>{distance} steps</option>{/each}
      <option value="unlimited">Unlimited</option>
    </select>
  </label>
  <label><span>Hide overmuted profiles</span>
    <input type="checkbox" checked={$visibilitySettings.hideOvermuted} onchange={(event) =>
      visibilitySettings.set({...$visibilitySettings, hideOvermuted: event.currentTarget.checked})} />
  </label>
  <p>Your mutes always apply. Community mute filtering uses the closest people in your graph who follow or mute a profile.</p>
  {#if $graphStatus === 'unavailable'}<p role="status">The graph is unavailable. Posts that need a graph check are hidden.</p>{/if}
</section>

<style>
  .graph-settings { margin-top:14px; }
  .graph-root {margin:0 0 12px}
  p { color:var(--muted);font-size:13px; }
</style>
