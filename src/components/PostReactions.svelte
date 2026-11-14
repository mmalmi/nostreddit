<script lang="ts">
  import { untrack } from 'svelte';
  import { likes, observePostReactions, observeReferences, profiles, receipts, type Post } from '../lib/network';
  import { lightningEndpoint, postTipSummary } from '../lib/zaps';
  import { displayName } from '../lib/ui';
  import { profileUrl } from '../lib/profile-url';
  import ProxyAvatar from './ProxyAvatar.svelte';
  import Icon from './Icon.svelte';
  import TipAmount from './TipAmount.svelte';

  type Tab = 'upvotes' | 'tips';
  type Summary = Awaited<ReturnType<typeof postTipSummary>>;
  let { post, initialTab }: {post:Post; initialTab:Tab} = $props();
  const id = $props.id();
  let tab = $state<Tab>('upvotes');
  let limit = $state(24);
  let checked = $state<{key:string; value:Summary}>();
  let tablist: HTMLDivElement;
  $effect(() => { tab = initialTab; });
  $effect(() => observePostReactions(post.id));
  let author = $derived($profiles[post.pubkey]);
  let records = $derived($receipts[post.id]);
  let voters = $derived($likes[post.id] ?? []);
  let checkKey = $derived(JSON.stringify([post.id, lightningEndpoint(author), ...(records ?? []).map(event => event.id)]));
  let summary = $derived(checked?.key === checkKey ? checked.value : undefined);
  $effect(() => {
    if (tab !== 'tips') return;
    let current = true;
    const key = checkKey;
    untrack(() => postTipSummary(post.event, author, records ?? [])).then(value => {
      if (current) checked = {key,value};
    });
    return () => { current = false; };
  });
  let rows = $derived(tab === 'tips'
    ? (summary?.groups ?? []).map(tip => ({pubkey:tip.sender, tip}))
    : voters.map(pubkey => ({pubkey, tip:null})));
  let page = $derived(rows.slice(0,limit));
  let nameKey = $derived(page.flatMap(row => row.pubkey ? [row.pubkey] : []).join(','));
  $effect(() => {
    if (!nameKey) return;
    const names = nameKey.split(',');
    // observeReferences accepts 24 people at a time.
    const stops: Array<() => void> = [];
    for (let i=0; i<names.length; i+=24) stops.push(observeReferences([],names.slice(i,i+24)));
    return () => stops.forEach(stop => stop());
  });
  function select(value:Tab) {
    if (value !== tab) { tab = value; limit = 24; }
  }
  function switchKey(event:KeyboardEvent) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'upvotes' : event.key === 'End' ? 'tips' : tab === 'tips' ? 'upvotes' : 'tips';
    select(next);
    tablist.querySelector<HTMLButtonElement>('#'+CSS.escape(id+'-'+next))?.focus();
  }
</script>

<section class="reactions-content">
  <h2>Reactions</h2>
  <p class="post-title">{post.title || post.body}</p>
  <div class="tabs" role="tablist" aria-label="Reaction type" bind:this={tablist}>
    {#each ['upvotes','tips'] as value}
      <button type="button" role="tab" id={id+'-'+value} aria-controls={id+'-panel'} aria-selected={tab===value}
        tabindex={tab===value ? 0 : -1} onclick={() => select(value as Tab)} onkeydown={switchKey}>
        <Icon name={value==='tips' ? 'zap' : 'arrow'} size={15}/>{value==='tips' ? 'Tips' : 'Upvotes'}
      </button>
    {/each}
  </div>
  <div role="tabpanel" id={id+'-panel'} aria-labelledby={id+'-'+tab} class="panel" tabindex="0">
    {#if tab === 'tips' && !summary}
      <p class="quiet" role="status">Checking tips…</p>
    {:else if tab === 'tips' && summary?.status === 'unavailable'}
      <p class="quiet" role="status">Tip receipts could not be verified.</p>
    {:else if rows.length}
      <div class="total">
        {#if tab === 'tips'}<span>Total shown</span><strong><TipAmount sats={(summary?.totalMillisats ?? 0)/1000}/></strong>
        {:else}<span>{voters.length} {voters.length === 1 ? 'upvote' : 'upvotes'}</span>{/if}
      </div>
      <ul>
        {#each page as row (row.pubkey)}
          <li>
            {#if row.pubkey}
              {@const name = displayName(row.pubkey,$profiles[row.pubkey])}
              <a href={profileUrl(row.pubkey)} aria-label={name}><span aria-hidden="true"><ProxyAvatar pubkey={row.pubkey} profile={$profiles[row.pubkey]} size={32}/></span><b>{name}</b></a>
            {:else}
              <span class="anonymous"><span class="anon-icon"><Icon name="user" size={17}/></span><b>Anonymous</b></span>
            {/if}
            {#if row.tip}
              <div class="amount"><TipAmount sats={row.tip.millisats/1000}/><small>{row.tip.count} {row.tip.count === 1 ? 'tip' : 'tips'}</small></div>
            {/if}
          </li>
        {/each}
      </ul>
      {#if rows.length > limit}<button class="more" onclick={() => limit += 24}>Show more</button>{/if}
    {:else}<p class="quiet">{tab === 'tips' ? 'No verified tips yet.' : 'No upvotes yet.'}</p>{/if}
  </div>
</section>

<style>
  .reactions-content {padding:24px;min-width:0}
  h2 {margin:0 40px 0 0;font:600 26px/1.2 var(--serif);letter-spacing:-.03em}
  .post-title {margin:6px 0 16px;color:var(--muted);font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tabs {display:flex;border-bottom:1px solid var(--line);gap:16px}
  .tabs button {display:inline-flex;align-items:center;gap:6px;padding:10px 2px;border-bottom:2px solid transparent;color:var(--muted);font-weight:650}
  .tabs button[aria-selected=true] {border-color:var(--accent);color:var(--accent)}
  .panel {max-height:min(55dvh,460px);overflow:auto}
  .total,li {display:flex;justify-content:space-between;align-items:center;gap:12px}
  .total {font-size:.79rem;color:var(--muted);padding:14px 0 8px}
  .total strong {color:var(--ink)}
  ul {margin:0;padding:0;list-style:none}
  li {padding:10px 0;border-bottom:1px solid var(--line);font-size:.9rem}
  li:last-child {border-bottom:0}
  li a,.anonymous {display:flex;align-items:center;gap:10px;min-width:0;color:var(--ink);text-decoration:none}
  li a:hover b {text-decoration:underline}
  li b {overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .anon-icon {display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:50%;background:var(--light);color:var(--muted)}
  .amount {flex:none;text-align:right;font-weight:650;font-variant-numeric:tabular-nums}
  small {display:block;color:var(--muted);font-size:.72rem;font-weight:400}
  .quiet {margin:18px 0 2px;color:var(--muted);font-size:.88rem}
  .more {margin-top:8px;padding:6px 0;color:var(--accent);font-weight:650}
</style>
