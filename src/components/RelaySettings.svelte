<script lang="ts">
  import { configuredRelays, relayUrls, saveRelays } from '../lib/network';
  let addresses = $configuredRelays.join('\n');
  let error = '', saved = false;
  function save(value = addresses) {
    try { saveRelays(value); addresses = $configuredRelays.join('\n'); error = ''; saved = true; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save relay settings.'; saved = false; }
  }
</script>
<section class="preferences" aria-labelledby="relay-settings-title">
  <h2 id="relay-settings-title">Relays</h2>
  <p>Choose the servers used to read and publish posts. Changes apply immediately and are saved in this browser.</p>
  <form onsubmit={(event) => { event.preventDefault(); save(); }}>
    <label for="relay-addresses">One relay address per line</label>
    <textarea id="relay-addresses" rows="5" bind:value={addresses} oninput={() => saved = false} spellcheck="false" placeholder="wss://relay.example.com"></textarea>
    <div class="actions"><button type="submit">Save relays</button><button type="button" onclick={() => save(relayUrls.join('\n'))}>Restore defaults</button></div>
    {#if error}<p role="alert">{error}</p>{/if}
    {#if saved}<p role="status">Relay settings saved.</p>{/if}
  </form>
</section>
<style>
  textarea { width:100%; box-sizing:border-box; margin:.5rem 0; padding:.75rem; font:inherit; color:inherit; background:transparent; border:1px solid var(--border, #888); border-radius:.5rem; resize:vertical; }
  .actions { display:flex; gap:.75rem; flex-wrap:wrap; }
</style>
