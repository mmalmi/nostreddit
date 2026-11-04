<script lang="ts">
  import { account, profiles, notifications, loadNotifications } from '../lib/network';
  import { shortKey, age } from '../lib/ui';
  import type { NostrEvent } from 'nostr-pubsub';
  import Icon from './Icon.svelte';

  let { onSignIn }: { onSignIn: () => void } = $props();
  $effect(() => {
    if ($account) return loadNotifications($account.pubkey);
  });
  function detail(event: NostrEvent) {
    const reply = event.tags.some(t => t[0] === 'e' && !['mention'].includes(t[3])) || event.kind === 1111;
    if (event.kind === 7) {
      const id = event.tags.filter(t => t[0] === 'e').at(-1)?.[1];
      return { title: 'reacted to your post', id, icon: 'arrow' };
    }
    return { title: reply ? 'replied in a discussion' : 'mentioned you', id: event.id, icon: 'comment' };
  }
</script>

{#if !$account}
  <section class="empty"><Icon name="comment" size={28}/><h2>Your notifications</h2>
    <p>Sign in to see replies, mentions, and reactions from other people on Nostr.</p>
    <button class="primary compact" onclick={onSignIn}>Sign in</button>
  </section>
{:else if !$notifications.length}
  <section class="empty"><Icon name="comment" size={28}/><h2>No notifications loaded</h2>
    <p>Replies, mentions, and reactions addressed to your Nostr profile appear here.</p>
  </section>
{:else}
  <section aria-label="Recent notifications" class="inbox">
    {#each $notifications as event (event.id)}
      {@const item = detail(event)}
      <article class="activity">
        <span class="activity-icon"><Icon name={item.icon} size={18}/></span>
        <div><div><a class="activity-author" href={'/u/' + event.pubkey}>{$profiles[event.pubkey]?.display_name || $profiles[event.pubkey]?.name || shortKey(event.pubkey)}</a> {item.title}</div>
          {#if event.kind !== 7}<p>{event.content.slice(0,180)}</p>{/if}
          {#if item.id && /^[a-f0-9]{64}$/.test(item.id)}<a class="activity-link" href={'/post/' + item.id}>Open discussion ↗</a>{/if}
        </div><time datetime={new Date(event.created_at*1000).toISOString()}>{age(event.created_at)}</time>
      </article>
    {/each}
  </section>
{/if}

<style>
  .inbox {display:grid;gap:.65rem}
  .activity {display:grid;grid-template-columns:2rem minmax(0,1fr) auto;align-items:start;gap:.8rem;border:1px solid #deded1;background:#fffef8;border-radius:12px;padding:1rem;color:#294337;font-size:.9rem;line-height:1.45}
  .activity-icon {display:grid;place-items:center;border-radius:50%;width:2rem;height:2rem;background:#e7eedc}
  .activity-author {font-weight:700;color:inherit}
  .activity-link {display:inline-block;margin-top:.4rem;font-size:.8rem;color:#395e42}
  .activity time {font-size:.75rem;color:#687366}
  .activity p {margin:.35rem 0;overflow-wrap:anywhere}
</style>
