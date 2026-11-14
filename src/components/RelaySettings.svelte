<script lang="ts">
  import { tick } from 'svelte';
  import { configuredRelays, relayConnections, relayUrls, saveRelays } from '../lib/network';
  import { maxRelays } from '../lib/relay-settings';
  import Icon from './Icon.svelte';

  let form: HTMLFormElement;
  let nextId = 0;
  let error = '', saved = false;
  function makeRow(address: string) { return { id: ++nextId, address }; }
  $: rows = $configuredRelays.map(makeRow);
  $: changed = rows.length !== $configuredRelays.length || rows.some((row, i) => row.address !== $configuredRelays[i]);
  const labels = { connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected', unsaved: 'Unsaved' };

  function clearFeedback() { error = ''; saved = false; }
  function editRow(index: number, address: string) {
    clearFeedback();
    rows[index] = { ...rows[index], address };
  }
  async function addRow() {
    clearFeedback();
    rows = [...rows, makeRow('')];
    await tick();
    form.querySelectorAll('input')[rows.length - 1]?.focus();
  }
  async function removeRow(index: number) {
    clearFeedback();
    rows = rows.filter((_, i) => i !== index);
    await tick();
    const inputs = form.querySelectorAll('input');
    (inputs[Math.min(index, inputs.length - 1)] ?? form.querySelector<HTMLButtonElement>('.add-relay'))?.focus();
  }
  function save(addresses: readonly string[]) {
    try { saveRelays(addresses); error = ''; saved = true; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save relay settings.'; saved = false; }
  }
</script>

<section class="preferences relay-settings" aria-labelledby="relay-settings-title">
  <form bind:this={form} novalidate onsubmit={event => { event.preventDefault(); save(rows.map(row => row.address)); }}>
    <div class="heading">
      <h2 id="relay-settings-title">Relays</h2>
      <button class="outline compact add-relay" type="button" disabled={rows.length >= maxRelays} onclick={addRow}>
        <Icon name="plus" size={14}/>Add relay
      </button>
    </div>
    <p class="description">Choose up to {maxRelays} relays to read and publish posts.</p>
    <ul class="relay-list" aria-label="Relay addresses">
      {#each rows as row, i (row.id)}
        {@const state = $configuredRelays.includes(row.address) ? ($relayConnections[row.address] ?? 'disconnected') : 'unsaved'}
        <li>
          <input type="text" inputmode="url" aria-label={'Relay address ' + (i + 1)} value={row.address}
            oninput={event => editRow(i, event.currentTarget.value)} autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="wss://relay.example.com"/>
          <span class="connection" data-state={state}>{labels[state]}</span>
          <button class="remove" type="button" aria-label={'Remove relay ' + (i + 1)} title="Remove relay" onclick={() => removeRow(i)}>
            <Icon name="close" size={16}/>
          </button>
        </li>
      {:else}
        <li class="empty">No relays selected.</li>
      {/each}
    </ul>
    <div class="actions">
      <button class="primary" type="submit" disabled={!changed}>Save relays</button>
      <button class="text-button" type="button" onclick={() => save(relayUrls)}>Restore defaults</button>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if saved}<p class="feedback" role="status">Relay settings saved.</p>{/if}
  </form>
</section>

<style>
  .relay-settings { min-width:0; container-type:inline-size; }
  .heading, .actions { display:flex; align-items:center; justify-content:space-between; gap:.75rem; }
  .heading h2 { margin:0; }
  .description, .feedback, .empty { color:var(--muted); font-size:13px; }
  .description { margin:.4rem 0 .95rem; }
  .relay-list { margin:0; padding:0; list-style:none; border-top:1px solid var(--line); }
  li { display:grid; grid-template-columns:minmax(0,1fr) 7rem 2.25rem; gap:.65rem; align-items:center;
    padding:.5rem 0; border-bottom:1px solid var(--line); }
  .empty { display:block; padding:1rem 0; }
  li input { width:100%; min-width:0; height:2.5rem; padding:0 .65rem; border:1px solid var(--line); border-radius:6px;
    background:var(--paper); color:var(--ink); font:inherit; }
  li input:hover { border-color:var(--strong-line); }
  .connection { display:inline-flex; align-items:center; gap:.45rem; color:var(--muted); font-size:12px; }
  .connection::before { content:''; width:8px; height:8px; flex:none; border-radius:50%; background:currentColor; }
  [data-state="connected"]::before { background:light-dark(#348157, #84c998); }
  [data-state="connecting"]::before { background:var(--gold); }
  [data-state="unsaved"]::before { background:transparent; border:1px solid currentColor; }
  .remove { display:grid; place-items:center; width:2.25rem; height:2.5rem; border-radius:6px; color:var(--muted); }
  .remove:hover { color:var(--error); background:var(--error-bg); }
  .actions { justify-content:flex-start; flex-wrap:wrap; margin-top:1rem; }
  .actions .text-button { margin:0; min-height:38px; }
  .feedback { margin:.6rem 0 0; }
  @container (max-width: 420px) {
    li { grid-template-columns:minmax(0,1fr) 2.25rem; gap:.25rem .5rem; }
    li input { font-size:16px; }
    .connection { grid-column:1; margin-left:.65rem; }
    .remove { grid-column:2; grid-row:1; }
  }
</style>
