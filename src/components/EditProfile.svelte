<script lang="ts">
  import { saveProfile, type Profile } from '../lib/network';
  import { safeURL } from '../lib/ui';
  export let profile: Profile | undefined;
  export let ondone: () => void;
  let name = profile?.display_name || profile?.name || '',
    about = profile?.about || '',
    picture = profile?.picture || '',
    banner = profile?.banner || '',
    website = profile?.website || '',
    lud16 = profile?.lud16 || '',
    busy = false,
    error = '';
  const initial = {name, display_name:name, about, picture, banner, website, lud16};
  async function send() {
    if ([picture,banner,website].some(value => value.trim() && !safeURL(value.trim()))) {
      error = 'Use a full http or https URL for pictures, banners, and websites.';
      return;
    }
    busy = true;
    error = '';
    try {
      const next = {name:name.trim(),display_name:name.trim(),about:about.trim(),picture:picture.trim(),banner:banner.trim(),website:website.trim(),lud16:lud16.trim()};
      await saveProfile(Object.fromEntries(Object.entries(next).filter(([key,value]) => value !== initial[key as keyof typeof initial])));
      ondone();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save profile.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="dialog-content">
  <div class="eyebrow">PROFILE</div>
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
      >Banner URL<input type="url" bind:value={banner} placeholder="https://…"/></label
    ><label>Website<input type="url" bind:value={website} placeholder="https://…"/></label
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
