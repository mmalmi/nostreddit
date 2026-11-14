<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { account } from '../lib/network';
  import { uploadAttachment } from '../lib/uploads';
  import Icon from './Icon.svelte';
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
<div class="attachments">
  <label class="attachment-picker" class:disabled={disabled || busy}><Icon name="image" size={16}/>Attach files<input type="file" multiple disabled={disabled || busy} onchange={select}/></label>
  <small>Up to 8 MB each · public once posted</small>
</div>
{#if busy}<p role="status">Uploading and checking files…</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
<style>
  .attachments {display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0}
  .attachment-picker {display:inline-flex !important;align-items:center;gap:7px;margin:0 !important;padding:7px 12px;border:1px solid var(--line);border-radius:7px;font-size:13px;cursor:pointer;color:var(--ink);position:relative}
  .attachment-picker:hover {border-color:var(--accent);color:var(--accent)}
  .attachment-picker:focus-within {outline:2px solid var(--accent);outline-offset:2px}
  .attachment-picker.disabled {opacity:.55;cursor:default}
  .attachment-picker input {position:absolute;inset:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none}
  small {color:var(--muted);font-size:12px}
</style>
