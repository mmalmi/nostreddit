<script lang="ts">
  import { observeNotificationPosts } from '../lib/network';
  import { referencePosts } from '../lib/note-references';
  import { postUrl } from '../lib/post-url';

  let { targets, active }: { targets: string[]; active: boolean } = $props();
  let expanded = $state(false);
  $effect(() => {
    if (expanded && active) return observeNotificationPosts(targets);
  });
</script>

<details bind:open={expanded}>
  <summary>View posts</summary>
  {#if expanded}
    <ul>
      {#each targets as id, index (id)}
        <li><a href={postUrl(id)}>{$referencePosts.get(id)?.title || 'Post ' + (index + 1)}</a></li>
      {/each}
    </ul>
  {/if}
</details>

<style>
  details {margin-top:.4rem;font-size:.83rem}
  summary,a {color:var(--accent)}
  summary {width:fit-content;cursor:pointer}
  ul {list-style:none;padding:0;margin:.4rem 0 0}
  li {display:flex;align-items:baseline;gap:.6rem;padding:.35rem 0;border-top:1px solid var(--line)}
  li a {overflow-wrap:anywhere}
</style>
