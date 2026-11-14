<script lang="ts">
  import type { Snippet } from 'svelte';
  import { notificationReadId, type InboxEvent } from '../lib/notification-groups';
  import { age } from '../lib/ui';
  import TipAmount from './TipAmount.svelte';

  let { events, active, authorLink }: {events: InboxEvent[]; active: boolean; authorLink: Snippet<[string]>} = $props();
  let expanded = $state(false);
</script>

<details bind:open={expanded}>
  <summary>View tips</summary>
  {#if expanded}
    <ul>
      {#each events as event (notificationReadId(event))}
        {#if event.tip}
          <li>
            <span>{#if event.tip.sender}{@render authorLink(event.tip.sender)}{:else}Anonymous{/if}</span>
            <TipAmount sats={event.tip.millisats / 1000} {active}/>
            <time datetime={new Date(event.created_at * 1000).toISOString()}>{age(event.created_at)}</time>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</details>

<style>
  details {margin-top:.4rem;font-size:.83rem}
  summary {width:fit-content;cursor:pointer;color:var(--accent)}
  ul {list-style:none;margin:.4rem 0 0;padding:0}
  li {display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:baseline;gap:.7rem;border-top:1px solid var(--line);padding:.4rem 0}
  li > span {min-width:0;overflow-wrap:anywhere}
  time {color:var(--muted);font-size:.75rem}
</style>
