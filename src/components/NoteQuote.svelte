<script lang="ts">
  import { posts, comments, profiles } from '../lib/network';
  import { postUrl } from '../lib/post-url';
  import { noteParts, partText } from '../lib/mentions';
  import { displayName, age } from '../lib/ui';
  export let id: string;
  $: post = $posts.find(post=>post.id===id) || $comments.find(post=>post.id===id);
  $: name = post ? displayName(post.pubkey,$profiles[post.pubkey]) : '';
  // Preview text is deliberately non-recursive: quotes cannot fan out into
  // more relay reads, and the whole card remains one accessible link.
  $: title = post ? noteParts(post.title,post.event.tags).map(part=>partText(part,$profiles)).join('') : '';
  $: body = post ? noteParts(post.body,post.event.tags).map(part=>partText(part,$profiles)).join('') : '';
</script>

{#if post}
  <a class="quoted-post" href={postUrl(id)} aria-label={'Open quoted post by '+name}>
    <span class="quote-byline"><b>{name}</b><span>·</span><time datetime={new Date(post.created_at*1000).toISOString()}>{age(post.created_at)}</time></span>
    {#if title}<strong>{title}</strong>{/if}
    {#if body && body !== title}<span class="quote-body">{body}</span>{/if}
  </a>
{/if}

<style>
  .quoted-post {display:block;min-width:0;margin:9px 0;padding:12px 14px;border:1px solid var(--line);border-radius:10px;color:var(--body-text);text-decoration:none;overflow-wrap:anywhere}
  .quoted-post:hover {border-color:var(--accent)}
  .quote-byline {display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:12px;color:var(--muted)}
  .quote-byline b {color:var(--body-text)}
  strong,.quote-body {display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}
  strong {line-clamp:2;-webkit-line-clamp:2;font-size:14px;line-height:1.4}
  .quote-body {line-clamp:3;-webkit-line-clamp:3;font-size:13px;line-height:1.5;margin-top:4px}
</style>
