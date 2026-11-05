<script lang="ts">
  import { tick } from 'svelte';
  import { npubEncode } from 'nostr-tools/nip19';
  import Icon from './Icon.svelte';
  import { feedPreferences, saveFeed, setFeeds } from '../lib/feed-preferences';
  import { defaultFeeds, feedIcon, feedSummary, isDefaultFeed, maxCustomFeeds, maxFeeds, parseFeedFilters, restoreDefaultFeeds, type Feed, type FeedSource, type FeedOrder } from '../lib/feeds';

  export let initialFeed: Feed | undefined = undefined;
  export let ondone: () => void;
  let editing: Feed | undefined = initialFeed;
  let name = initialFeed?.name ?? '';
  let source: FeedSource = initialFeed?.source ?? 'all';
  let topics = initialFeed?.topics.join(', ') ?? '';
  let keywords = initialFeed?.keywords.join(', ') ?? '';
  let exclude = initialFeed?.exclude.join(', ') ?? '';
  let authors = initialFeed?.authors.map(key => npubEncode(key)).join(', ') ?? '';
  let order: FeedOrder | '' = initialFeed?.order ?? '';
  let error = '', message = '';
  let removed: { feed: Feed; index: number } | undefined;
  let nameInput: HTMLInputElement;
  $: customCount = $feedPreferences.filter(feed => !isDefaultFeed(feed.id)).length;
  function edit(feed?: Feed) {
    editing = feed ?? { ...defaultFeeds()[0], id: crypto.randomUUID(), name: '' };
    name = editing.name; source = editing.source; topics = editing.topics.join(', ');
    keywords = editing.keywords.join(', '); exclude = editing.exclude.join(', ');
    authors = editing.authors.map(key => npubEncode(key)).join(', '); order = editing.order ?? '';
    error = ''; message = '';
    tick().then(() => nameInput?.focus());
  }
  function save() {
    if (!editing) return;
    try {
      if (!name.trim()) throw new Error('Give your feed a name.');
      if (!isDefaultFeed(editing.id) && !$feedPreferences.some(feed => feed.id === editing!.id) && customCount >= maxCustomFeeds) throw new Error('You can keep up to 25 custom feeds.');
      const filters = parseFeedFilters({ topics, keywords, exclude, authors });
      saveFeed({ ...editing, name: name.trim(), source, ...filters, order: order || undefined });
      editing = undefined; message = 'Feed saved.';
    } catch (e) { error = e instanceof Error ? e.message : 'Could not save this feed.'; }
  }
  function move(index: number, step: number) {
    const next = [...$feedPreferences];
    const target = index + step;
    if (index < 1 || target < 1 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setFeeds(next);
  }
  function remove(feed: Feed, index: number) {
    removed = { feed, index };
    setFeeds($feedPreferences.filter(item => item.id !== feed.id));
    message = feed.name + ' removed.';
  }
  function undo() {
    if (!removed || $feedPreferences.length >= maxFeeds) return;
    const next = $feedPreferences.filter(feed => feed.id !== removed!.feed.id);
    next.splice(removed.index, 0, removed.feed); setFeeds(next);
    removed = undefined; message = 'Feed restored.';
  }
</script>

<div class="dialog-content feed-manager">
  {#if editing}
    <button class="editor-back" onclick={() => { editing = undefined; error = ''; }}><Icon name="back" size={15}/>All feeds</button>
    <h2>{$feedPreferences.some(feed => feed.id === editing?.id) ? 'Edit feed' : 'Add feed'}</h2>
    <form onsubmit={e => { e.preventDefault(); save(); }}>
      <label>Feed name<input bind:this={nameInput} bind:value={name} maxlength="40" required placeholder="e.g. Art after dark" /></label>
      {#if source !== 'notifications'}
        <div class="field-pair">
          <label>Posts from<select bind:value={source} disabled={isDefaultFeed(editing.id)}>
            <option value="all">All discussions</option><option value="following">People I follow</option>
            <option value="network">In my network</option><option value="saved">Saved posts</option>
          </select></label>
          <label>Feed order<select bind:value={order}>
            <option value="">Use default</option><option>Hot</option><option>New</option><option>Top</option>
          </select></label>
        </div>
        <label>Topics<input bind:value={topics} maxlength="800" placeholder="art, photography" /></label>
        <label>Include keywords<input bind:value={keywords} maxlength="1600" placeholder="night sky, street photography" /></label>
        <label>Exclude keywords<input bind:value={exclude} maxlength="1600" placeholder="giveaway, advertisement" /></label>
        <label>Authors<textarea bind:value={authors} maxlength="1800" rows="2" placeholder="npub…"></textarea></label>
        <p class="filter-help">Filters combine. Separate alternatives with commas; leave a field blank to include any. Keywords match titles and post text. Your mute and network settings still apply.</p>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="manager-actions"><button type="button" class="outline compact" onclick={() => editing = undefined}>Cancel</button><button type="submit" class="primary compact">Save feed</button></div>
    </form>
  {:else}
    <h2>Customize feeds</h2>
    <p>Make room for what interests you. Saved in this browser.</p>
    <ol class="managed-feeds" aria-label="Your feeds">
      {#each $feedPreferences as feed, index (feed.id)}
        <li>
          <span class="feed-icon"><Icon name={feedIcon(feed)} size={19}/></span>
          <div class="feed-details"><strong>{feed.name}</strong><small>{feed.id === 'home' ? 'Always here' : feedSummary(feed)}</small></div>
          {#if feed.id === 'home'}<span class="home-lock" title="Home always stays first"><Icon name="lock" size={15}/></span>
          {:else}
            <div class="row-actions">
              <button aria-label={'Move ' + feed.name + ' up'} title="Move up" disabled={index === 1} onclick={() => move(index, -1)}><span class="up"><Icon name="down" size={15}/></span></button>
              <button aria-label={'Move ' + feed.name + ' down'} title="Move down" disabled={index === $feedPreferences.length - 1} onclick={() => move(index, 1)}><Icon name="down" size={15}/></button>
              <button aria-label={'Edit ' + feed.name} title="Edit feed" onclick={() => edit(feed)}><Icon name="edit" size={15}/></button>
              <button aria-label={'Remove ' + feed.name} title="Remove feed" onclick={() => remove(feed, index)}><Icon name="close" size={15}/></button>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
    {#if message}<div class="manager-message" role="status">{message}{#if removed}<button onclick={undo}>Undo removal</button>{/if}</div>{/if}
    <button class="outline add-feed" disabled={customCount >= maxCustomFeeds} onclick={() => edit()}><Icon name="plus" size={17}/>Add feed</button>
    <div class="restore-row"><button onclick={() => { setFeeds(restoreDefaultFeeds($feedPreferences)); message = 'Default feeds restored. Your custom feeds are kept.'; }}>Restore defaults</button><small>Keeps your custom feeds.</small></div>
    <button class="primary compact done" onclick={ondone}>Done</button>
  {/if}
</div>

<style>
  .feed-manager{min-width:0}
  .managed-feeds{list-style:none;padding:0;margin:20px 0 16px}
  .managed-feeds li{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}
  .feed-icon{display:flex;color:var(--accent);flex-shrink:0}
  .feed-details{min-width:0;flex:1}
  strong{display:block;font-size:14px;overflow-wrap:anywhere}
  small{display:block;color:var(--muted);font-size:11px;line-height:1.5}
  .feed-details small{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:240px}
  .home-lock{color:var(--muted);padding:7px}
  .row-actions{display:flex;gap:2px;flex-shrink:0}
  .row-actions button{display:flex;align-items:center;justify-content:center;width:29px;height:32px;border-radius:5px;color:var(--muted)}
  .row-actions button:hover{background:var(--light);color:var(--accent)}
  .row-actions button:disabled{opacity:.25}
  .up{display:flex;transform:rotate(180deg)}
  .add-feed{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:10px;border-radius:7px;font-size:13px}
  .restore-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:19px 0}
  .restore-row button,.manager-message button{font-size:12px;color:var(--accent);text-decoration:underline;text-underline-offset:3px}
  .done{display:block;margin-left:auto}
  .editor-back{display:flex;align-items:center;gap:4px;color:var(--muted);font-size:12px;margin-bottom:15px}
  .field-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
  select{display:block;width:100%;padding:9px 8px;margin-top:5px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--ink);font-size:13px}
  .filter-help{font-size:12px;line-height:1.6}
  .manager-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
  .manager-message{font-size:12px;color:var(--muted);margin:12px 0;display:flex;gap:8px;flex-wrap:wrap}
  @media(max-width:480px){.row-actions{gap:0}.row-actions button{width:27px;min-height:36px}.managed-feeds li{gap:8px}.feed-details small{max-width:140px}}
</style>
