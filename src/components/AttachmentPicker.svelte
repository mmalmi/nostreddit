<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { account } from '../lib/network';
  import { uploadAttachment } from '../lib/uploads';
  export let disabled = false;
  export let onattach: (link: string) => void;
  export let onbusy: (busy: boolean) => void = () => {};
  let busy = false, error = '', alive = true;
  onDestroy(() => { alive = false; });
  async function select(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []); input.value = '';
    if (!files.length || busy) return;
    const owner = get(account)?.pubkey;
    if (!owner) { error = 'Sign in to attach files.'; return; }
    busy = true; error = ''; onbusy(true);
    try {
      for (const file of files) {
        const link = await uploadAttachment(file);
        if (!alive || get(account)?.pubkey !== owner) return;
        onattach(link);
      }
    } catch (e) { if (alive) error = e instanceof Error ? e.message : 'Could not upload file.'; }
    finally { busy = false; if (alive) onbusy(false); }
  }
</script>
<label class="attachment-picker">Attach files<input type="file" multiple disabled={disabled || busy} onchange={select}/></label>
<small>Up to 8 MB each · Files become public when posted</small>
{#if busy}<p role="status">Uploading and checking files…</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
<style>
  .attachment-picker {display:block;margin:10px 0;font-size:13px}
  input {display:block;max-width:100%;margin-top:6px;font-size:13px}
  small {color:var(--muted);font-size:12px}
</style>
