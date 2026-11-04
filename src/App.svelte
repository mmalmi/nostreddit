<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as nip19 from 'nostr-tools/nip19';
  import {
    posts,
    comments,
    profiles,
    account,
    status,
    likes,
    receipts,
    follows,
    mutes,
    mute,
    unlike,
    start,
    loadTopic,
    loadThread,
    searchRelays,
    loadProfile,
    observe,
    publishComment,
    like,
    follow,
    signEvent,
    relayUrls,
    type Post,
  } from './lib/network';
  import { checkSearch, searchTarget } from './lib/search';
  import { observeAuthors, graphInfo, graphStatus } from './lib/graph';
  import {
    topics,
    topicInfo,
    validTopic,
    safeURL,
    shortKey,
    readLocal,
    writeLocal,
  } from './lib/ui';
  import Notifications from './components/Notifications.svelte';
  import Mark from './components/Mark.svelte';
  import Icon from './components/Icon.svelte';
  import Landscape from './components/Landscape.svelte';
  import TopicIcon from './components/TopicIcon.svelte';
  import Card from './components/Card.svelte';
  import AccountPanel from './components/AccountPanel.svelte';
  import EditProfile from './components/EditProfile.svelte';
  import Composer from './components/Composer.svelte';
  import ZapPanel from './lib/ZapPanel.svelte';
  type Route = { page: string; value: string };
  function readRoute(): Route {
    const [base, value = ''] = location.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/');
    if (!base) return { page: 'home', value: '' };
    if (base === 'r' && validTopic(value.toLowerCase()))
      return { page: 'topic', value: value.toLowerCase() };
    if ((base === 'post' || base === 'u') && /^[a-f0-9]{64}$/.test(value))
      return { page: base === 'u' ? 'profile' : 'thread', value };
    if (base === 'search')
      return {
        page: base,
        value: new URLSearchParams(location.search).get('q')?.trim() ?? '',
      };
    return {
      page: [
        'topics',
        'following',
        'saved',
        'network',
        'notifications',
      ].includes(base)
        ? base
        : 'missing',
      value: '',
    };
  }
  const nav = [
    { path: '/', page: 'home', title: 'Home feed', icon: 'home' },
    {
      path: '/following',
      page: 'following',
      title: 'Following',
      icon: 'users',
    },
    { path: '/network', page: 'network', title: 'In network', icon: 'globe' },
    {
      path: '/notifications',
      page: 'notifications',
      title: 'Notifications',
      icon: 'bell',
    },
    { path: '/saved', page: 'saved', title: 'Saved posts', icon: 'save' },
  ];
  const orders = [
    { name: 'Hot', icon: 'hot' },
    { name: 'New', icon: 'clock' },
    { name: 'Top', icon: 'top' },
  ];
  let route = readRoute(),
    search = route.page === 'search' ? route.value : '',
    menu = false,
    modal = '',
    dialog: HTMLDialogElement;
  let toast = '',
    alertTimer: ReturnType<typeof setTimeout>,
    busy = new Set<string>(),
    zapPost: Post | undefined;
  let joined = readLocal<string[]>('joined', []),
    saved = readLocal<Post[]>('saved', []),
    sorting = readLocal<string>('sort', 'Hot');
  let reply = '',
    replyParent: Post | undefined,
    replyBusy = false,
    replyError = '',
    limit = 24,
    showAccountAfter = '';
  let searchInput: HTMLInputElement;
  let activeCleanup: (() => void) | undefined,
    observedCleanup: (() => void) | undefined,
    mounted = false,
    dialogPrev: HTMLElement | null = null;
  let directoryFilter = '';
  let remotePosts: Post[] = [];
  let searchRun = 0;
  let searching = false, searchMessage = '';
  async function expandSearch() {
    const run = ++searchRun;
    searching = true;
    searchMessage = '';
    try {
      const found = await searchRelays(checkSearch(route.value));
      if (run !== searchRun) return;
      remotePosts = found;
      searchMessage = found.length ? `Found ${found.length} matching discussion${found.length === 1 ? '' : 's'} on relays.` : 'Connected relays returned no matching discussions.';
    } catch (error) {
      if (run === searchRun) searchMessage = error instanceof Error ? error.message : 'Relay search failed.';
    } finally {
      if (run === searchRun) searching = false;
    }
  }
  function syncRoute() {
    const next = readRoute();
    if (next.page !== route.page || next.value !== route.value) {
      searchRun++; searching = false; searchMessage = ''; remotePosts = [];
      route = next;
      menu = false;
      limit = 24;
      reply = '';
      replyParent = undefined;
      replyError = '';
      directoryFilter = '';
      search = next.page === 'search' ? next.value : '';
      if (modal) closeModal();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  function go(path: string) {
    if (location.pathname + location.search !== path)
      history.pushState(null, '', path);
    syncRoute();
  }
  function intercept(e: MouseEvent) {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.shiftKey
    )
      return;
    const a = (e.target as Element)?.closest<HTMLAnchorElement>('a[href]');
    if (
      !a ||
      a.target ||
      a.download ||
      a.origin !== location.origin ||
      a.hash ||
      a.protocol !== location.protocol
    )
      return;
    e.preventDefault();
    go(a.pathname + a.search);
  }
  function showModal(name: string) {
    if (!modal) dialogPrev = document.activeElement as HTMLElement;
    modal = name;
    menu = false;
    tick().then(() => {
      if (dialog && !dialog.open) dialog.showModal();
    });
  }
  function closeModal() {
    modal = '';
    zapPost = undefined;
    dialog?.close();
    tick().then(() => dialogPrev?.focus());
  }
  function accountDone() {
    closeModal();
    if ($account && showAccountAfter === 'compose') {
      showAccountAfter = '';
      showModal('compose');
    } else showAccountAfter = '';
  }
  function notify(s: string) {
    toast = s;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => (toast = ''), 4200);
  }
  function compose() {
    if (!$account) {
      showAccountAfter = 'compose';
      showModal('account');
    } else showModal('compose');
  }
  function submitSearch() {
    if (!search.trim()) {
      go('/topics');
      return;
    }
    const direct = searchTarget(search);
    if (direct) return go(direct);
    if (/nsec1[0-9a-z]+/i.test(search)) { search = ''; notify('Use secret keys only in the sign-in dialog.'); return; }
    go('/search?q=' + encodeURIComponent(search.trim().slice(0,128)));
  }
  function keypress(e: KeyboardEvent) {
    if (
      e.key === '/' &&
      !modal &&
      !(e.target as Element).closest('textarea,input,[contenteditable]')
    ) {
      e.preventDefault();
      searchInput?.focus();
    }
    if (e.key === 'Escape' && menu) menu = false;
  }
  function subscribeRoute(page: string, value: string) {
    activeCleanup?.();
    activeCleanup =
      page === 'topic'
        ? loadTopic(value)
        : page === 'thread'
          ? loadThread(value)
          : page === 'profile'
            ? loadProfile(value)
            : undefined;
  }
  function watch(ids: string) {
    observedCleanup?.();
    observedCleanup = ids ? observe(ids.split(',')) : undefined;
  }
  onMount(() => {
    const stop = start();
    mounted = true;
    document.addEventListener('click', intercept);
    window.addEventListener('popstate', syncRoute);
    document.addEventListener('keydown', keypress);
    return () => {
      stop();
      activeCleanup?.();
      observedCleanup?.();
      clearTimeout(alertTimer);
      document.removeEventListener('click', intercept);
      window.removeEventListener('popstate', syncRoute);
      document.removeEventListener('keydown', keypress);
    };
  });
  $: if (mounted) subscribeRoute(route.page, route.value);
  $: thread = [...$posts, ...$comments, ...saved].find(
    (p) => p.id === route.value,
  );
  $: profile = $profiles[route.value];
  $: graphBadge = $graphInfo[route.value];
  $: profName = profile?.display_name || profile?.name || shortKey(route.value);
  $: topic = topicInfo(route.value);
  $: source = route.page === 'saved' ? saved : route.page === 'search' && remotePosts.length
    ? [...new Map([...$posts,...remotePosts].map(post => [post.id,post])).values()] : $posts;
  $: candidates = source.filter((p) => {
    if (route.page === 'topic')
      return (
        p.topic === route.value ||
        p.event.tags.some(
          (t) => t[0] === 't' && t[1]?.toLowerCase() === route.value,
        )
      );
    if (route.page === 'following') return $follows.includes(p.pubkey);
    if (route.page === 'profile') return p.pubkey === route.value;
    if (route.page === 'search') {
      const words = route.value.toLowerCase().split(/\s+/).filter(Boolean);
      const text = [
        p.title,
        p.body,
        p.topic,
        ...p.event.tags.filter(t => t[0] === 't').map(t => t[1]),
        $profiles[p.pubkey]?.name,
        $profiles[p.pubkey]?.display_name,
      ]
        .join(' ')
        .toLowerCase();
      return words.length && words.every((term) => text.includes(term));
    }
    return true;
  });
  // Score only the bounded set already in the local event window.
  $: replyCounts = $comments.reduce<Record<string, number>>((m, c) => {
    m[c.root] = (m[c.root] || 0) + 1;
    return m;
  }, {});
  $: scored = candidates
    .filter(
      (p) =>
        (route.page === 'profile' ||
          (!$graphInfo[p.pubkey]?.muted && !$mutes.includes(p.pubkey))) &&
        (route.page !== 'network' ||
          ($graphInfo[p.pubkey]?.distance ?? 99) <= 2),
    )
    .map((p) => {
      const votes = ($likes[p.id]?.length || 0) + (replyCounts[p.id] || 0);
      const distance = $graphInfo[p.pubkey]?.distance;
      const boost =
        ($follows.includes(p.pubkey)
          ? 4
          : distance != null && distance <= 2
            ? 2
            : 0) +
        (joined.includes(p.topic) ? 1 : 0) +
        (p.event.tags.some((t) => t[0] === 'subject') ? 2 : 0);
      const hours = Math.max(0, (Date.now() / 1000 - p.created_at) / 3600);
      return {
        p,
        score:
          sorting === 'New'
            ? p.created_at
            : sorting === 'Top'
              ? votes
              : (votes + boost + 1) / Math.pow(hours + 4, 0.85),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.p.created_at - a.p.created_at ||
        a.p.id.localeCompare(b.p.id),
    );
  $: visible = scored.slice(0, limit).map((x) => x.p);
  $: if (mounted)
    observeAuthors([
      ...(route.page === 'profile' ? [route.value] : []),
      ...(thread ? [thread.pubkey] : []),
      ...candidates.slice(0, 240).map((p) => p.pubkey),
    ]);
  $: replies =
    thread && route.page === 'thread'
      ? $comments
          .filter(
            (p) =>
              p.id !== thread.id &&
              !$graphInfo[p.pubkey]?.muted &&
              !$mutes.includes(p.pubkey) &&
              (p.root === thread.id || p.parent === thread.id),
          )
          .sort((a, b) => a.created_at - b.created_at)
      : [];
  $: ids = (
    route.page === 'thread'
      ? thread
        ? [thread.id, ...replies.slice(0, 32).map((x) => x.id)]
        : []
      : ['topics', 'missing', 'notifications'].includes(route.page)
        ? []
        : visible.slice(0, 48).map((p) => p.id)
  )
    .sort()
    .join(',');
  $: if (mounted) watch(ids);
  $: discovered = [
    ...new Set([
      ...topics.map((t) => t.slug),
      ...joined,
      ...$posts.map((p) => p.topic),
    ]),
  ].filter(validTopic);
  $: topicMatches =
    route.page === 'search'
      ? discovered
          .filter(
            (x) =>
              route.value &&
              x.includes(route.value.toLowerCase().replace(/^r\//, '')),
          )
          .slice(0, 5)
      : [];
  $: title =
    route.page === 'home'
      ? 'The Commons'
      : route.page === 'topic'
        ? 'r/' + route.value
        : route.page === 'following'
          ? 'Following'
          : route.page === 'network'
            ? 'In network'
            : route.page === 'saved'
              ? 'Saved posts'
              : route.page === 'notifications'
                ? 'Notifications'
                : route.page === 'topics'
                  ? 'Communities'
                  : route.page === 'search'
                    ? 'Search results'
                    : route.page === 'profile'
                      ? profName
                      : route.page === 'thread'
                        ? 'Discussion'
                        : 'Page not found';
  $: subtitle =
    route.page === 'home'
      ? 'An open gathering place for conversations on Nostr.'
      : route.page === 'topic'
        ? topic.desc
        : route.page === 'following'
          ? 'Conversations from people you follow.'
          : route.page === 'network'
            ? 'People within two steps of your social graph.'
            : route.page === 'saved'
              ? 'Posts bookmarked in this browser.'
              : route.page === 'notifications'
                ? 'Replies, mentions, and likes for your account.'
                : route.page === 'topics'
                  ? 'Find your corner of the network.'
                  : route.page === 'search'
                    ? 'Results in the posts and communities loaded here.'
                    : '';
  $: document.title =
    (route.page === 'thread' && thread ? thread.title.slice(0, 70) : title) +
    ' · Nostreddit';
  function join(slug: string) {
    const exists = joined.includes(slug);
    joined = exists ? joined.filter((x) => x !== slug) : [...joined, slug];
    writeLocal('joined', joined);
    notify(exists ? 'Community removed' : 'Community joined');
  }
  async function action(kind: string, p: Post) {
    if (kind === 'save') {
      const exists = saved.some((x) => x.id === p.id);
      saved = exists
        ? saved.filter((x) => x.id !== p.id)
        : [p, ...saved].slice(0, 250);
      writeLocal('saved', saved);
      notify(exists ? 'Bookmark removed' : 'Post saved');
      return;
    }
    if (kind === 'share') {
      try {
        await navigator.clipboard.writeText(location.origin + '/post/' + p.id);
        notify('Post link copied');
      } catch {
        go('/post/' + p.id);
        notify('Copy the link from your address bar');
      }
      return;
    }
    if (kind === 'zap') {
      zapPost = p;
      showModal('zap');
      return;
    }
    if (!$account) {
      showModal('account');
      return;
    }
    if (kind === 'reply') {
      replyParent = p;
      await tick();
      document.getElementById('reply-body')?.focus();
      return;
    }
    const key = kind + p.id;
    if (busy.has(key)) return;
    busy = new Set([...busy, key]);
    try {
      if (kind === 'like') {
        if (($likes[p.id] || []).includes($account.pubkey)) await unlike(p);
        else await like(p);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not publish your action.');
    } finally {
      busy.delete(key);
      busy = new Set(busy);
    }
  }
  async function toggleFollow(key: string) {
    if (!$account) {
      showModal('account');
      return;
    }
    if (busy.has('follow')) return;
    busy = new Set([...busy, 'follow']);
    try {
      await follow(key, !$follows.includes(key));
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not update follows.');
    } finally {
      busy.delete('follow');
      busy = new Set(busy);
    }
  }
  async function toggleMute(key: string) {
    if (!$account) {
      showModal('account');
      return;
    }
    if (busy.has('mute')) return;
    busy = new Set([...busy, 'mute']);
    try {
      const muted = $mutes.includes(key);
      await mute(key, !muted);
      notify(muted ? 'Author unmuted' : 'Author muted');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not update mute list.');
    } finally {
      busy.delete('mute');
      busy = new Set(busy);
    }
  }
  async function sendReply() {
    if (!thread || !reply.trim() || replyBusy) return;
    if (!$account) {
      showModal('account');
      return;
    }
    replyBusy = true;
    replyError = '';
    try {
      await publishComment(replyParent || thread, reply.trim());
      reply = '';
      replyParent = undefined;
      notify('Reply published');
    } catch (e) {
      replyError = e instanceof Error ? e.message : 'Could not publish reply.';
    } finally {
      replyBusy = false;
    }
  }
  function changeOrder(name: string) {
    sorting = name;
    writeLocal('sort', name);
  }
  function profileKey(query: string) {
    if (/^[a-f0-9]{64}$/.test(query)) return query;
    try {
      const value = nip19.decode(query);
      return value.type === 'npub' ? value.data : '';
    } catch {
      return '';
    }
  }
</script>

<svelte:head><meta name="theme-color" content="#f6f6ef" /></svelte:head>
<header class="topbar">
  <div class="bar-inner">
    <button
      class="menu-button"
      aria-label="Toggle navigation"
      aria-expanded={menu}
      onclick={() => (menu = !menu)}
      ><Icon name={menu ? 'close' : 'menu'} /></button
    >
    <a class="brand" href="/" aria-label="Nostreddit home"
      ><Mark size={36} /><span>nostreddit<span class="brand-dot">.</span></span
      ></a
    >
    <form
      class="search-box"
      role="search"
      onsubmit={(e) => {
        e.preventDefault();
        submitSearch();
      }}
    >
      <Icon name="search" size={17} /><input
        aria-label="Search Nostreddit"
        bind:this={searchInput}
        bind:value={search}
        placeholder="Search Nostreddit"
      /><kbd>/</kbd>
    </form>
    <div class="header-actions">
      <button class="create-button" aria-label="Create post" onclick={compose}
        ><Icon name="plus" size={17} /><span>Create post</span></button
      >
      <button
        class="account-button"
        onclick={() => {
          showAccountAfter = '';
          showModal('account');
        }}
        ><Icon name="user" size={16} /><span
          >{$account
            ? $profiles[$account.pubkey]?.name || 'Account'
            : 'Sign in'}</span
        ></button
      >
    </div>
  </div>
</header>

<div class="shell">
  {#if menu}<button
      class="drawer-backdrop"
      aria-label="Close navigation"
      onclick={() => (menu = false)}
    ></button>{/if}
  <aside class="left-nav" class:shown={menu} aria-label="Main navigation">
    <div class="nav-group">
      <div class="side-label">FEEDS</div>
      {#each nav as item}<a
          class="nav-row"
          class:active={route.page === item.page}
          href={item.path}><Icon name={item.icon} size={18} />{item.title}</a
        >{/each}
    </div>
    <div class="nav-group">
      <div class="side-label">COMMUNITIES</div>
      <a class="nav-row" class:active={route.page === 'topics'} href="/topics"
        ><Icon name="compass" />Explore all</a
      >
      {#each [...new Set( [...joined, ...topics.map((t) => t.slug)] )].slice(0, 15) as slug}<a
          class="nav-row topic-row"
          class:active={route.page === 'topic' && route.value === slug}
          href={'/r/' + slug}><TopicIcon {slug} small />r/{slug}</a
        >{/each}
    </div>
    <div class="left-foot">
      <span class="signal-dot" class:offline={$status === 'offline'}
      ></span>{$status === 'live'
        ? 'Relays connected'
        : $status === 'loading'
          ? 'Connecting to relays'
          : 'Relays offline'}
    </div>
  </aside>
  <main>
    {#if ['home', 'topic', 'following', 'network', 'saved'].includes(route.page)}
      <section class="hero" class:home={route.page === 'home'}>
        {#if route.page === 'home'}<Landscape />{/if}
        <div class="hero-content">
          <div class="hero-kicker">
            <span></span>{route.page === 'home'
              ? 'THE PUBLIC FEED'
              : route.page === 'topic'
                ? 'COMMUNITY FEED'
                : 'PERSONAL FEED'}
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {#if route.page === 'topic'}<button
              class="hero-join"
              onclick={() => join(route.value)}
              ><Icon
                name={joined.includes(route.value) ? 'check' : 'plus'}
                size={14}
              />{joined.includes(route.value)
                ? 'Joined'
                : 'Join community'}</button
            >{/if}
        </div>
      </section>
    {:else if ['topics', 'search', 'notifications'].includes(route.page)}
      <div class="page-head">
        <div class="eyebrow">
          {route.page === 'topics' ? 'DIRECTORY' : 'DISCOVERY'}
        </div>
        <h1>{title}</h1>
        <p>
          {route.page === 'search'
            ? '“' + route.value + '” · ' + subtitle
            : subtitle}
        </p>
      </div>
    {/if}
    {#if route.page === 'notifications'}
      <Notifications onSignIn={() => showModal('account')} />
    {:else if route.page === 'topics'}
      <label class="directory-input"
        ><Icon name="search" /><input
          bind:value={directoryFilter}
          placeholder="Find or open a community"
          aria-label="Find or open a community"
        /></label
      >
      <section class="directory">
        {#each discovered
          .filter((s) => s.includes(directoryFilter
                .trim()
                .toLowerCase()
                .replace(/^r\//, '')))
          .slice(0, 80) as slug}
          <div class="directory-row">
            <a href={'/r/' + slug}
              ><TopicIcon {slug} />
              <div>
                <strong>r/{slug}</strong><small>{topicInfo(slug).desc}</small>
              </div></a
            ><button
              class="outline compact"
              aria-label={(joined.includes(slug) ? 'Leave ' : 'Join ') +
                'r/' +
                slug}
              onclick={() => join(slug)}
              ><Icon
                name={joined.includes(slug) ? 'check' : 'plus'}
                size={14}
              />{joined.includes(slug) ? 'Joined' : 'Join'}</button
            >
          </div>
        {/each}
        {#if validTopic(directoryFilter
            .trim()
            .toLowerCase()
            .replace(/^r\//, '')) && !discovered.includes(directoryFilter
              .trim()
              .toLowerCase()
              .replace(/^r\//, ''))}<a
            class="new-topic"
            href={'/r/' +
              directoryFilter.trim().toLowerCase().replace(/^r\//, '')}
            >Open r/{directoryFilter.trim().toLowerCase().replace(/^r\//, '')}
            <Icon name="next" size={15} /></a
          >{/if}
      </section>
    {:else if route.page === 'thread'}
      <a class="back-link" href={thread ? '/r/' + thread.topic : '/'}
        ><Icon name="back" size={15} />{thread
          ? 'r/' + thread.topic
          : 'Home feed'}</a
      >
      {#if thread}
        {#if thread.root}<a class="back-link" href={'/post/' + thread.root}
            ><Icon name="comment" size={15} />View original discussion</a
          >{/if}
        <Card
          post={thread}
          saved={saved.some((s) => s.id === thread.id)}
          full
          onaction={action}
        />
        <section class="discussion">
          <div class="section-title">
            <h2>Comments</h2>
            <span class="mono">{replies.length}</span>
          </div>
          {#if $account}<form
              class="reply-form"
              onsubmit={(e) => {
                e.preventDefault();
                sendReply();
              }}
            >
              {#if replyParent}<div class="reply-to">
                  Replying to {$profiles[replyParent.pubkey]?.name ||
                    shortKey(replyParent.pubkey)}
                  <button
                    aria-label="Cancel reply to comment"
                    type="button"
                    onclick={() => (replyParent = undefined)}
                    ><Icon name="close" size={13} /></button
                  >
                </div>{/if}
              <textarea
                id="reply-body"
                aria-label="Your reply"
                placeholder="Add to the discussion…"
                bind:value={reply}
                maxlength="20000"
                rows="3"></textarea><button
                class="primary compact"
                disabled={!reply.trim() || replyBusy}
                >{replyBusy ? 'Publishing…' : 'Post reply'}</button
              >
            </form>{:else}<button
              class="guest-reply"
              onclick={() => showModal('account')}
              ><Icon name="comment" /> Sign in to leave a comment <Icon
                name="next"
                size={14}
              /></button
            >{/if}
          {#if replyError}<p class="error" role="alert">{replyError}</p>{/if}
          {#each replies.slice(0, limit * 2) as p (p.id)}<div
              class:nested={p.parent && p.parent !== thread.id}
            >
              {#if p.parent && p.parent !== thread.id}<a
                  class="parent-comment"
                  href={'/post/' + p.parent}>↳ In reply to a comment</a
                >{/if}<Card
                post={p}
                comment
                saved={saved.some((s) => s.id === p.id)}
                onaction={action}
              />
            </div>{:else}<div class="quiet">No comments loaded yet.</div>{/each}
          {#if replies.length > limit * 2}<button
              class="outline wide"
              onclick={() => (limit += 24)}>More comments</button
            >{/if}
        </section>
      {:else}<div class="empty">
          <Icon name="comment" size={28} />
          <h2>
            {$status === 'loading'
              ? 'Loading discussion…'
              : 'Looking for this discussion'}
          </h2>
          <p>Posts appear when a connected relay has a copy.</p>
          <a href="/">Back to the feed</a>
        </div>{/if}
    {:else if route.page === 'missing'}<div class="empty">
        <Icon name="compass" size={32} />
        <h1>Page not found</h1>
        <a class="primary" href="/">Back to the feed</a>
      </div>
    {:else}
      {#if route.page === 'profile'}<a class="back-link" href="/"
          ><Icon name="back" size={15} />Home feed</a
        >
        <section class="profile-head">
          <div class="profile-banner"></div>
          <div class="profile-inner">
            <div class="profile-avatar">
              {#if safeURL(profile?.picture)}<img
                  src={profile.picture}
                  alt=""
                  referrerpolicy="no-referrer"
                />{:else}<Icon name="user" size={25} />{/if}
            </div>
            <div class="profile-actions">
              {#if $account?.pubkey === route.value}<button
                  class="outline compact"
                  onclick={() => showModal('profile')}>Edit profile</button
                >{:else}<button
                  class="primary compact"
                  disabled={busy.has('follow')}
                  onclick={() => toggleFollow(route.value)}
                  ><Icon
                    name={$follows.includes(route.value) ? 'check' : 'plus'}
                    size={14}
                  />{$follows.includes(route.value)
                    ? 'Following'
                    : 'Follow'}</button
                >{#if $account}<button
                    class="outline compact"
                    disabled={busy.has('mute')}
                    onclick={() => toggleMute(route.value)}
                    >{$mutes.includes(route.value) ? 'Unmute' : 'Mute'}</button
                  >{/if}{/if}
            </div>
            <h1>{profName}</h1>
            <div class="profile-key" title={route.value}>
              {nip19.npubEncode(route.value)}
            </div>
            {#if profile?.about}<p>{profile.about}</p>{/if}
            {#if graphBadge?.distance != null && $graphStatus === 'ready'}<span
                class="network-label"
                ><Icon name="globe" size={13} />{graphBadge.distance === 0
                  ? 'Graph center'
                  : graphBadge.distance === 1
                    ? 'Direct connection'
                    : graphBadge.distance + ' steps away'}</span
              >{/if}
          </div>
        </section>{/if}
      {#if route.page === 'search'}
        <div class="relay-search">
          <button class="outline compact" disabled={searching} onclick={expandSearch}><Icon name="search" size={15}/>{searching ? 'Searching…' : 'Search relays'}</button>
          <small role="status">{searchMessage || 'Send this query to public search relays to find more discussions.'}</small>
        </div>
        {#if profileKey(route.value)}<a
            class="search-profile"
            href={'/u/' + profileKey(route.value)}
            ><Icon name="user" /> Open Nostr profile <Icon
              name="next"
              size={15}
            /></a
          >{/if}
        {#if topicMatches.length}<div class="search-topics">
            {#each topicMatches as slug}<a href={'/r/' + slug}
                ><TopicIcon {slug} small />r/{slug}</a
              >{/each}
          </div>{/if}
      {/if}
      <div class="feed-heading">
        <h2>{route.page === 'profile' ? 'Posts' : 'Discussions'}</h2>
        <div class="sort-bar" aria-label="Sort discussions">
          {#each orders as o}<button
              class:selected={sorting === o.name}
              aria-pressed={sorting === o.name}
              onclick={() => changeOrder(o.name)}
              ><Icon name={o.icon} size={14} />{o.name}</button
            >{/each}
        </div>
      </div>
      <section class="feed-list" aria-label="Discussions">
        {#each visible as p (p.id)}<Card
            post={p}
            saved={saved.some((s) => s.id === p.id)}
            onaction={action}
          />{:else}
          <div class="empty">
            <span class="empty-icon"
              ><Icon
                name={route.page === 'saved'
                  ? 'save'
                  : route.page === 'following'
                    ? 'users'
                    : 'wave'}
                size={24}
              /></span
            >
            {#if route.page === 'saved'}<h2>No saved posts yet</h2>
              <p>Use the bookmark on any post to keep it here.</p>
              <a href="/">Browse the feed</a>
            {:else if route.page === 'following' && !$account}<h2>
                Your following feed
              </h2>
              <p>Sign in to read posts from the people you follow.</p>
              <button
                class="primary compact"
                onclick={() => showModal('account')}>Sign in</button
              >
            {:else if route.page === 'following'}<h2>
                No posts from follows yet
              </h2>
              <p>
                Open an author’s profile and follow them to add their posts
                here.
              </p>
              <a href="/">Explore the feed</a>
            {:else if route.page === 'search'}<h2>No matching posts</h2>
              <p>Try another phrase or browse the community directory.</p>
              <a href="/topics">Browse communities</a>
            {:else if route.page === 'network' && $graphStatus === 'unavailable'}<h2
              >
                Social graph unavailable
              </h2>
              <p>You can still browse all public discussions.</p>
              <a href="/">Open home feed</a>
            {:else if $status === 'loading' || (route.page === 'network' && $graphStatus === 'loading')}<h2
              >
                Tuning in…
              </h2>
              <p>Loading discussions from the network.</p>
            {:else}<h2>
                {route.page === 'topic'
                  ? 'No discussions here yet'
                  : $status === 'offline'
                    ? 'Relays are offline'
                    : 'No discussions loaded yet'}
              </h2>
              <p>
                {route.page === 'topic'
                  ? 'Start a conversation in r/' + route.value + '.'
                  : 'Posts appear as your relays connect.'}
              </p>
              {#if route.page === 'topic'}<button
                  class="primary compact"
                  onclick={compose}>Create a post</button
                >{:else}<a href="/topics">Explore communities</a>{/if}
            {/if}
          </div>{/each}
      </section>
      {#if scored.length > limit}<button
          class="load-more outline"
          onclick={() => (limit += 24)}
          >Load more discussions <Icon name="down" size={15} /></button
        >{/if}
    {/if}
  </main>
  <aside class="right-rail" aria-label="Community information">
    <section class="rail-panel about">
      <div class="rail-eyebrow">
        <span class="signal-dot"></span> FIELD NOTES
      </div>
      <h2>
        {route.page === 'topic' ? 'About r/' + route.value : 'About Nostreddit'}
      </h2>
      <p>
        {route.page === 'topic'
          ? 'A feed of public posts tagged #' +
            route.value +
            ' and discussions in matching Nostr communities.'
          : 'A community forum built on Nostr. Follow your curiosity across topics, share a link, or start a discussion.'}
      </p>
      <div class="rail-rule"></div>
      <div class="rail-caption">
        <span class="tiny-symbol">✳</span>
        {route.page === 'topic'
          ? 'Open community'
          : 'Open protocol, open conversations'}
      </div>
    </section>
    <section class="rail-panel popular">
      <div class="rail-eyebrow"><Icon name="compass" size={14} /> DISCOVER</div>
      <h2>Explore communities</h2>
      {#each topics.slice(0, 4) as item}<a
          class="rail-topic"
          href={'/r/' + item.slug}
          ><TopicIcon slug={item.slug} />
          <div><strong>r/{item.slug}</strong><small>{item.desc}</small></div>
          <Icon name="next" size={12} /></a
        >{/each}
      <a class="all-topics" href="/topics"
        >All communities <Icon name="next" size={14} /></a
      >
    </section>
    <div class="rail-footer">
      <span><Mark size={18} /> Nostreddit</span><span>Powered by Nostr</span>
    </div>
  </aside>
</div>
{#if modal}
  <dialog
    bind:this={dialog}
    class="modal"
    aria-label={modal === 'account'
      ? 'Nostr account'
      : modal === 'compose'
        ? 'Create post'
        : modal === 'zap'
          ? 'Zap post'
          : 'Edit profile'}
    oncancel={(e) => {
      e.preventDefault();
      closeModal();
    }}
    onclick={(e) => {
      if (e.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          closeModal();
      }
    }}
  >
    <button class="modal-close" aria-label="Close dialog" onclick={closeModal}
      ><Icon name="close" size={18} /></button
    >
    {#if modal === 'account'}<AccountPanel onclose={accountDone} {notify} />
    {:else if modal === 'compose' && $account}<Composer
        initialTopic={route.page === 'topic' ? route.value : ''}
        owner={$account.pubkey}
        onpublish={(p) => {
          closeModal();
          go('/post/' + p.id);
          notify('Post published');
        }}
      />
    {:else if modal === 'profile' && $account}<EditProfile
        profile={$profiles[$account.pubkey]}
        ondone={() => {
          closeModal();
          notify('Profile updated');
        }}
      />
    {:else if modal === 'zap' && zapPost}<div
        class="dialog-content zap-content"
      >
        <ZapPanel
          event={zapPost.event}
          profile={$profiles[zapPost.pubkey]}
          relays={relayUrls}
          sign={$account ? signEvent : undefined}
          receipts={$receipts[zapPost.id] ?? []}
        />
      </div>{/if}
  </dialog>
{/if}
{#if toast}<div class="toast" role="status">
    {toast}<button
      aria-label="Dismiss notification"
      onclick={() => (toast = '')}><Icon name="close" size={14} /></button
    >
  </div>{/if}
