<script lang="ts">
  import { onMount } from 'svelte';
  import { publishPost, type Post } from '../lib/network';
  import {
    topics,
    readLocal,
    writeLocal,
  } from '../lib/ui';
  import { topicSlug } from '../lib/hashtags';
  import { postLink } from '../lib/posts';
  import Icon from './Icon.svelte';
  export let initialTopic: string;
  export let owner: string;
  export let onpublish: (p: Post) => void;
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
    });
    title = draft.title;
    body = draft.body;
    url = draft.url;
    topic = initialTopic || draft.topic || 'nostr';
    ready = true;
  });
  $: if (ready) writeLocal('draft.' + owner, { title, body, url, topic });
  async function send() {
    const slug = topicSlug(topic.trim().replace(/^r\//i, ''));
    if (!slug) {
      error =
        'Use a community name with letters, numbers, underscores, or hyphens.';
      return;
    }
    if (!title.trim()) {
      error = 'Give your post a title.';
      return;
    }
    if (url.trim() && !postLink(url.trim())) {
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
        url: url.trim(),
      });
      ready = false;
      writeLocal('draft.' + owner, { title: '', body: '', url: '', topic: '' });
      onpublish(post);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not publish your post.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="dialog-content">
  <div class="eyebrow">NEW DISCUSSION</div>
  <h2>Create a post</h2>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <label
      >Community<input
        bind:value={topic}
        list="composer-topics"
        required
        maxlength="50"
        placeholder="nostr"
      /><datalist id="composer-topics"
        >{#each topics as t}<option value={t.slug}>{t.name}</option
          >{/each}</datalist
      ></label
    >
    <label
      >Title<input
        bind:value={title}
        placeholder="What’s on your mind?"
        required
        maxlength="240"
      /></label
    >
    <label
      >Body <span>(optional)</span><textarea
        bind:value={body}
        rows="5"
        placeholder="Add some context…"
        maxlength="20000"></textarea></label
    >
    <label
      >Link <span>(optional)</span><input
        type="text" inputmode="url"
        bind:value={url}
        placeholder="https://… or htree://…"
        maxlength="2048"
      /></label
    >
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="composer-foot">
      <small>Public on Nostr</small><button class="primary" disabled={busy}
        ><Icon name="edit" size={15} />{busy
          ? 'Publishing…'
          : 'Publish post'}</button
      >
    </div>
  </form>
</div>
