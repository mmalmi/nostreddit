<script lang="ts">
  import { account, profiles, signInExtension, createProfile, importAccount, exportKey, signOut, saveProfile } from '../lib/network';
  import { shortKey } from '../lib/ui';
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

  let mode: 'new' | 'existing' | 'backup' = 'new';
  let name = suggest(), secret = '', error = '', busy = false, reveal = false, pendingName = false;
  function switchMode(next: typeof mode) {
    mode = next;
    error = '';
    secret = '';
    reveal = false;
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
  async function submit(method: 'extension' | 'new' | 'import') {
    if (busy) return;
    busy = true;
    error = '';
    try {
      if (method === 'new') {
        await createProfile(name);
        switchMode('backup');
      } else {
        if (method === 'extension') await signInExtension();
        else await importAccount(secret.trim());
        secret = '';
        notify('Signed in');
        onclose();
      }
    } catch (e) {
      if (method === 'new' && $account) {
        switchMode('backup');
        pendingName = true;
      }
      error = e instanceof Error ? e.message : 'Could not sign in.';
    } finally { busy = false; }
  }
  async function retryName() {
    busy = true;
    try {
      await saveProfile({name:name.trim(), display_name:name.trim()});
      pendingName = false;
      error = '';
    } catch (e) { error = e instanceof Error ? e.message : 'Could not publish your name.'; }
    finally { busy = false; }
  }
  function backup() {
    try { secret = exportKey(); reveal = true; }
    catch (e) { error = String(e); }
  }
</script>

<div class="dialog-content">
  <Mark size={46}/>
  {#if mode === 'backup' && $account}
    <h2>Back up your profile</h2>
    <p>Your secret key lets you use this profile on another device. Store it somewhere private.</p>
    {#if pendingName}
      <p>Your profile is saved here. Its display name hasn’t reached a relay yet.</p>
      <button class="outline" disabled={busy} onclick={retryName}>Retry publishing name</button>
    {/if}
    {#if reveal}
      <textarea aria-label="Your secret key" readonly value={secret} rows="3"></textarea>
    {:else}
      <button class="outline" onclick={backup}><Icon name="eye"/> Reveal secret key</button>
    {/if}
    <button class="primary wide" onclick={() => {secret=''; onclose()}}>Continue to Nostreddit</button>
  {:else if $account && !busy}
    <h2>Your profile</h2>
    <p>{$profiles[$account.pubkey]?.display_name || $profiles[$account.pubkey]?.name || shortKey($account.pubkey)}</p>
    <a class="outline wide" href={'/u/' + $account.pubkey} onclick={onclose}><Icon name="user"/> View profile</a>
    {#if $account.method === 'local'}
      <button class="outline wide" onclick={() => switchMode('backup')}><Icon name="key"/> Back up secret key</button>
    {/if}
    <button class="text-button" onclick={() => {signOut(); onclose(); notify('Signed out')}}><Icon name="logout"/> Sign out</button>
  {:else if mode === 'new'}
    <h2>Create a profile</h2>
    <form onsubmit={(e) => {e.preventDefault(); submit('new')}}>
      <label>Display name<input name="display-name" value={name} onpaste={pasteName} oninput={(e) => changeName(e.currentTarget.value)} required maxlength="60" autocomplete="nickname" /></label>
      <button type="button" class="name-suggestion" disabled={busy} onclick={() => name = suggest(name)}>Suggest another name</button>
      <button class="primary wide" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create profile'}</button>
    </form>
    <button class="text-button" disabled={busy} onclick={() => switchMode('existing')}>Use an existing profile</button>
  {:else}
    <h2>Sign in to your profile</h2>
    <button class="outline wide" disabled={busy} onclick={() => submit('extension')}><Icon name="key"/> Sign in with extension</button>
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
</style>
