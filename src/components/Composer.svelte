<script lang="ts">
  import { onMount } from 'svelte';
  import { publishPost, type Post } from '../lib/network';
  import {
    topics,
    readLocal,
    writeLocal,
  } from '../lib/ui';
  import { topicSlug } from '../lib/hashtags';
  import { seenTopics } from '../lib/topic-catalog-store';
  import { postLink, postDraft, asPost } from '../lib/posts';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';
  import AttachmentPicker from './AttachmentPicker.svelte';
  const formId = 'post-composer-' + crypto.randomUUID();
  let uploading = false, preview = false;
  export let initialTopic: string;
  export let initialMode: 'text' | 'link' | undefined = undefined;
  export let owner: string;
  export let onpublish: (p: Post) => void;
  export let oncancel: () => void;
  let mode: 'text' | 'link' = 'text';
  let title = '',
    body = '',
    url = '',
    topic = '',
    error = '',
    busy = false,
    ready = false;
  onMount(() => {
    const draft = readLocal('draft.' + owner, {
      title: '',
      body: '',
      url: '',
      topic: '',
      mode: '' as string,
    });
    title = draft.title;
    body = draft.body;
    url = draft.url;
    topic = initialTopic || draft.topic || '';
    mode = initialMode ?? (draft.mode === 'link' || (!draft.mode && draft.url) ? 'link' : 'text');
    ready = true;
  });
  $: if (ready) writeLocal('draft.' + owner, { title, body, url, topic, mode });
  $: slug = topicSlug(topic.trim().replace(/^[tr]\//i, ''));
  $: suggestedTopics = [...new Set([...$seenTopics.map(t=>t.slug),...topics.map(t=>t.slug)])];
  $: valid = Boolean(slug && title.trim() && (mode === 'text' || postLink(url.trim())));
  $: previewPost = makePreview(slug, title, body, mode === 'link' ? url : '');
  function makePreview(topic: string, title: string, body: string, url: string) {
    try {
      return asPost({...postDraft({topic,title,body,url}),pubkey:owner,id:'0'.repeat(64),sig:'',created_at:Math.floor(Date.now()/1000)});
    } catch { return undefined; }
  }
  function switchTab(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    mode = e.key === 'Home' ? 'text' : e.key === 'End' ? 'link' : mode === 'text' ? 'link' : 'text';
    document.getElementById('post-tab-' + mode)?.focus();
  }
  async function send() {
    if (busy || uploading) return;
    if (!slug) {
      error =
        'Use a topic with letters, numbers, underscores, or hyphens.';
      return;
    }
    if (!title.trim()) {
      error = 'Give your post a title.';
      return;
    }
    if (mode === 'link' && !postLink(url.trim())) {
      error = 'Enter a web or Hashtree link.';
      return;
    }
    busy = true;
    error = '';
    try {
      const post = await publishPost({
        topic: slug,
        title: title.trim(),
        body: body.trim(),
        url: mode === 'link' ? url.trim() : '',
      });
      ready = false;
      writeLocal('draft.' + owner, { title: '', body: '', url: '', topic: '', mode: 'text' });
      onpublish(post);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not publish your post.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="dialog-content post-editor">
  <h2>Create a post</h2>
  <form id={formId}
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <div hidden={preview}>
    <label
      >Topic<input
        bind:value={topic}
        list="composer-topics"
        required
        maxlength="50"
        placeholder="Choose a topic"
      /></label>
      <datalist id="composer-topics"
        >{#each suggestedTopics as slug}<option value={slug}>{slug}</option
          >{/each}</datalist
      >
    <div class="post-tabs" role="tablist" aria-label="Post type">
      {#each ['text', 'link'] as tab}
        <button type="button" role="tab" id={'post-tab-' + tab} aria-selected={mode === tab}
          aria-controls="post-fields" tabindex={mode === tab ? 0 : -1}
          onclick={() => mode = tab as 'text' | 'link'} onkeydown={switchTab}>
          <Icon name={tab === 'link' ? 'link' : 'edit'} size={17}/>{tab === 'text' ? 'Text' : 'Link'}
        </button>
      {/each}
    </div>
    <div id="post-fields" role="tabpanel" aria-labelledby={'post-tab-' + mode} tabindex="0">
    <label
      >Title<input
        bind:value={title}
        placeholder="What’s on your mind?"
        required
        maxlength="300"
        aria-describedby="title-count"
      /></label
    >
    <small id="title-count" class="title-count">{title.length}/300</small>
    {#if mode === 'link'}
      <label>Link<input type="text" inputmode="url" bind:value={url} required
        placeholder="https://… or htree://…" maxlength="2048"/></label>
    {/if}
    <label
      >Body <span>(optional)</span><textarea
        bind:value={body}
        rows="6"
        placeholder="Add some context…"
        maxlength="20000"></textarea></label
    >
    <AttachmentPicker disabled={busy || uploading} onbusy={(value) => uploading = value} onattach={(link) => body = [body.trim(), link].filter(Boolean).join('\n\n')}/>
    </div>
    </div>
  </form>
    {#if preview && previewPost}
      <section class="post-preview" aria-label="Post preview">
        <Card post={previewPost} full preview onaction={() => {}}/>
      </section>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="composer-foot">
      <small>Public on Nostr</small><div class="post-actions">
      <button type="button" class="preview-toggle" aria-pressed={preview} disabled={busy || uploading || !previewPost}
        onclick={() => preview = !preview}>{preview ? 'Edit post' : 'Preview'}</button>
      <button type="button" class="cancel" onclick={oncancel} disabled={busy || uploading}>Cancel</button>
      <button form={formId} type="submit" class="primary" disabled={busy || uploading || !valid}
        ><Icon name="edit" size={15} />{busy
          ? 'Publishing…'
          : 'Publish post'}</button
      >
      </div>
    </div>
</div>

<style>
  .post-preview {margin:16px 0;min-width:0;overflow-wrap:anywhere}
  .preview-toggle {font-size:13px;color:var(--accent);font-weight:650}
  .post-editor h2 {margin-top:0;margin-right:30px}
  .post-tabs {display:flex;gap:8px;border-bottom:1px solid var(--line);margin:20px 0 18px}
  .post-tabs button {display:flex;align-items:center;gap:8px;padding:11px 20px;border-bottom:3px solid transparent;font-size:14px;font-weight:650;color:var(--muted)}
  .post-tabs button[aria-selected='true'] {color:var(--accent);border-bottom-color:var(--accent)}
  .post-tabs button:hover {background:var(--surface)}
  .title-count {display:block;text-align:right;font-size:11px;color:var(--muted);margin:-7px 0 12px}
  .post-editor textarea {min-height:140px;line-height:1.6}
  .post-actions {display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}
  .cancel {font-size:13px;color:var(--muted)}
  @media(max-width:480px) {
    .post-editor {padding:22px 18px}
    .post-editor h2 {font-size:26px}
    .post-tabs {margin-top:14px;margin-bottom:12px}
    .post-editor textarea {min-height:120px}
    .composer-foot {flex-wrap:wrap;gap:12px}
    .post-actions {margin-left:auto}
  }
</style>
