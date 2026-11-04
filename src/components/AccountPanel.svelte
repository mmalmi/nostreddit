<script lang="ts">
  import {
    account,
    profiles,
    signInExtension,
    createAccount,
    importAccount,
    exportKey,
    signOut,
  } from '../lib/network';
  import Icon from './Icon.svelte';
  import Mark from './Mark.svelte';
  import { shortKey } from '../lib/ui';
  export let onclose: () => void;
  export let notify: (s: string) => void;
  let mode: 'home' | 'new' | 'import' | 'backup' = 'home';
  let name = '',
    secret = '',
    error = '',
    busy = false,
    reveal = false;
  async function submit(method: 'extension' | 'new' | 'import') {
    if (busy) return;
    busy = true;
    error = '';
    try {
      if (method === 'extension') await signInExtension();
      else if (method === 'new') await createAccount(name.trim());
      else await importAccount(secret.trim());
      secret = '';
      if (method === 'new') mode = 'backup';
      else {
        notify('Signed in');
        onclose();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not sign in.';
    } finally {
      busy = false;
    }
  }
  function backup() {
    try {
      secret = exportKey();
      reveal = true;
    } catch (e) {
      error = String(e);
    }
  }
</script>

<div class="dialog-content">
  <Mark size={46} />
  {#if mode === 'backup' && $account}
    <h2>Back up your account</h2>
    <p>
      Your secret key lets you use this account on another device. Store it
      somewhere private.
    </p>
    {#if reveal}<textarea
        aria-label="Your secret key"
        readonly
        value={secret}
        rows="3"></textarea>{:else}<button class="outline" onclick={backup}
        ><Icon name="eye" /> Reveal secret key</button
      >{/if}
    <button
      class="primary wide"
      onclick={() => {
        secret = '';
        onclose();
      }}>Continue to Nostreddit</button
    >
  {:else if $account}
    <h2>Your account</h2>
    <p>
      {$profiles[$account.pubkey]?.display_name ||
        $profiles[$account.pubkey]?.name ||
        shortKey($account.pubkey)}
    </p>
    <a class="outline wide" href={'/u/' + $account.pubkey} onclick={onclose}
      ><Icon name="user" />View profile</a
    >
    {#if $account.method === 'local'}<button
        class="outline wide"
        onclick={() => (mode = 'backup')}
        ><Icon name="key" />Back up secret key</button
      >{/if}
    <button
      class="text-button"
      onclick={() => {
        signOut();
        onclose();
        notify('Signed out');
      }}><Icon name="logout" /> Sign out</button
    >
  {:else if mode === 'home'}
    <h2>Join the conversation</h2>
    <p>
      Use your Nostr account to post, reply, and follow people across the
      network.
    </p>
    <button
      class="primary wide"
      disabled={busy}
      onclick={() => submit('extension')}
      ><Icon name="key" />{busy
        ? 'Connecting…'
        : 'Sign in with extension'}</button
    >
    <button
      class="outline wide"
      onclick={() => {
        mode = 'new';
        error = '';
      }}><Icon name="plus" /> Create an account</button
    >
    <button
      class="text-button"
      onclick={() => {
        mode = 'import';
        error = '';
      }}>Use a secret key</button
    >
  {:else}
    <h2>{mode === 'new' ? 'Create your account' : 'Use your secret key'}</h2>
    <p>
      {mode === 'new'
        ? 'Choose a display name. Your new Nostr key will be stored in this browser.'
        : 'Your key stays in this browser and signs your posts locally.'}
    </p>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        submit(mode === 'new' ? 'new' : 'import');
      }}
    >
      {#if mode === 'new'}<label
          >Display name<input
            bind:value={name}
            placeholder="Your name"
            maxlength="60"
            autocomplete="nickname"
          /></label
        >
      {:else}<label
          >Secret key<input
            type="password"
            bind:value={secret}
            required
            placeholder="nsec1…"
            spellcheck="false"
            autocomplete="off"
          /></label
        >{/if}
      <button class="primary wide" disabled={busy}
        >{busy
          ? 'Connecting…'
          : mode === 'new'
            ? 'Create account'
            : 'Sign in'}</button
      >
    </form>
    <button
      class="text-button"
      onclick={() => {
        mode = 'home';
        error = '';
        secret = '';
      }}>Back</button
    >
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>
