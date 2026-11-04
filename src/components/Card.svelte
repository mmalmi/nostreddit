<script lang="ts">
  import {
    profiles,
    likes,
    comments,
    receipts,
    account,
    type Post,
  } from '../lib/network';
  import { shortKey, age, safeURL } from '../lib/ui';
  import ZapCount from '../lib/ZapCount.svelte';
  import NoteText from './NoteText.svelte';
  import Icon from './Icon.svelte';
  import TopicIcon from './TopicIcon.svelte';
  export let post: Post;
  export let saved = false;
  export let showPreviews = true;
  export let full = false;
  export let comment = false;
  export let onaction: (action: string, post: Post) => void;
  $: author = $profiles[post.pubkey];
  $: name = author?.display_name || author?.name || shortKey(post.pubkey);
  $: likers = $likes[post.id] ?? [];
  $: liked = Boolean($account && likers.includes($account.pubkey));
  $: replyCount = $comments.filter(
    (c) => (comment ? c.parent : c.root) === post.id,
  ).length;
  $: photo =
    link && /\.(?:jpg|jpeg|png|webp|avif)$/i.test(new URL(link).pathname)
      ? link
      : '';
  $: body = post.body || '';
  $: link = safeURL(post.url);
  $: title = post.title || '';
  $: titleFromBody =
    !title && !comment && (body.split('\n')[0] || '').length < 150;
  $: rawHeading = title || (titleFromBody ? body.split('\n')[0] : '');
  $: autoShortened =
    !post.event.tags.some((t) => t[0] === 'subject' || t[0] === 'title') &&
    rawHeading.endsWith('…') &&
    body.startsWith(rawHeading.slice(0, -1));
  $: chosenHeading = autoShortened && full ? body.split('\n')[0] : rawHeading;
  $: heading = comment
    ? ''
    : link && chosenHeading === link
      ? photo
        ? 'Photo in r/' + post.topic
        : new URL(link).hostname
      : (link ? chosenHeading.replace(link, '').trim() : chosenHeading) ||
        chosenHeading;
  $: remainder =
    titleFromBody || (!comment && autoShortened)
      ? body.split('\n').slice(1).join('\n').trim()
      : body;
  $: cleanBody = link ? remainder.replace(link, '').trim() : remainder;
  $: visibleBody = full || comment ? cleanBody : cleanBody.replace(/\s*\n\s*/g, ' ');
  $: picture = safeURL(author?.picture);
</script>

<article class="post-card" class:detail={full} class:comment-card={comment}>
  <div class="byline">
    {#if !comment}<a
        class="community-link"
        href={'/r/' + encodeURIComponent(post.topic)}
        ><TopicIcon slug={post.topic} small />r/{post.topic}</a
      ><span class="sep">·</span>{/if}
    <a class="author" href={'/u/' + post.pubkey}
      >{#if comment && picture}<img
          src={picture}
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
        />{/if}{name}</a
    ><span class="sep">·</span>
    <a class="stamp" href={'/post/' + post.id}
      ><time datetime={new Date(post.created_at * 1000).toISOString()}
        >{age(post.created_at)}</time
      ></a
    >
  </div>
  {#if showPreviews && photo && !full && !comment}<a
      class="post-photo"
      href={'/post/' + post.id}
      aria-label="Open image discussion"
      ><img
        src={photo}
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        onerror={(e) =>
          e.currentTarget.closest('a')?.setAttribute('hidden', '')}
      /></a
    >{/if}
  {#if heading}<h2>
      {#if full}{heading}{:else}<a href={'/post/' + post.id}>{heading}</a>{/if}
    </h2>{/if}
  {#if visibleBody}<NoteText text={visibleBody} full={full || comment} />{/if}
  {#if photo && full}<a
      class="detail-photo"
      href={photo}
      target="_blank"
      rel="noopener noreferrer"
      ><img
        src={photo}
        alt={post.event.tags.find((t) => t[0] === 'alt')?.[1] ||
          'Attachment from the author'}
        loading="lazy"
        referrerpolicy="no-referrer"
      /></a
    >{/if}
  {#if link}<a
      class="external-post"
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      ><Icon name="link" size={15} /><span>{new URL(link).hostname}</span><Icon
        name="external"
        size={12}
      /></a
    >{/if}
  <div class="post-actions">
    <button
      class="like"
      class:chosen={liked}
      aria-pressed={liked}
      aria-label={liked ? 'Liked' : 'Like'}
      title={liked ? 'Remove like' : 'Like'}
      onclick={() => onaction('like', post)}
      ><Icon name="arrow" size={15} /><b>{likers.length}</b></button
    >
    {#if comment}<button
        aria-label="Reply to comment"
        onclick={() => onaction('reply', post)}
        ><Icon name="comment" size={15} /><span>Reply</span></button
      >
    {:else}<a aria-label={replyCount + ' comments'} href={'/post/' + post.id}
        ><Icon name="comment" size={16} /><span>{replyCount}</span></a
      >{/if}
    <button
      title="Zap with Lightning"
      aria-label="Zap with Lightning"
      onclick={() => onaction('zap', post)}
      ><Icon name="zap" size={15} /><ZapCount
        event={post.event}
        profile={author}
        receipts={$receipts[post.id] ?? []}
      /></button
    >
    <button
      title={saved ? 'Remove bookmark' : 'Save post'}
      aria-label={saved ? 'Remove bookmark' : 'Save post'}
      class:chosen={saved}
      aria-pressed={saved}
      onclick={() => onaction('save', post)}
      ><Icon name="save" size={15} /></button
    >
    <button
      class="share-button"
      title="Copy post link"
      aria-label="Copy post link"
      onclick={() => onaction('share', post)}
      ><Icon name="share" size={15} /></button
    >
  </div>
</article>
