<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { account, comments, likes, mutes, observe, profiles, publishComment, type Post, type Profile } from '../lib/network';
  import { graphInfo, observeAuthors } from '../lib/graph';
  import { commentRows, discussionPosts, visibleCommentRows, type CommentOrder } from '../lib/thread';
  import { readLocal, displayName, writeLocal } from '../lib/ui';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';

  export let thread: Post;
  export let saved: Post[];
  export let onaction: (action: string, post: Post) => void;
  export let onSignIn: () => void;
  export let notify: (message: string) => void;

  let order: CommentOrder = readLocal<CommentOrder>('commentOrder','top');
  let collapsed = new Set<string>();
  let limit = 48;
  let active = '';
  let lastPublished = '';
  let draftOwner = '';
  let drafts: Record<string, string> = {};
  let sending = new Set<string>();
  let errors: Record<string, string> = {};
  let mounted = false;
  let stop: (() => void) | undefined;

  function useDraftOwner(owner: string) {
    if (owner === draftOwner) return;
    drafts = {}; errors = {}; lastPublished = ''; sending = new Set();
    if (draftOwner) active = '';
    draftOwner = owner;
  }
  $: useDraftOwner($account?.pubkey ?? '');
  $: members = discussionPosts(thread.id, $comments);
  $: if (mounted) observeAuthors([thread.pubkey, ...members.slice(0,239).map(p => p.pubkey)]);
  $: muted = new Set($mutes);
  $: rows = commentRows(thread.id, members.filter(p => !muted.has(p.pubkey) && !$graphInfo[p.pubkey]?.muted), order, $likes);
  $: expanded = visibleCommentRows(rows, collapsed);
  $: visible = expanded.slice(0, limit);
  // Bound relay work to the displayed slice, including the active post.
  $: watched = [thread.id, ...visible.slice(-48).map(row => row.post.id)].sort().join(',');
  $: if (mounted) watch(watched);
  onMount(() => { mounted = true; return () => stop?.(); });
  function watch(ids: string) {
    stop?.();
    stop = observe(ids.split(','));
  }
  function author(pubkey: string, profile?: Profile) {
    return displayName(pubkey,profile);
  }
  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    collapsed = next;
  }
  async function handle(kind: string, post: Post) {
    if (kind !== 'reply') return onaction(kind, post);
    active = post.id;
    if (!$account) { onSignIn(); return; }
    await tick();
    document.getElementById('reply-' + post.id)?.focus();
  }
  async function send(parent: Post) {
    const text = (drafts[parent.id] ?? '').trim();
    if (!$account) { onSignIn(); return; }
    if (!text || sending.has(parent.id)) return;
    const owner = $account.pubkey;
    sending = new Set(sending).add(parent.id);
    errors = {...errors, [parent.id]: ''};
    try {
      const published = await publishComment(parent, text);
      if ($account?.pubkey !== owner) return;
      lastPublished = published.id;
      drafts = {...drafts, [parent.id]: ''};
      if (active === parent.id) active = '';
      notify('Reply saved');
    } catch (e) {
      if ($account?.pubkey === owner) errors = {...errors, [parent.id]: e instanceof Error ? e.message : 'Could not publish reply.'};
    } finally {
      if ($account?.pubkey === owner) { const next = new Set(sending); next.delete(parent.id); sending = next; }
    }
  }
</script>

{#snippet composer(parent: Post, nested: boolean)}
  <form class="reply-form" onsubmit={(e) => {e.preventDefault(); send(parent);}}>
    <textarea id={'reply-' + parent.id} aria-label={nested ? 'Your reply to ' + author(parent.pubkey, $profiles[parent.pubkey]) : 'Your reply'}
      placeholder={nested ? 'Reply to ' + author(parent.pubkey, $profiles[parent.pubkey]) + '…' : 'Add to the discussion…'}
      value={drafts[parent.id] ?? ''} oninput={(e) => drafts = {...drafts, [parent.id]:e.currentTarget.value}}
      rows="2" maxlength="20000" disabled={sending.has(parent.id)}></textarea>
    {#if errors[parent.id]}<p class="error" role="alert">{errors[parent.id]}</p>{/if}
    <div class="form-actions">
      {#if nested}<button type="button" class="cancel" onclick={() => active = ''}>Cancel</button>{/if}
      <button class="primary compact" disabled={!drafts[parent.id]?.trim() || sending.has(parent.id)}>{sending.has(parent.id) ? 'Publishing…' : 'Post reply'}</button>
    </div>
  </form>
{/snippet}

<section class="discussion">
  <div class="section-title"><h2>Comments</h2><span class="mono">{rows.length}</span>
    <label class="comment-order">Sort
      <select aria-label="Sort comments" bind:value={order} onchange={(e) => writeLocal('commentOrder',e.currentTarget.value)}>
        <option value="top">Top</option><option value="new">New</option><option value="old">Old</option>
      </select>
    </label>
  </div>
  {#if $account}{@render composer(thread, false)}{:else}
    <button class="guest-reply" onclick={onSignIn}><Icon name="comment"/> Sign in to leave a comment <Icon name="next" size={14}/></button>
  {/if}
  {#if lastPublished && !visible.some(row => row.post.id === lastPublished)}<a class="parent-context" href={'/post/'+lastPublished}>View your reply</a>{/if}
  <ol class="thread-list">
    {#each visible as row (row.post.id)}
      {@const p = row.post}
      {@const closed = collapsed.has(p.id)}
      <li data-comment-id={p.id} data-depth={row.depth} style={'--depth:' + row.depth} class:top={row.depth === 0}>
        <div class="branch">
          <button class="branch-toggle" aria-expanded={!closed} aria-label={(closed ? 'Expand' : 'Collapse') + ' comment by ' + author(p.pubkey, $profiles[p.pubkey])}
            title={closed ? 'Expand branch' : 'Collapse branch'} onclick={() => toggle(p.id)}>
            <span aria-hidden="true">{closed ? '+' : '−'}</span>
          </button>
          <div class="branch-body">
            {#if closed}
              <button class="collapsed-label" onclick={() => toggle(p.id)}>
                <strong>{author(p.pubkey, $profiles[p.pubkey])}</strong><span>{row.descendants ? row.descendants + (row.descendants === 1 ? ' reply' : ' replies') : 'Collapsed'}</span>
              </button>
            {:else}
              {#if row.missingParent && p.parent && p.parent !== p.id}<a class="parent-context" href={'/post/' + p.parent}>View parent comment</a>{/if}
              <Card post={p} comment saved={saved.some(s => s.id === p.id)} onaction={handle}/>
              {#if row.depth >= 5 && row.descendants}<a class="parent-context" href={'/post/'+p.id}>Continue this thread →</a>{/if}
              {#if active === p.id && $account}{@render composer(p, true)}{/if}
            {/if}
          </div>
        </div>
      </li>
    {/each}
  </ol>
  {#if !rows.length}<p class="quiet">No comments loaded yet.</p>{/if}
  {#if expanded.length > limit}<button class="outline wide" onclick={() => limit += 48}>More comments</button>{/if}
</section>

<style>
  .comment-order {margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
  .comment-order select {font:inherit;font-weight:600;background:var(--paper);color:var(--ink);padding:4px 6px;border:1px solid var(--line);border-radius:6px}
  .thread-list {--step:18px;--max-depth:7;list-style:none;margin:0;padding:0}
  .thread-list li {--indent:calc(min(var(--depth),var(--max-depth)) * var(--step));padding-left:var(--indent);position:relative}
  .thread-list li::before {content:'';position:absolute;left:0;top:0;bottom:0;width:var(--indent);pointer-events:none;background:repeating-linear-gradient(to right, transparent 0 8px,var(--line) 8px 9px,transparent 9px var(--step))}
  .thread-list li.top {border-top:1px solid var(--line);margin-top:8px}
  .branch {display:grid;grid-template-columns:18px minmax(0,1fr);column-gap:6px}
  .branch-toggle {margin-top:9px;width:18px;position:relative;display:flex;align-items:flex-start;justify-content:center;color:var(--muted)}
  .branch-toggle span {display:grid;place-items:center;border:1px solid var(--line);border-radius:50%;width:15px;height:15px;font:13px/1 var(--sans);background:var(--paper)}
  .branch-toggle[aria-expanded='true']::after {content:'';position:absolute;width:1px;top:18px;bottom:0;background:var(--line)}
  .branch-toggle:hover span,.branch-toggle:focus-visible span {border-color:var(--green);color:var(--green)}
  .branch-toggle:hover::after {background:var(--green)}
  .branch-body {min-width:0}
  .branch-body :global(.comment-card) {padding:7px 0 8px;border:0;background:none}
  .collapsed-label {display:flex;align-items:baseline;gap:9px;min-height:36px;font-size:12px;text-align:left}
  .collapsed-label span,.parent-context,.cancel {font-size:12px;color:var(--muted)}
  .parent-context {display:inline-block;margin:6px 0 2px;text-decoration:underline}
  .form-actions {display:flex;gap:12px;align-items:center}
  .branch-body .reply-form {margin:3px 0 10px}
  @media(max-width:710px) {
    .thread-list {--step:12px;--max-depth:5}
    .branch {column-gap:4px}
  }
</style>
