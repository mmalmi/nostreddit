<script lang="ts">
  import PublicProfileEditor from '@iris/svelte-ui/PublicProfileEditor.svelte';
  import { discardConflictingProfileEdits, pendingWrites, profileForEditor, saveRawProfile } from '../lib/network';
  import { safeURL } from '../lib/ui';
  let { owner, ondone }: { owner:string; ondone:()=>void } = $props();
  let reload = $state(0);
  const conflict = $derived($pendingWrites.find(row => row.owner === owner && row.change?.kind === 0 && row.hold && row.error?.startsWith('Profile changed:')));
  const head = $derived.by(() => { void reload; return profileForEditor(owner); });
</script>

<div class="dialog-content">
  <h2>Edit profile</h2>
  {#if conflict}
    <p role="alert">{conflict.error}</p>
    <button onclick={async () => { await discardConflictingProfileEdits(); reload++; }}>Discard conflicting edits</button>
  {/if}
  {#await head}
    <p role="status">Loading your profile…</p>
  {:then event}
    <PublicProfileEditor {event} onsaveraw={async (edits, base) => {
      if (['picture','banner','website'].some(key => {
        const raw = edits[key];
        if (!raw?.startsWith('"')) return false;
        const value = JSON.parse(raw);
        return value && !safeURL(value);
      })) {
        throw new Error('Use a full http or https URL for pictures, banners, and websites.');
      }
      await saveRawProfile(edits, base); ondone();
    }} />
  {:catch error}
    <p class="error" role="alert">{error instanceof Error ? error.message : 'Could not load your profile.'}</p>
    <button onclick={() => reload++}>Retry</button>
  {/await}
</div>
