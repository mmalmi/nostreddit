<script lang="ts">
  import {account,profiles} from '../lib/network';
  import ProxyAvatar from './ProxyAvatar.svelte';
  import Icon from './Icon.svelte';
  export let oncreate:(mode?:'text'|'link')=>void;
</script>

<div class="feed-composer" aria-label="Start a post">
  <div class="avatar" aria-hidden="true">
    {#if $account}<ProxyAvatar pubkey={$account.pubkey} profile={$profiles[$account.pubkey]} size={36}/>
    {:else}<Icon name="user" size={20}/>{/if}
  </div>
  <button class="post-prompt" onclick={()=>oncreate()}>Create a post</button>
  <button class="link-prompt" aria-label="Create a link post" title="Create a link post" onclick={()=>oncreate('link')}><Icon name="link" size={20}/></button>
</div>

<style>
  .feed-composer{display:flex;align-items:center;gap:10px;padding:12px;background:var(--paper);border:1px solid var(--line);border-radius:12px;margin:0 0 16px}
  .avatar{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:50%;background:var(--surface);color:var(--muted)}
  .post-prompt{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--muted);text-align:left;padding:11px 13px;font-size:14px}
  .post-prompt:hover{border-color:var(--accent);color:var(--ink)}
  .link-prompt{display:grid;place-items:center;width:40px;height:40px;flex:none;border-radius:8px;color:var(--muted)}
  .link-prompt:hover{background:var(--surface);color:var(--accent)}
  @media(max-width:420px){.feed-composer{gap:8px;padding:10px}.avatar{width:32px;height:32px}.post-prompt{padding:10px}.link-prompt{width:32px}}
</style>
