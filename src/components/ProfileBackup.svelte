<script lang="ts">
  import { exportKey, type Account } from '../lib/network';

  export let method: Account['method'];
  export let active = true;
  let secret = '', error = '';
  $: if (!active) { secret = ''; error = ''; }

  function toggleKey() {
    error = '';
    if (secret) {
      secret = '';
      return;
    }
    try { secret = exportKey(); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not reveal the key.'; }
  }
</script>

<section class="preferences backup" aria-labelledby="profile-backup">
  <h2 id="profile-backup">Profile backup</h2>
  {#if method === 'local'}
    <p>Keep a private copy of your secret key to use this profile on another device.</p>
    <button class="outline compact" aria-expanded={Boolean(secret)} onclick={toggleKey}>{secret ? 'Hide secret key' : 'Reveal secret key'}</button>
    {#if secret}
      <textarea aria-label="Your secret key" readonly value={secret} rows="2" spellcheck="false"></textarea>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {:else}
    <p>Your signing extension manages this profile’s secret key.</p>
  {/if}
</section>

<style>
  .backup { margin-top: 14px; }
  p { color: var(--muted); font-size: 14px; }
  button, textarea { margin-top: 10px; }
  textarea { display: block; width: 100%; font: 13px/1.5 var(--mono); padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); }
</style>
