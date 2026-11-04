<script lang="ts">
  import { account } from '../lib/network';
  import Icon from './Icon.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import HotSettings from './HotSettings.svelte';
  import ImageProxySettings from './ImageProxySettings.svelte';
  import GraphSettings from './GraphSettings.svelte';
  import Outbox from './Outbox.svelte';
  import ProfileBackup from './ProfileBackup.svelte';
  export let sorting: string;
  export let showPreviews: boolean;
  export let onOrderChange: (value: string) => void;
  export let onPreviewsChange: (value: boolean) => void;
</script>

<div class="page-head"><h1>Settings</h1><p>Preferences are saved in this browser.</p></div>
<AppearanceSettings/>
<section class="preferences" aria-labelledby="feed-preferences">
  <h2 id="feed-preferences">Feed preferences</h2>
  <label><span>Feed order</span>
    <select aria-label="Feed order" value={sorting} onchange={(event) => onOrderChange(event.currentTarget.value)}>
      {#each ['Hot', 'New', 'Top'] as order}<option value={order}>{order}</option>{/each}
    </select>
  </label>
  <label><span>Show media previews in feeds</span><input type="checkbox" checked={showPreviews} onchange={(event) => {
    onPreviewsChange(event.currentTarget.checked);
  }} /></label>
</section>
<HotSettings/>
<ImageProxySettings/>
<GraphSettings/>
{#if $account}<Outbox/>{/if}
{#if $account}
  {#key $account.pubkey + ':' + $account.method}<ProfileBackup method={$account.method}/>{/key}
{/if}
<section class="preferences source-section" aria-labelledby="source-links">
  <h2 id="source-links">Source</h2>
  <div class="source-links">
    <a href="https://github.com/mmalmi/nostreddit" target="_blank" rel="noopener noreferrer">GitHub <Icon name="external" size={14}/></a>
    <a href="https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/nostreddit" target="_blank" rel="noopener noreferrer">git.iris.to <Icon name="external" size={14}/></a>
  </div>
</section>
