<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { profileUrl } from '../lib/profile-url';
  import { account, profiles, signInExtension, signInBunker, createProfile, importAccount, signOut, saveProfile } from '../lib/network';
  import { displayName } from '../lib/ui';
  import Icon from './Icon.svelte';
  import Mark from './Mark.svelte';

  export let onclose: () => void;
  export let notify: (s: string) => void;

  const first = ['Amber', 'Mossy', 'Quiet', 'Silver', 'Velvet', 'Golden', 'Copper', 'Sunny', 'Lunar', 'Gentle', 'Brisk', 'Curious'];
  const last = ['Finch', 'Fern', 'Otter', 'Heron', 'Comet', 'Wren', 'Badger', 'Robin', 'Clover', 'Moth', 'Fox', 'Sparrow'];
  function suggest(previous = '') {
    const i = Math.floor(Math.random() * first.length * last.length);
    function nameAt(n: number) {
      return first[Math.floor(n / last.length)] + ' ' + last[n % last.length];
    }
    return nameAt(i) === previous ? nameAt((i + 1) % (first.length * last.length)) : nameAt(i);
  }

  let nameInput: HTMLInputElement | undefined;
  onMount(() => {
    if (!$account && nameInput?.closest('dialog')?.open) { nameInput.focus(); nameInput.select(); }
  });
  let mode: 'new' | 'existing' | 'retry-name' = 'new';
  let name = suggest(), secret = '', error = '', busy = false;
  let bunker = '', showBunker = false, authUrl = '';
  let connection: AbortController | undefined;
  function cancelBunker() { connection?.abort(); connection = undefined; authUrl = ''; busy = false; }
  onDestroy(cancelBunker);
  function switchMode(next: typeof mode) {
    mode = next;
    error = '';
    secret = '';
    bunker = ''; showBunker = false; authUrl = '';
  }
  function changeName(value: string) {
    if (/nsec1[0-9a-z]+/i.test(value)) {
      switchMode('existing');
      if (/^nsec1[0-9a-z]+$/i.test(value.trim())) secret = value.trim();
      return;
    }
    name = value;
  }
  function pasteName(event: ClipboardEvent) {
    const pasted = event.clipboardData?.getData('text')?.trim();
    if (pasted && /nsec1[0-9a-z]+/i.test(pasted)) {
      event.preventDefault();
      changeName(pasted);
    }
  }
  async function submit(method: 'extension' | 'new' | 'import' | 'bunker') {
    if (busy) return;
    busy = true;
    error = '';
    const attempt = method === 'bunker' ? (connection = new AbortController()) : undefined;
    try {
      if (method === 'new') await createProfile(name);
      else if (method === 'extension') await signInExtension();
      else if (method === 'bunker') await signInBunker(bunker, attempt!.signal, url => authUrl = url);
      else await importAccount(secret.trim());
      secret = ''; bunker = ''; authUrl = '';
      notify(method === 'new' ? 'Profile created' : 'Signed in');
      onclose();
    } catch (e) {
      if (attempt?.signal.aborted) return;
      if (method === 'new' && $account) {
        switchMode('retry-name');
      }
      error = e instanceof Error ? e.message : 'Could not sign in.';
    } finally { if (!attempt || connection === attempt) { busy = false; connection = undefined; authUrl = ''; } }
  }
  async function retryName() {
    busy = true;
    try {
      const displayName = name.trim();
      if (!displayName || /nsec1[0-9a-z]+/i.test(displayName)) throw new Error('Choose a public display name.');
      await saveProfile({name:displayName, display_name:displayName});
      notify('Profile name published');
      onclose();
    } catch (e) { error = e instanceof Error ? e.message : 'Could not publish your name.'; }
    finally { busy = false; }
  }
</script>

<div class="dialog-content">
  <Mark size={46}/>
  {#if mode === 'retry-name' && $account}
    <h2>Publish your name</h2>
    <p>Your profile is saved on this device. Its display name hasn’t reached a relay yet.</p>
    <form onsubmit={(e) => {e.preventDefault(); retryName()}}>
      <label>Display name<input bind:value={name} required maxlength="60" autocomplete="nickname" /></label>
      <button class="primary wide" disabled={busy || !name.trim()}>{busy ? 'Publishing…' : 'Retry publishing name'}</button>
    </form>
    <button class="text-button" disabled={busy} onclick={onclose}>Continue without publishing</button>
  {:else if $account && !busy}
    <h2>Your profile</h2>
    <p>{displayName($account.pubkey, $profiles[$account.pubkey])}</p>
    <a class="outline wide" href={profileUrl($account.pubkey)} onclick={onclose}><Icon name="user"/> View profile</a>
    <button class="text-button" onclick={() => {signOut(); onclose(); notify('Signed out')}}><Icon name="logout"/> Sign out</button>
  {:else if mode === 'new'}
    <h2>Create a profile</h2>
    <form onsubmit={(e) => {e.preventDefault(); submit('new')}}>
      <label>Display name<input bind:this={nameInput} name="display-name" value={name} onpaste={pasteName} oninput={(e) => changeName(e.currentTarget.value)} required maxlength="60" autocomplete="nickname" /></label>
      <button type="button" class="name-suggestion" disabled={busy} onclick={() => name = suggest(name)}>Suggest another name</button>
      <button class="primary wide" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create profile'}</button>
    </form>
    <button class="text-button" disabled={busy} onclick={() => switchMode('existing')}>Use an existing profile</button>
  {:else}
    <h2>Sign in to your profile</h2>
    <button class="outline wide" disabled={busy} onclick={() => submit('extension')}><Icon name="key"/> Sign in with extension</button>
    {#if showBunker}
      <form onsubmit={(e) => {e.preventDefault(); submit('bunker')}}>
        <label>Bunker link<input type="password" bind:value={bunker} disabled={busy} required placeholder="bunker://…" spellcheck="false" autocomplete="off"/></label>
        <p class="signer-hint">Paste the connection link from your signer. Your secret key stays there.</p>
        <button class="primary wide" disabled={busy || !bunker.trim()}>{busy ? 'Waiting for signer…' : 'Connect signer'}</button>
      </form>
      {#if authUrl}<a class="outline wide" href={authUrl} target="_blank" rel="noopener noreferrer">Approve in signer <Icon name="external"/></a>{/if}
      {#if busy && connection}<button class="text-button" onclick={cancelBunker}>Cancel sign-in</button>{/if}
    {:else}
      <button class="outline wide" disabled={busy} onclick={() => {showBunker = true; error = ''}}><Icon name="link"/> Sign in with bunker</button>
    {/if}
    <form onsubmit={(e) => {e.preventDefault(); submit('import')}}>
      <label>Secret key<input type="password" bind:value={secret} required placeholder="nsec1…" spellcheck="false" autocomplete="off"/></label>
      <button class="primary wide" disabled={busy || !secret.trim()}>Sign in with secret key</button>
    </form>
    <button class="text-button" disabled={busy} onclick={() => switchMode('new')}>Create a new profile</button>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .name-suggestion {color:var(--green);font-size:13px;text-decoration:underline;text-underline-offset:3px}
  .signer-hint {font-size:13px;margin:0;color:var(--muted)}
</style>
