<script lang="ts">
  import { onMount } from 'svelte';
  import { account, publishPost, type Post } from '../lib/network';
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
  let body = '',
    url = '',
    topic = '',
    error = '',
    busy = false,
    ready = false;
  let textField: HTMLTextAreaElement, linkField: HTMLInputElement, topicField: HTMLInputElement;
  onMount(() => {
    const draft = readLocal('draft.' + owner, {
      title: '',
      body: '',
      url: '',
      topic: '',
      mode: '' as string,
    });
    // Older drafts kept a separate title; it becomes the opening line.
    body = [draft.title?.trim(), draft.body].filter(Boolean).join('\n\n');
    url = draft.url;
    topic = initialTopic || (body.trim() || draft.url ? draft.topic : '') || '';
    mode = initialMode ?? (draft.mode === 'link' || (!draft.mode && draft.url) ? 'link' : 'text');
    ready = true;
    requestAnimationFrame(() => (mode === 'link' ? linkField : textField)?.focus());
  });
  $: if (ready) writeLocal('draft.' + owner, { title: '', body, url, topic, mode });
  $: rawTopic = topic.trim().replace(/^[tr]\//i, '');
  $: slug = topicSlug(rawTopic);
  $: suggestedTopics = [...new Set([...$seenTopics.map(t=>t.slug),...topics.map(t=>t.slug)])];
  $: link = mode === 'link' ? url.trim() : '';
  $: empty = !body.trim() && !link;
  $: previewPost = makePreview(slug, body, link);
  $: externalSigner = $account?.method === 'extension' || $account?.method === 'bunker';
  // Editing clears a stale error.
  $: body, url, topic, mode, error = '';
  function makePreview(topic: string, body: string, url: string) {
    try {
      return asPost({...postDraft({topic,body,url}),pubkey:owner,id:'0'.repeat(64),sig:'',created_at:Math.floor(Date.now()/1000)});
    } catch { return undefined; }
  }
  function switchTab(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    mode = e.key === 'Home' ? 'text' : e.key === 'End' ? 'link' : mode === 'text' ? 'link' : 'text';
    document.getElementById('post-tab-' + mode)?.focus();
  }
  function fail(message: string, field?: HTMLElement) {
    preview = false;
    error = message;
    field?.focus();
  }
  async function send() {
    if (busy || uploading) return;
    if (rawTopic && !slug) return fail('Use a topic with letters, numbers, underscores, or hyphens.', topicField);
    if (mode === 'link' && !postLink(link)) return fail(link ? 'Enter a web or Hashtree link.' : 'Add a link to share.', linkField);
    if (empty) return fail('Write something to post.', textField);
    busy = true;
    error = '';
    try {
      const post = await publishPost({ topic: slug, body: body.trim(), url: link });
      ready = false;
      writeLocal('draft.' + owner, { title: '', body: '', url: '', topic: '', mode: 'text' });
      onpublish(post);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Could not publish your post.');
    } finally {
      busy = false;
    }
  }
  function shortcut(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  }
</script>

<div class="dialog-content post-editor">
  <h2>Create a post</h2>
  <form id={formId} novalidate
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <div hidden={preview}>
    <label
      >Topic <span>(optional)</span><input
        bind:this={topicField}
        bind:value={topic}
        list="composer-topics"
        maxlength="50"
        autocomplete="off"
        placeholder="None"
        aria-label="Topic"
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
    <div id="post-fields" role="tabpanel" aria-labelledby={'post-tab-' + mode}>
    {#if mode === 'link'}
      <label>Link<input bind:this={linkField} type="url" inputmode="url" bind:value={url}
        placeholder="https://… or htree://…" maxlength="2048" autocomplete="off"/></label>
    {/if}
    <label
      >Post<textarea
        bind:this={textField}
        onkeydown={shortcut}
        bind:value={body}
        rows="6"
        placeholder={mode === 'link' ? 'Say something about it…' : 'What’s on your mind?'}
        maxlength="20000"
        aria-describedby="post-hint"></textarea></label
    >
    <small id="post-hint" class="hint">The first line is the headline. #hashtags add more topics.</small>
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
      <small>{busy && externalSigner ? 'Approve the post in your signer' : 'Public on Nostr'}</small><div class="post-actions">
      <button type="button" class="preview-toggle" aria-pressed={preview} disabled={busy || uploading || (!preview && !previewPost)}
        onclick={() => preview = !preview}>{preview ? 'Edit post' : 'Preview'}</button>
      <button type="button" class="cancel" onclick={oncancel} disabled={busy || uploading}>Cancel</button>
      <button form={formId} type="submit" class="primary" disabled={busy || uploading} class:idle={empty}
        ><Icon name="edit" size={15} />{busy
          ? (externalSigner ? 'Waiting for signer…' : 'Publishing…')
          : uploading ? 'Uploading…' : 'Publish post'}</button
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
  .hint {display:block;font-size:12px;color:var(--muted);margin:-6px 0 4px}
  .post-editor textarea {min-height:160px;line-height:1.6}
  .post-actions {display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}
  .primary.idle {opacity:.6}
  .cancel {font-size:13px;color:var(--muted)}
  @media(max-width:480px) {
    .post-editor {padding:22px 18px}
    .post-editor h2 {font-size:26px}
    .post-tabs {margin-top:14px;margin-bottom:12px}
    .post-editor textarea {min-height:130px}
    .composer-foot {flex-wrap:wrap;gap:12px}
    .post-actions {margin-left:auto}
  }
</style>
