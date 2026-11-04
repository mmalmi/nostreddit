<script lang="ts">
  import { isEventId, postUrl } from '../lib/post-url';
  import { profileUrl } from '../lib/profile-url';
  import {
    profiles,
    likes,
    comments,
    receipts,
    pendingWrites,
    outboxReady,
    account,
    type Post,
  } from '../lib/network';
  import { displayName, age, safeURL } from '../lib/ui';
  import { collectMedia } from '../lib/media';
  import { findTreeEmbeds, hasTreeCapability } from '../lib/tree-embeds';
  import { topicPath } from '../lib/hashtags';
  import { matchesTopic } from '../lib/posts';
  import MediaEmbed from './MediaEmbed.svelte';
  import { proxyImage } from '../lib/image-load';
  import TreeEmbed from './TreeEmbed.svelte';
  import { noteParts, partText } from '../lib/mentions';
  import ZapCount from '../lib/ZapCount.svelte';
  import NoteText from './NoteText.svelte';
  import Icon from './Icon.svelte';
  import TopicIcon from './TopicIcon.svelte';
  import SocialBadge from './SocialBadge.svelte';
  export let post: Post;
  export let saved = false;
  export let showPreviews = true;
  export let contextTopic: string | undefined = undefined;
  export let full = false;
  export let comment = false;
  export let onaction: (action: string, post: Post) => void;
  $: author = $profiles[post.pubkey];
  $: name = displayName(post.pubkey, author);
  $: likers = $likes[post.id] ?? [];
  $: liked = Boolean($account && likers.includes($account.pubkey));
  $: queued = $pendingWrites.some(row=>row.event?.id===post.id);
  $: replyCount = $comments.filter(
    (c) => (comment ? c.parent : c.root) === post.id,
  ).length;
  $: topic = contextTopic && matchesTopic(post,contextTopic) ? contextTopic : post.topic;
  $: permalink = postUrl(post.id, contextTopic && topic===contextTopic ? topic : undefined);
  $: body = post.body || '';
  $: link = hasTreeCapability(post.url) ? '' : safeURL(post.url);
  $: media = collectMedia(post.event.content,post.event.tags,link,post.event.kind);
  $: trees = findTreeEmbeds([post.event.content, ...post.event.tags.filter(t=>t[0]==='r').map(t=>t[1])].join(' '));
  $: renderEmbeds = full || showPreviews;
  $: embeddedLink = media.some(item=>item.url===link);
  $: attachments = [...media.map(item=>item.url),...trees.map(item=>item.raw)];
  function stripAttachments(text:string, urls:string[]) {
    let clean = text;
    for (const url of urls) clean = clean.split(url).join('');
    return clean.trim();
  }
  $: title = post.title || '';
  $: titleFromBody =
    !title && !comment && (body.split('\n')[0] || '').length < 150;
  $: rawHeading = title || (titleFromBody ? body.split('\n')[0] : '');
  $: autoShortened =
    !post.event.tags.some((t) => t[0] === 'subject' || t[0] === 'title') &&
    rawHeading.endsWith('…') &&
    body.startsWith(rawHeading.slice(0, -1));
  $: chosenHeading = autoShortened && full ? body.split('\n')[0] : rawHeading;
  $: strippedHeading = stripAttachments(chosenHeading,attachments);
  $: heading = comment || (full && post.parent) ? '' :
    strippedHeading === link && link ? new URL(link).hostname :
    strippedHeading || (trees.length ? trees[0].name : media.length ? (media[0].kind==='image' ? 'Photo' : media[0].kind==='audio' ? 'Audio' : 'Video')+' in r/'+topic : chosenHeading);
  $: remainder = (titleFromBody || (!comment && autoShortened)) ? body.split('\n').slice(1).join('\n').trim() : body;
  $: excerpt = post.parent && !full && !comment && remainder.startsWith(chosenHeading) ? remainder.slice(chosenHeading.length).trim() : remainder;
  $: cleanBody = renderEmbeds ? stripAttachments(excerpt,[...attachments,...(link ? [link] : [])]) : excerpt;
  $: visibleBody = full || comment ? cleanBody : cleanBody.replace(/\s*\n\s*/g, ' ');
  $: headingParts = noteParts(heading, post.event.tags);
  $: taggedHeading = headingParts.some(part=>part.topic);
  $: renderedHeading = headingParts.map(part => partText(part,$profiles)).join('');
  $: picture = safeURL(author?.picture);
</script>

<article class="post-card" class:detail={full} class:comment-card={comment}>
  <div class="byline">
    {#if !comment}<a
        class="community-link"
        href={topicPath(topic)}
        ><TopicIcon slug={topic} small />r/{topic}</a
      ><span class="sep">·</span>{/if}
    <a class="author" href={profileUrl(post.pubkey)} aria-label={name}
      >{#if comment && picture}<img
          use:proxyImage={{url:picture,width:18,square:true}}
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
        />{/if}{name} <SocialBadge pubkey={post.pubkey}/></a
    ><span class="sep">·</span>
    <a class="stamp" href={permalink}
      ><time datetime={new Date(post.created_at * 1000).toISOString()}
        >{age(post.created_at)}</time
      ></a
    >
    {#if isEventId(post.parent) && !full && !comment}<a class="stamp" href={postUrl(post.parent)}>Reply to discussion</a>{/if}
    {#if queued}<small class="queued" title="Saved on this device, waiting to sync">Queued</small>{/if}
  </div>
  {#if heading}<h2>
      {#if taggedHeading}
        {#each headingParts as part}
          {#if part.topic}<a class="hashtag" href={topicPath(part.topic)}>{part.text}</a>{:else if full}{partText(part,$profiles)}{:else}<a href={permalink}>{partText(part,$profiles)}</a>{/if}
        {/each}
      {:else if full}{renderedHeading}{:else}<a href={permalink}>{renderedHeading}</a>{/if}
    </h2>{/if}
  {#if visibleBody}<NoteText text={visibleBody} tags={post.event.tags} full={full || comment} />{/if}
  {#if renderEmbeds && (media.length || trees.length)}
    <div class="media-gallery" class:photos={media.length > 1 && !trees.length && media.every(item=>item.kind==='image')}>
      {#each media as item (item.url)}<MediaEmbed {item} compact={!full}/>{/each}
      {#each trees as attachment (attachment.url)}<TreeEmbed {attachment}/>{/each}
    </div>
  {:else if !renderEmbeds && trees.length}
    {#each trees as attachment (attachment.url)}<a class="external-post" href={attachment.viewerUrl} target="_blank" rel="noopener noreferrer">Open Hashtree attachment</a>{/each}
  {/if}
  {#if link && (!renderEmbeds || !embeddedLink)}<a
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
      disabled={!!$account && !$outboxReady}
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
    {:else}<a aria-label={replyCount + ' comments'} href={permalink}
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

<style>
  .hashtag {color:var(--green)}
  .queued {font-size:.7rem;color:var(--muted)}
  .media-gallery {display:grid;gap:8px;margin:9px 0;min-width:0}
  .media-gallery.photos {grid-template-columns:repeat(2,minmax(0,1fr))}
</style>
