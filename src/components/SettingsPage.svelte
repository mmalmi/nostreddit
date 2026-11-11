<script lang="ts">
  import { account } from '../lib/network';
  import { settingsTabs, type SettingsTab } from '../lib/settings-tabs';
  import Icon from './Icon.svelte';
  import RelaySettings from './RelaySettings.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import HotSettings from './HotSettings.svelte';
  import ImageProxySettings from './ImageProxySettings.svelte';
  import GraphSettings from './GraphSettings.svelte';
  import Outbox from './Outbox.svelte';
  import ProfileBackup from './ProfileBackup.svelte';
  export let sorting: string;
  export let active = true;
  export let tab: SettingsTab | '' = '';
  export let showPreviews: boolean;
  export let onOrderChange: (value: string) => void;
  export let onPreviewsChange: (value: boolean) => void;
  $: current = tab || settingsTabs[0].id;
  $: tabs = settingsTabs.filter(item => item.id !== 'account' || $account);
</script>

<div class="settings" class:menu-only={!tab}>
  <div class="page-head">
    <a class="settings-back" href="/settings"><Icon name="back" size={16}/>Settings</a>
    <h1>Settings</h1><p>Preferences are saved in this browser.</p>
  </div>
  <nav class="settings-menu" aria-label="Settings sections">
    {#each tabs as item (item.id)}<a class="nav-row" class:active={item.id === current} aria-current={item.id === current ? 'page' : undefined}
      href={'/settings/' + item.id}><Icon name={item.icon} size={18}/>{item.name}<Icon name="next" size={16}/></a>{/each}
  </nav>
  <div class="settings-panel">
    {#if current === 'appearance'}
      <AppearanceSettings/>
    {:else if current === 'feeds'}
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
    {:else if current === 'network'}
      <GraphSettings/>
      <RelaySettings/>
      <ImageProxySettings/>
    {:else if current === 'account'}
      {#if $account}
        <Outbox/>
        {#key $account.pubkey + ':' + $account.method}<ProfileBackup {active} method={$account.method}/>{/key}
      {:else}
        <p class="state">Sign in to back up your profile.</p>
      {/if}
    {:else}
      <section class="preferences" aria-labelledby="source-links">
        <h2 id="source-links">Source</h2>
        <div class="source-links">
          <a href="https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/nostreddit" target="_blank" rel="noopener noreferrer">git.iris.to <Icon name="external" size={14}/></a>
          <a href="https://github.com/mmalmi/nostreddit" target="_blank" rel="noopener noreferrer">GitHub <Icon name="external" size={14}/></a>
        </div>
      </section>
    {/if}
  </div>
</div>
