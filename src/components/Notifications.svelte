<script lang="ts">
  import { postUrl } from '../lib/post-url';
  import { profileUrl } from '../lib/profile-url';
  import { account, profiles, notificationGroups, observeNotificationAuthors, observeNotificationPosts, unreadNotificationIds } from '../lib/network';
  import { displayName, age } from '../lib/ui';
  import type { NostrEvent } from 'nostr-pubsub';
  import { notificationReadId } from '../lib/notification-groups';
  import { referencePosts } from '../lib/note-references';
  import { seeNotification } from '../lib/notification-visibility';
  import NoteText from './NoteText.svelte';
  import NotificationPosts from './NotificationPosts.svelte';
  import NotificationTips from './NotificationTips.svelte';
  import TipAmount from './TipAmount.svelte';
  import Icon from './Icon.svelte';
  import ProxyAvatar from './ProxyAvatar.svelte';
  import SocialBadge from './SocialBadge.svelte';

  let { active = true, onSignIn }: { active?: boolean; onSignIn: () => void } = $props();
  $effect(() => {
    if (active && $account) return observeNotificationAuthors();
  });
  let previewPostIds = $derived([...new Set($notificationGroups.filter(group => group.latest.tip || (group.latest.kind === 7 && group.targets.length === 1)).flatMap(group => group.targets))].sort().join(','));
  $effect(() => {
    if (active && previewPostIds) return observeNotificationPosts(previewPostIds.split(','));
  });
  function detail(event: NostrEvent) {
    const reply = event.tags.some(t => t[0] === 'e' && !['mention'].includes(t[3])) || event.kind === 1111;
    if (event.kind === 9735) return {title:'sent you a tip', icon:'zap'};
    if (event.kind === 7) {
      return { title: 'reacted', icon: 'arrow' };
    }
    return { title: reply ? 'replied in a discussion' : 'mentioned you', icon: 'comment' };
  }
</script>

{#snippet authorLink(pubkey: string)}
  <a class="activity-author" href={profileUrl(pubkey)}>
    <ProxyAvatar {pubkey} profile={$profiles[pubkey]} size={18}/><SocialBadge {pubkey}/>
    <span>{displayName(pubkey,$profiles[pubkey])}</span>
  </a>
{/snippet}

{#if !$account}
  <section class="empty"><Icon name="comment" size={28}/><h2>Your notifications</h2>
    <p>Sign in to see replies, mentions, reactions, and tips from other people on Nostr.</p>
    <button class="primary compact" onclick={onSignIn}>Sign in</button>
  </section>
{:else if !$notificationGroups.length}
  <section class="empty loading-state"><Icon name="comment" size={28}/><h2>No notifications seen yet</h2>
    <p>Replies, mentions, reactions, and tips addressed to your Nostr profile appear here.</p>
  </section>
{:else}
  <section aria-label="Recent notifications" class="inbox">
    {#each $notificationGroups as group (group.key)}
      {@const event = group.latest}
      {@const item = detail(event)}
      {@const id = group.targets[0]}
      {@const groupedTips = event.tip && group.events.length > 1}
      {@const unread = group.events.map(notificationReadId).filter(id => $unreadNotificationIds.has(id))}
      <article class="activity">
        <span class="activity-icon"><Icon name={item.icon} size={18}/></span>
        <div class="activity-body">
          <div use:seeNotification={{owner:$account.pubkey, active, unread}}>
            {#if groupedTips}
              <strong>{group.events.length} tips</strong> on your post
            {:else}
              {#if !group.authors.length}Someone{/if}
              {#each group.authors.slice(0,2) as author, index (author)}
                {#if index}{group.authors.length > 2 ? ', ' : ' and '}{/if}
                {@render authorLink(author)}{/each}
              {#if group.authors.length > 2} and {group.authors.length - 2} {group.authors.length === 3 ? 'other' : 'others'}{/if}
              {event.kind === 7 && id
                ? 'reacted to ' + (group.targets.length > 1 ? group.targets.length + ' posts' : $referencePosts.get(id)?.pubkey === $account.pubkey ? 'your post' : 'a post')
                : item.title}
            {/if}
            {#if event.tip} · <TipAmount sats={group.tipMillisats / 1000} {active}/>{/if}
          </div>
          {#if unread.length}<span class="unread">Unread</span>{/if}
          {#if groupedTips}
            <NotificationTips events={group.events} {active} {authorLink}/>
          {:else if group.authors.length > 2}
            <details class="people">
              <summary>View people</summary>
              {#each group.authors as author (author)}
                {@render authorLink(author)}
              {/each}
            </details>
          {/if}
          {#if event.kind !== 7 && event.kind !== 9735}<NoteText text={event.content} tags={event.tags} {active}/>{/if}
          {#if group.targets.length > 1}
            <NotificationPosts targets={group.targets} {active}/>
          {:else if id}<a class="activity-link" href={postUrl(id)}>{((event.tip || event.kind === 7) && $referencePosts.get(id)?.title) || 'Open discussion'} ↗</a>{/if}
        </div><time datetime={new Date(event.created_at*1000).toISOString()}>{age(event.created_at)}</time>
      </article>
    {/each}
  </section>
{/if}

<style>
  .inbox {display:grid;gap:.65rem}
  .activity {display:grid;grid-template-columns:2rem minmax(0,1fr) auto;align-items:start;gap:.8rem;border:1px solid var(--line);background:var(--paper);border-radius:12px;padding:1rem;color:var(--ink);font-size:.9rem;line-height:1.45}
  .unread {font-size:.75rem;font-weight:700;color:var(--accent)}
  .activity-icon {display:grid;place-items:center;border-radius:50%;width:2rem;height:2rem;background:var(--light)}
  .activity-body {min-width:0;overflow-wrap:anywhere}
  .activity-author {display:inline-flex;align-items:center;gap:4px;vertical-align:middle;max-width:100%;font-weight:700;color:inherit}
  .activity-link {display:inline-block;margin-top:.4rem;font-size:.8rem;color:var(--accent)}
  .activity time {font-size:.75rem;color:var(--muted)}
  .people {margin-top:.4rem;font-size:.83rem}
  .people summary {cursor:pointer;color:var(--accent);width:fit-content}
  .people .activity-author {display:flex;width:fit-content;padding:.22rem 0}
  .activity-body :global(.note-text) {margin:.35rem 0}
</style>
