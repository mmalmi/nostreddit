<script lang="ts">
  import { isEventId, postUrl } from '../lib/post-url';
  import { profileUrl } from '../lib/profile-url';
  import { account, profiles, notifications, observeNotificationAuthors, notificationPostId, unreadNotificationIds } from '../lib/network';
  import { displayName, age } from '../lib/ui';
  import type { NostrEvent } from 'nostr-pubsub';
  import Icon from './Icon.svelte';
  import SocialBadge from './SocialBadge.svelte';

  let { active = true, onSignIn }: { active?: boolean; onSignIn: () => void } = $props();
  $effect(() => {
    if (active && $account) return observeNotificationAuthors();
  });
  function detail(event: NostrEvent) {
    const reply = event.tags.some(t => t[0] === 'e' && !['mention'].includes(t[3])) || event.kind === 1111;
    if (event.kind === 7) {
      return { title: 'reacted to your post', icon: 'arrow' };
    }
    return { title: reply ? 'replied in a discussion' : 'mentioned you', icon: 'comment' };
  }
</script>

{#if !$account}
  <section class="empty"><Icon name="comment" size={28}/><h2>Your notifications</h2>
    <p>Sign in to see replies, mentions, and reactions from other people on Nostr.</p>
    <button class="primary compact" onclick={onSignIn}>Sign in</button>
  </section>
{:else if !$notifications.length}
  <section class="empty loading-state"><Icon name="comment" size={28}/><h2>No notifications seen yet</h2>
    <p>Replies, mentions, and reactions addressed to your Nostr profile appear here.</p>
  </section>
{:else}
  <section aria-label="Recent notifications" class="inbox">
    {#each $notifications as event (event.id)}
      {@const item = detail(event)}
      {@const id = notificationPostId(event)}
      <article class="activity">
        <span class="activity-icon"><Icon name={item.icon} size={18}/></span>
        <div><div><a class="activity-author" href={profileUrl(event.pubkey)} aria-label={displayName(event.pubkey,$profiles[event.pubkey])}><SocialBadge pubkey={event.pubkey}/> {displayName(event.pubkey,$profiles[event.pubkey])}</a> {item.title}</div>
          {#if $unreadNotificationIds.has(event.id)}<span class="unread">Unread</span>{/if}
          {#if event.kind !== 7}<p>{event.content.slice(0,180)}</p>{/if}
          {#if id && isEventId(id)}<a class="activity-link" href={postUrl(id)}>Open discussion ↗</a>{/if}
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
  .activity-author {font-weight:700;color:inherit}
  .activity-link {display:inline-block;margin-top:.4rem;font-size:.8rem;color:var(--accent)}
  .activity time {font-size:.75rem;color:var(--muted)}
  .activity p {margin:.35rem 0;overflow-wrap:anywhere}
</style>
