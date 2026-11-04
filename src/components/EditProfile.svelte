<script lang="ts">
  import { saveProfile, type Profile } from '../lib/network';
  import { safeURL } from '../lib/ui';
  export let profile: Profile | undefined;
  export let ondone: () => void;
  let name = profile?.display_name || profile?.name || '',
    about = profile?.about || '',
    picture = profile?.picture || '',
    lud16 = profile?.lud16 || '',
    busy = false,
    error = '';
  async function send() {
    if (picture && !safeURL(picture)) {
      error = 'Enter a full http or https picture URL.';
      return;
    }
    busy = true;
    error = '';
    try {
      await saveProfile({
        display_name: name.trim(),
        name: name.trim(),
        about: about.trim(),
        picture: picture.trim(),
        lud16: lud16.trim(),
      });
      ondone();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save profile.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="dialog-content">
  <div class="eyebrow">ACCOUNT</div>
  <h2>Edit profile</h2>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <label>Display name<input bind:value={name} maxlength="80" /></label><label
      >About<textarea bind:value={about} rows="3" maxlength="2000"
      ></textarea></label
    >
    <label
      >Picture URL<input
        type="url"
        bind:value={picture}
        placeholder="https://…"
      /></label
    ><label
      >Lightning address<input
        bind:value={lud16}
        placeholder="name@example.com"
      /></label
    >
    {#if error}<p class="error" role="alert">{error}</p>{/if}<button
      class="primary wide"
      disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button
    >
  </form>
</div>
