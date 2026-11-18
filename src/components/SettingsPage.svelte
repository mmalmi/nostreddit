<script lang="ts">
  import { account, exportKey, profiles } from '../lib/network';
  import ProfileSettings from '@iris/svelte-ui/ProfileSettings.svelte';
  import { copyToClipboard } from '@iris/svelte-ui/clipboard';
  import { npubEncode } from 'nostr-tools/nip19';
  import { displayName } from '../lib/ui';
  import { showClientTag, setShowClientTag } from '../lib/client-tag';
  import { settingsTabs, type SettingsTab } from '../lib/settings-tabs';
  import Icon from './Icon.svelte';
  import RelaySettings from './RelaySettings.svelte';
  import TranslationSettings from './TranslationSettings.svelte';
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
  export let onSignOut: (profileId: string) => void;
  $: current = tab || settingsTabs[0].id;
  $: tabs = settingsTabs.filter(item => item.id !== 'account' || $account);
  $: signedInProfiles = $account ? [{
    id: $account.pubkey,
    publicKey: npubEncode($account.pubkey),
    name: displayName($account.pubkey, $profiles[$account.pubkey]),
  }] : [];

  async function copyProfileKey(profileId: string) {
    if ($account?.pubkey !== profileId || $account.method !== 'local') throw new Error('Secret key unavailable.');
    if (await copyToClipboard(exportKey()) !== 'copied') throw new Error('Could not copy the secret key.');
  }
</script>

<div class="settings" class:menu-only={!tab}>
  <div class="page-head">
    <a class="settings-back" href="/settings"><Icon name="back" size={16}/>Settings</a>
    <div class="settings-heading">
      <h1>Settings</h1>
      {#if !tab && $account}
        <button type="button" class="outline compact" onclick={() => $account && onSignOut($account.pubkey)}>
          <Icon name="logout" size={16}/>Sign out
        </button>
      {/if}
    </div>
    <p>Preferences are saved in this browser.</p>
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
      <TranslationSettings/>
      <HotSettings/>
    {:else if current === 'filters'}
      <GraphSettings/>
    {:else if current === 'network'}
      <RelaySettings/>
      <ImageProxySettings/>
    {:else if current === 'account'}
      {#if $account}
        <ProfileSettings profiles={signedInProfiles} activeProfileId={$account.pubkey} {onSignOut}
          onCopySecretKey={$account.method === 'local' ? copyProfileKey : undefined} />
        <section class="preferences" aria-labelledby="posting-preferences">
          <h2 id="posting-preferences">Posting</h2>
          <label><span>Identify Nostreddit on my public posts and replies</span><input type="checkbox" checked={$showClientTag}
            onchange={(event) => setShowClientTag(event.currentTarget.checked)} /></label>
        </section>
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

<style>
  .settings-heading {display:flex;align-items:center;justify-content:space-between;gap:12px}
</style>
