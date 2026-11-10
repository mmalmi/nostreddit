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
  import { collectMedia, stripMediaUrls } from '../lib/media';
  import { findTreeEmbeds, hasTreeCapability } from '../lib/tree-embeds';
  import { topicPath } from '../lib/hashtags';
  import { matchesTopic } from '../lib/posts';
  import MediaEmbed from './MediaEmbed.svelte';
  import { proxyImage } from '../lib/image-load';
  import TreeEmbed from './TreeEmbed.svelte';
  import { noteParts, partText } from '../lib/mentions';
  import { referencePosts } from '../lib/note-references';
  import ZapCount from '../lib/ZapCount.svelte';
  import NoteText from './NoteText.svelte';
  import Icon from './Icon.svelte';
  import TopicIcon from './TopicIcon.svelte';
  import SocialBadge from './SocialBadge.svelte';
  import PostMenu from './PostMenu.svelte';
  export let post: Post;
  export let saved = false;
  export let preview = false;
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
  $: photoAlbum = media.length > 1 && media.every(item=>item.kind==='image');
  $: shownMedia = !full && photoAlbum ? media.slice(0,4) : media;
  $: trees = findTreeEmbeds([post.event.content, ...post.event.tags.filter(t=>t[0]==='r').map(t=>t[1])].join(' '));
  $: renderEmbeds = full || showPreviews;
  $: embeddedLink = media.some(item=>item.url===link);
  $: attachments = [...media.map(item=>item.url),...trees.map(item=>item.raw)];
  function stripAttachments(text:string, urls:string[]) {
    let clean = stripMediaUrls(text,urls);
    for (const url of urls.filter(url=>!/^https?:\/\//i.test(url) || hasTreeCapability(url))) clean = clean.split(url).join('');
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
  $: firstLine = body.split('\n')[0];
  $: referenceHeading = autoShortened && noteParts(firstLine,post.event.tags).some(part=>part.event || part.person);
  // Clean the complete line before shortening it: otherwise a truncated image
  // URL cannot match its attachment and leaks into the headline.
  $: chosenHeading = autoShortened ? firstLine : rawHeading;
  $: strippedHeading = stripAttachments(chosenHeading,attachments);
  $: longProse = autoShortened && strippedHeading.length > 180 && !referenceHeading;
  $: heading = comment || (full && (post.parent || longProse)) ? '' :
    strippedHeading === link && link ? new URL(link).hostname :
    strippedHeading || (trees.length ? trees[0].name : media.length ? (media[0].kind==='image' ? 'Photo' : media[0].kind==='audio' ? 'Audio' : 'Video')+' in t/'+topic : chosenHeading);
  $: remainder = (titleFromBody || (!comment && autoShortened && !(full && longProse))) ? body.split('\n').slice(1).join('\n').trim() : body;
  $: excerpt = post.parent && !full && !comment && remainder.startsWith(chosenHeading) ? remainder.slice(chosenHeading.length).trim() : remainder;
  $: cleanBody = renderEmbeds ? stripAttachments(excerpt,[...attachments,...(link ? [link] : [])]) : excerpt;
  $: visibleBody = full || comment ? cleanBody : cleanBody.replace(/\s*\n\s*/g, ' ');
  $: headingParts = noteParts(heading, post.event.tags);
  $: headingQuoteIds = renderEmbeds ? [...new Set(headingParts.flatMap(part=>part.event ? [part.event] : []))].slice(0,4) : [];
  $: embeddedHeadingIds = headingQuoteIds.filter(id=>$referencePosts.has(id));
  $: visibleHeadingParts = headingParts.filter(part=>!part.event || !embeddedHeadingIds.includes(part.event));
  $: taggedHeading = visibleHeadingParts.some(part=>part.topic);
  $: hasReferences = headingParts.some(part=>part.event || part.person);
  $: renderedHeading = visibleHeadingParts.map(part => partText(part,$profiles,$referencePosts)).join('').trim();
  $: picture = safeURL(author?.picture);
</script>

<article class="post-card" class:detail={full} class:comment-card={comment}
  data-post-href={!full && !comment && !preview ? permalink : undefined}>
  {#if preview}<div class="byline"><span class="topic-link"><TopicIcon slug={topic} small />t/{topic}</span><span class="sep">·</span><span>{name}</span><span class="sep">·</span><span>Draft</span></div>
  {:else}<div class="byline">
    {#if !comment}<a
        class="topic-link"
        href={topicPath(topic)}
        ><TopicIcon slug={topic} small />t/{topic}</a
      ><span class="sep">·</span>{/if}
    <a class="author" href={profileUrl(post.pubkey)} aria-label={name}
      ><SocialBadge pubkey={post.pubkey}/>{#if comment && picture}<img
          use:proxyImage={{url:picture,width:18,square:true}}
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
        />{/if}<span class="author-name">{name}</span></a
    ><span class="sep">·</span>
    <a class="stamp" href={permalink}
      ><time datetime={new Date(post.created_at * 1000).toISOString()}
        >{age(post.created_at)}</time
      ></a
    >
    {#if isEventId(post.parent) && !full && !comment}<a class="stamp" href={postUrl(post.parent)}>Reply to discussion</a>{/if}
    {#if queued}<small class="queued" title="Saved on this device, waiting to sync">Queued</small>{/if}
    <PostMenu {post} {saved} {onaction}/>
  </div>
  {/if}
  {#if renderedHeading}<h2>
      {#if full}
        <NoteText text={heading} tags={post.event.tags} inline embeddedIds={embeddedHeadingIds} />
      {:else if taggedHeading}
        {#each visibleHeadingParts as part}
          {#if part.topic}<a class="hashtag" href={topicPath(part.topic)}>{part.text}</a>{:else}<a href={permalink}>{partText(part,$profiles,$referencePosts)}</a>{/if}
        {/each}
      {:else}<a href={permalink}>{renderedHeading}</a>{/if}
    </h2>{/if}
  {#if hasReferences}<NoteText text={heading} tags={post.event.tags} previewsOnly showPreviews={renderEmbeds} />{/if}
  {#if visibleBody}<NoteText text={visibleBody} tags={post.event.tags} full={full || comment} showPreviews={renderEmbeds} />{/if}
  {#if renderEmbeds && (media.length || trees.length)}
    {#if photoAlbum && !trees.length}<div class="album-label"><Icon name="image" size={14}/>{media.length} photos</div>{/if}
    <div class="media-gallery" class:photos={photoAlbum && !trees.length} class:album-detail={full && photoAlbum && !trees.length}>
      {#each shownMedia as item (item.url)}<MediaEmbed {item} compact={!full} tile={photoAlbum && !trees.length}/>{/each}
      {#each trees as attachment (attachment.url)}<TreeEmbed {attachment}/>{/each}
    </div>
    {#if shownMedia.length < media.length}<a class="album-more" href={permalink}>View all {media.length} photos <Icon name="next" size={14}/></a>{/if}
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
  {#if !preview}<div class="post-actions">
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
    {#if !comment}
      <button type="button" onclick={() => onaction('share', post)}><Icon name="share" size={16}/> Share</button>
    {/if}
  </div>{/if}
</article>

<style>
  [data-post-href] {cursor:pointer}
  .hashtag {color:var(--green)}
  .queued {font-size:.7rem;color:var(--muted)}
  .media-gallery {display:grid;gap:8px;margin:9px 0;min-width:0}
  .media-gallery.photos {grid-template-columns:repeat(2,minmax(0,1fr))}
  .album-detail > :global(.media:first-child) {grid-column:1 / -1}
  .album-label,.album-more {display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--muted);margin-top:14px}
  .album-more {width:fit-content;color:var(--accent);font-weight:650;margin:10px 0}
  .album-more:hover {text-decoration:underline}
</style>
