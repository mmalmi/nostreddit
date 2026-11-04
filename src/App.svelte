<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as nip19 from 'nostr-tools/nip19';
  import {
    posts,
    canSeeAuthor,
    pendingWrites,
    hiddenPostIds,
    comments,
    profiles,
    account,
    status,
    notifications,
    unreadNotificationIds,
    readPostNotifications,
    likes,
    hotSignals,
    createHotObserver,
    follows,
    mutes,
    mute,
    unlike,
    start,
    loadTopic,
    loadThread,
    searchRelays,
    clearRelaySearch,
    loadProfile,
    observe,
    like,
    follow,
    signEvent,
    relayUrls,
    type Post,
  } from './lib/network';
  import { createSearchSession } from './lib/discovery/session';
  import { planPostSearch } from './lib/discovery/query';
  import { allowModel, keywordScore, relevance, semanticFloor } from './lib/discovery/discussions';
  import { checkSearch, searchTarget } from './lib/search';
  import { observeAuthors, observeEventAuthors, graphInfo, graphStatus } from './lib/graph';
  import {
    topics,
    topicInfo,
    validTopic,
    displayName,
    readLocal,
    writeLocal,
  } from './lib/ui';
  import CommunityIntro from './components/CommunityIntro.svelte';
  import Notifications from './components/Notifications.svelte';
  import Mark from './components/Mark.svelte';
  import Icon from './components/Icon.svelte';
  import TopicIcon from './components/TopicIcon.svelte';
  import Card from './components/Card.svelte';
  import ThreadComments from './components/ThreadComments.svelte';
  import ProfileHeader from './components/ProfileHeader.svelte';
  import Outbox from './components/Outbox.svelte';
  import { topicPath, topicSlug } from './lib/hashtags';
  import { matchesTopic, mentionsTopic } from './lib/posts';
  import ProfileConnections from './components/ProfileConnections.svelte';
  import { isEventId, postIdFromPath, postUrl } from './lib/post-url';
  import { profileUrl, profileKeyFromPath, type Relationship } from './lib/profile-url';
  import GraphSettings from './components/GraphSettings.svelte';
  import AppearanceSettings from './components/AppearanceSettings.svelte';
  import ImageProxySettings from './components/ImageProxySettings.svelte';
  import HotSettings from './components/HotSettings.svelte';
  import { hotPreferences, watchHotPreferences } from './lib/hot-preferences';
  import { rankHot, hotQuery, hotCandidates } from './lib/hot';
  import { createHotSession } from './lib/hot-session';
  import { watchAppearance } from './lib/appearance';
  import AccountPanel from './components/AccountPanel.svelte';
  import ProfileBackup from './components/ProfileBackup.svelte';
  import EditProfile from './components/EditProfile.svelte';
  import Composer from './components/Composer.svelte';
  import ZapPanel from './lib/ZapPanel.svelte';
  type Route = { page: string; value: string; connections?: Relationship; fromTopic?: string };
  function readRoute(): Route {
    const [base, value = '', section, extra] = location.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/');
    if (!base) return { page: 'home', value: '' };
    if (base==='r' && !section) {
      let slug='';
      try {slug=topicSlug(decodeURIComponent(value));} catch { /* Invalid escaped topic. */ }
      if(slug) return {page:'topic',value:slug};
    }
    if (base === 'post' && section === undefined) {
      const id = postIdFromPath(value);
      if (id) {
        const canonical = postUrl(id);
        if (location.pathname !== canonical) history.replaceState(history.state, '', canonical + location.search + location.hash);
        const from = topicSlug(new URLSearchParams(location.search).get('r') || '');
        return {page:'thread', value:id, fromTopic:from || undefined};
      }
    }
    if (base === 'u' && !extra && (!section || section === 'followers' || section === 'following')) {
      const key = profileKeyFromPath(value);
      if (key) {
        const connections = section as Relationship | undefined;
        const canonical = profileUrl(key, connections);
        if (location.pathname !== canonical) history.replaceState(history.state, '', canonical + location.search + location.hash);
        return {page:'profile', value:key, connections};
      }
    }
    if (base === 'search') {
      const query = new URLSearchParams(location.search).get('q')?.trim() ?? '';
      if (/nsec1[0-9a-z]+/i.test(query)) {
        history.replaceState(history.state, '', '/search');
        return {page:base, value:''};
      }
      return {page:base, value:query.slice(0, 128)};
    }
    return {
      page: [
        'topics',
        'following',
        'saved',
        'network',
        'notifications',
        'settings',
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
  let pageVisible = document.visibilityState === 'visible';
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
  let showPreviews = readLocal<boolean>('showPreviews', true);
  let limit = 24,
    showAccountAfter = '';
  let searchInput: HTMLInputElement;
  let activeCleanup: (() => void) | undefined,
    observedCleanup: (() => void) | undefined,
    mounted = false,
    dialogPrev: HTMLElement | null = null;
  let directoryFilter = '';
  const assistance = createSearchSession();
  const hotAssistance = createHotSession(), hotObserver = createHotObserver();
  let seenHot = readLocal<string[]>('seenHot', []);
  let heldHot: string[] | undefined;
  let hotRefresh = 0;
  let related = readLocal<boolean>('relatedSearch', true);
  let searchOrder = 'Best match';
  let remoteIds = new Set<string>();
  let searchRun = 0;
  let searching = false, searched = false, searchMessage = '';
  async function expandSearch() {
    const run = ++searchRun;
    searching = true; searched = false;
    searchMessage = '';
    try {
      const query = checkSearch(route.value);
      const expansion = await assistance.relayExpansion(query);
      if (run !== searchRun) return;
      const found = await searchRelays(query, expansion);
      if (run !== searchRun) return;
      remoteIds = found;
      searched = true;
    } catch (error) {
      if (run === searchRun) searchMessage = error instanceof Error ? error.message : 'Relay search failed.';
    } finally {
      if (run === searchRun) searching = false;
    }
  }
  function syncRoute() {
    const next = readRoute();
    if (next.page !== route.page || next.value !== route.value || next.connections !== route.connections || next.fromTopic !== route.fromTopic) {
      searchRun++; searching = false; searched = false; searchMessage = ''; remoteIds = new Set(); clearRelaySearch();
      searchOrder = 'Best match';
      route = next;
      heldHot = undefined;
      if(next.page === 'thread' && !seenHot.includes(next.value)) {
        seenHot = [...seenHot, next.value].slice(-500); writeLocal('seenHot', seenHot);
      }
      menu = false;
      limit = 24;
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
      if (name === 'account' && !$account) {
        const input = dialog?.querySelector<HTMLInputElement>('input[name="display-name"]');
        input?.focus();
        input?.select();
      }
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
    if (/nsec1[0-9a-z]+/i.test(search)) { search = ''; notify('Use secret keys only in the sign-in dialog.'); return; }
    const direct = searchTarget(search);
    if (direct) return go(direct);
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
  function subscribeRoute(page: string, value: string, connections?: Relationship) {
    activeCleanup?.();
    activeCleanup =
      page === 'topic'
        ? loadTopic(value)
        : page === 'thread'
          ? loadThread(value)
          : page === 'profile'
            ? loadProfile(value, connections)
            : undefined;
  }
  function watch(ids: string) {
    observedCleanup?.();
    observedCleanup = ids ? observe(ids.split(',')) : undefined;
  }
  onMount(() => {
    const stopAppearance = watchAppearance();
    const stopHotPreferences = watchHotPreferences();
    const stop = start();
    mounted = true;
    document.addEventListener('click', intercept);
    window.addEventListener('popstate', syncRoute);
    document.addEventListener('keydown', keypress);
    return () => {
      stopAppearance();
      stopHotPreferences(); hotAssistance.reset(); hotObserver.reset();
      assistance.reset(); clearRelaySearch();
      stop();
      activeCleanup?.();
      observedCleanup?.();
      clearTimeout(alertTimer);
      document.removeEventListener('click', intercept);
      window.removeEventListener('popstate', syncRoute);
      document.removeEventListener('keydown', keypress);
    };
  });
  $: if (mounted) subscribeRoute(route.page, route.value, route.connections);
  $: observeEventAuthors(saved.map(p => p.pubkey));
  $: visibleSaved = saved.filter(p => $canSeeAuthor(p.pubkey));
  $: visibleSearch = $posts.filter(p => remoteIds.has(p.id));
  $: thread = [...$posts, ...$comments, ...visibleSaved].find(
    (p) => p.id === route.value,
  );
  $: if (mounted && pageVisible && !modal && route.page === 'thread' && thread) {
    readPostNotifications(thread.id, $notifications);
  }
  $: threadTopic = thread && route.fromTopic && matchesTopic(thread,route.fromTopic) ? route.fromTopic : thread?.topic;
  $: profile = $profiles[route.value];
  $: profName = route.page === 'profile' ? ($canSeeAuthor(route.value) ? displayName(route.value,profile) : 'Profile') : '';
  $: topic = topicInfo(route.value);
  $: source = route.page === 'saved' ? visibleSaved : route.page === 'topic'
    ? [...$posts,...$comments.filter(reply=>mentionsTopic(reply,route.value))] : $posts;
  $: plan = route.page === 'search' && route.value ? planPostSearch(route.value) : undefined;
  $: lexical = new Map(plan ? source.map(p => [p.id, keywordScore(plan!, p, displayName(p.pubkey, $profiles[p.pubkey]))] as const) : []);
  $: assistance.update(plan && related && pageVisible && allowModel(plan) ? plan : undefined,
    plan ? [...visibleSearch, ...source.filter(p => !remoteIds.has(p.id))]
      .filter(p => (lexical.get(p.id) ?? -1) >= 0) : []);
  $: minimum = semanticFloor(plan, $assistance.scores);
  $: matchScores = new Map([...lexical].map(([id, score]) => [id, relevance(score, $assistance.scores.get(id), minimum)]));
  $: relayMatchCount = visibleSearch.filter(p => (matchScores.get(p.id) ?? 0) > 0).length;
  $: activeOrder = route.page === 'search' ? searchOrder : sorting;
  $: candidates = source.filter((p) => {
    if (route.page === 'topic') return matchesTopic(p,route.value);
    if (route.page === 'following') return $follows.includes(p.pubkey);
    if (route.page === 'profile') return p.pubkey === route.value;
    if (route.page === 'search') return (matchScores.get(p.id) ?? 0) > 0;
    return true;
  });
  $: replyCounts = $comments.reduce<Record<string, number>>((m, c) => {
    m[c.root] = (m[c.root] || 0) + 1;
    return m;
  }, {});
  $: allowedCandidates = candidates.filter(p =>
    (route.page === 'profile' || (!$graphInfo[p.pubkey]?.muted && !$mutes.includes(p.pubkey))) &&
    (route.page !== 'network' || ($graphInfo[p.pubkey]?.distance ?? 99) <= 2));
  $: hotActive = activeOrder === 'Hot' && ['home','topic','following','network','saved','profile','search'].includes(route.page) && !route.connections;
  $: hotScope = hotActive ? `${route.page}:${route.value}:${$account?.pubkey || 'guest'}:${hotRefresh}` : '';
  $: hotOptions = {now:Date.now()/1000,signals:$hotSignals,follows:new Set($follows),joined,saved:visibleSaved,
    topic:route.page === 'topic' ? route.value : '', seen:new Set(seenHot),
    distance:(key:string)=>$graphInfo[key]?.distance};
  $: baseHot = hotActive ? rankHot(allowedCandidates,hotOptions) : [];
  $: discoveryActors = $follows.length ? $follows : Object.keys($graphInfo).filter(key=>$graphInfo[key].distance===1);
  $: if(mounted) hotObserver.update(allowedCandidates.map(p=>p.id),pageVisible ? hotScope : '',discoveryActors);
  $: hotInterest = hotQuery(route.page === 'topic' ? route.value : '', $hotPreferences.interests,joined,visibleSaved);
  $: aiHotActive = hotActive && ['home','topic'].includes(route.page) && pageVisible && $hotPreferences.ai;
  $: aiCandidates = aiHotActive ? hotCandidates(allowedCandidates,baseHot,hotInterest) : [];
  $: hotAssistance.update(aiHotActive ? hotInterest : '',aiCandidates,hotScope);
  $: ranked = hotActive ? ($hotAssistance.scores.size ? rankHot(allowedCandidates,{...hotOptions,ai:$hotAssistance.scores}) : baseHot)
    : [...allowedCandidates].sort((a,b) => {
      const score = (p:Post) => activeOrder === 'Best match' ? matchScores.get(p.id) ?? 0 : activeOrder === 'New' ? p.created_at
        : ($likes[p.id]?.length || 0) + (replyCounts[p.id] || 0);
      return score(b)-score(a) || b.created_at-a.created_at || a.id.localeCompare(b.id);
    });
  $: rankedById = new Map(ranked.map(p=>[p.id,p]));
  $: heldIds = new Set(heldHot);
  $: ordered = hotActive && heldHot ? [
    ...heldHot.map(id=>rankedById.get(id)).filter((p):p is Post=>Boolean(p)),
    ...ranked.filter(p=>!heldIds.has(p.id)),
  ] : ranked;
  $: hotChanged = hotActive && heldHot && ranked.slice(0,limit).some((p,i)=>ordered[i]?.id !== p.id);
  $: visible = ordered.slice(0,limit);
  function holdHotOrder() {
    if(hotActive && !heldHot && window.scrollY > 160) heldHot=ranked.map(p=>p.id);
  }
  function refreshHot() {
    heldHot=undefined;hotOptions={...hotOptions,now:Date.now()/1000};hotRefresh++;window.scrollTo({top:0,behavior:'instant'});
  }
  $: if (mounted && route.page !== 'thread')
    observeAuthors([
      ...(route.page === 'profile' ? [route.value] : []),
      ...candidates.slice(0, 240).map((p) => p.pubkey),
    ]);
  $: ids = (route.connections || ['thread','topics','missing','notifications','settings'].includes(route.page)
    ? [] : visible.slice(0, 48).map((p) => p.id))
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
  $: topicMatches = plan ? discovered.filter(slug => plan.hashtags.includes(slug) ||
    plan.terms.some(term => slug === term || (term.length >= 3 && slug.startsWith(term)))).slice(0,5) : [];
  $: title =
    route.page === 'home'
      ? 'Discussions'
      : route.page === 'topic'
        ? 'r/' + route.value
        : route.page === 'following'
          ? 'Following'
          : route.page === 'network'
            ? 'In network'
            : route.page === 'saved'
              ? 'Saved posts'
              : route.page === 'settings'
                ? 'Settings'
                : route.page === 'notifications'
                ? 'Notifications'
                : route.page === 'topics'
                  ? 'Communities'
                  : route.page === 'search'
                    ? 'Search results'
                    : route.page === 'profile'
                      ? (route.connections ? (route.connections === 'followers' ? 'Followers' : 'Following') + ' · ' + profName : profName)
                      : route.page === 'thread'
                        ? 'Discussion'
                        : 'Page not found';
  $: subtitle =
    route.page === 'topic'
        ? topic.desc
        : route.page === 'following'
          ? 'Conversations from people you follow.'
          : route.page === 'network'
            ? 'People within two steps of your social graph.'
            : route.page === 'saved'
              ? 'Posts bookmarked in this browser.'
              : route.page === 'notifications'
                ? 'Replies, mentions, and likes for your profile.'
                : route.page === 'topics'
                  ? 'Find your corner of the network.'
                  : route.page === 'search'
                    ? 'Loaded discussions and communities.'
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
      const topic = route.page === 'topic' ? route.value : route.fromTopic;
      const path = postUrl(p.id, topic && matchesTopic(p,topic) ? topic : undefined);
      try {
        await navigator.clipboard.writeText(location.origin + path);
        notify('Post link copied');
      } catch {
        go(path);
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
  function changeOrder(name: string) {
    heldHot = undefined;
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

<svelte:window onscroll={holdHotOrder}/>
<svelte:document onvisibilitychange={() => pageVisible = document.visibilityState === 'visible'} />

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
            ? displayName($account.pubkey, $profiles[$account.pubkey])
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
          href={item.path}><Icon name={item.icon} size={18} />{item.title}
          {#if item.page === 'notifications' && $unreadNotificationIds.size}
            <span class="unread-count" aria-label={$unreadNotificationIds.size + ' unread'}>{$unreadNotificationIds.size}</span>
          {/if}</a
        >{/each}
    </div>
    <div class="nav-group">
      <div class="side-label">COMMUNITIES</div>
      <a class="nav-row" class:active={route.page === 'topics'} href="/topics"
        ><Icon name="compass" />Explore all</a
      >
      {#each [...new Set( [...joined, ...topics.map((t) => t.slug)] )].slice(0, 15) as slug (slug)}<a
          class="nav-row topic-row"
          class:active={route.page === 'topic' && route.value === slug}
          href={'/r/' + slug}><TopicIcon {slug} small />r/{slug}</a
        >{/each}
    </div>
    <a class="nav-row" class:active={route.page === 'settings'} aria-current={route.page === 'settings' ? 'page' : undefined} href="/settings"><Icon name="settings" size={18} />Settings</a>
    {#if $pendingWrites.length}<a class="sync-link" href="/settings">{$pendingWrites.length} pending {$pendingWrites.length === 1 ? 'change' : 'changes'}</a>{/if}
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
    {#if route.page === 'topic'}
      <div class="mobile-community-intro">
        <CommunityIntro {title} {subtitle} joined={joined.includes(route.value)} onjoin={() => join(route.value)}/>
      </div>
    {:else if ['following', 'network', 'saved'].includes(route.page)}
      <section class="hero">
        <div class="hero-content">
          <div class="hero-kicker">
            <span></span>PERSONAL FEED
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </section>
    {:else if ['topics', 'search', 'notifications'].includes(route.page)}
      <div class="page-head">
        <div class="eyebrow">
          {route.page === 'topics' ? 'DIRECTORY' : 'DISCOVERY'}
        </div>
        <h1>{title}</h1>
        {#if route.page === 'search'}
          <p class="search-summary">“{route.value}” · {subtitle}</p>
          <form class="refine-search" aria-label="Refine search" onsubmit={e => { e.preventDefault(); submitSearch(); }}>
            <input aria-label="Refine search" bind:value={search} placeholder="Search discussions" enterkeyhint="search"/>
            <button type="submit" aria-label="Search discussions"><Icon name="search" size={18}/></button>
          </form>
        {:else}<p>{subtitle}</p>{/if}
      </div>
    {/if}
    {#if route.connections}
      {#key route.value + route.connections}
        <ProfileConnections pubkey={route.value} direction={route.connections}/>
      {/key}
    {:else if route.page === 'settings'}
      <div class="page-head"><h1>Settings</h1><p>Preferences are saved in this browser.</p></div>
      <AppearanceSettings/>
      <section class="preferences" aria-labelledby="feed-preferences">
        <h2 id="feed-preferences">Feed preferences</h2>
        <label><span>Feed order</span>
          <select value={sorting} onchange={(event) => changeOrder(event.currentTarget.value)}>
            {#each orders as order}<option value={order.name}>{order.name}</option>{/each}
          </select>
        </label>
        <label><span>Show media previews in feeds</span><input type="checkbox" checked={showPreviews} onchange={(event) => {
          showPreviews = event.currentTarget.checked;
          writeLocal('showPreviews', showPreviews);
        }} /></label>
      </section>
      <HotSettings/>
      <ImageProxySettings/>
      <GraphSettings/>
      {#if $account}<Outbox/>{/if}
      {#if $account}
        {#key $account.pubkey + ':' + $account.method}<ProfileBackup method={$account.method}/>{/key}
      {/if}
    {:else if route.page === 'notifications'}
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
      <a class="back-link" href={threadTopic ? topicPath(threadTopic) : '/'}
        ><Icon name="back" size={15} />{thread
          ? 'r/' + threadTopic
          : 'Home feed'}</a
      >
      {#if thread}
        {#if isEventId(thread.root)}<a class="back-link" href={postUrl(thread.root)}
            ><Icon name="comment" size={15} />View original discussion</a
          >{/if}
        {#if isEventId(thread.parent) && thread.parent !== thread.root}
          <a class="back-link" href={postUrl(thread.parent)}><Icon name="back" size={15}/>Parent comment</a>
        {/if}
        <Card
          post={thread}
          contextTopic={threadTopic}
          saved={saved.some((s) => s.id === thread.id)}
          full
          onaction={action}
        />
        {#key thread.id}
          <ThreadComments {thread} {saved} onaction={action} onSignIn={() => showModal('account')} {notify}/>
        {/key}
      {:else if $hiddenPostIds.has(route.value) || saved.some(p => p.id === route.value && !$canSeeAuthor(p.pubkey))}
        <div class="empty"><Icon name="globe" size={28}/><h2>{$graphStatus === 'loading' ? 'Checking your network…' : 'Outside your graph settings'}</h2>
          <p>Visibility depends on the author’s follow distance and mutes.</p><a href="/settings">Graph settings</a></div>
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
        <ProfileHeader pubkey={route.value} followBusy={busy.has('follow')} muteBusy={busy.has('mute')}
          onFollow={() => toggleFollow(route.value)} onMute={() => toggleMute(route.value)}
          onEdit={() => showModal('profile')}/>
      {/if}
      {#if route.page === 'search'}
        <div class="search-assist">
          <label><input type="checkbox" checked={related} onchange={e => {
            related = e.currentTarget.checked; writeLocal('relatedSearch', related);
          }}/> Match related meanings</label>
          <small role="status">{$assistance.status === 'loading' ? 'Preparing on-device search…' :
            $assistance.status === 'ranking' ? 'Finding related discussions…' :
            $assistance.status === 'ready' ? 'Ranked on this device' :
            $assistance.status === 'unavailable' ? 'On-device model unavailable. Showing keyword matches.' : 'Keyword matches'}</small>
        </div>
        <div class="relay-search">
          <button class="outline compact" disabled={searching || route.value.length < 2} onclick={expandSearch}><Icon name="search" size={15}/>{searching ? 'Searching…' : 'Search relays'}</button>
          <small role="status">{searchMessage || (searched ? (relayMatchCount ? `Found ${relayMatchCount} matching discussion${relayMatchCount === 1 ? '' : 's'} on relays.` : 'Connected relays returned no matching discussions within your graph settings.') : 'Send search terms to public relays for more results.')}</small>
        </div>
        {#if profileKey(route.value)}<a
            class="search-profile"
            href={profileUrl(profileKey(route.value))}
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
        {#if route.page === 'home'}<h1>Discussions</h1>{:else}<h2>{route.page === 'profile' ? 'Posts' : 'Discussions'}</h2>{/if}
        {#if route.page === 'search'}
          <select class="search-order" aria-label="Sort search results" bind:value={searchOrder}>
            {#each ['Best match','New','Top','Hot'] as order}<option value={order}>{order}</option>{/each}
          </select>
        {:else}
        <div class="sort-bar" aria-label="Sort discussions">
          {#each orders as o}<button
              class:selected={sorting === o.name}
              aria-pressed={sorting === o.name}
              onclick={() => changeOrder(o.name)}
              ><Icon name={o.icon} size={14} />{o.name}</button
            >{/each}
        </div>
        {/if}
      </div>
      {#if hotActive && (route.page === 'home' || route.page === 'topic')}
        <div class="hot-controls">
          <a href="/settings" class="hot-status">{$hotPreferences.ai && hotInterest
            ? $hotAssistance.status === 'loading' ? 'Personalizing…' : $hotAssistance.status === 'ready' ? 'Personalized on this device'
              : $hotAssistance.status === 'unavailable' ? 'AI unavailable · social ranking' : 'Hot preferences'
            : 'Hot preferences'}</a>
          <button onclick={refreshHot}>{hotChanged ? 'Show updated posts' : 'Refresh Hot'}</button>
        </div>
      {/if}
      <section class="feed-list" aria-label="Discussions">
        {#each visible as p (p.id)}<Card
            contextTopic={route.page === 'topic' ? route.value : undefined}
            {showPreviews}
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
            {:else if route.page === 'search'}<h2>{['loading','ranking'].includes($assistance.status) ? 'Looking for matches…' : 'No matching posts'}</h2>
              <p>{['loading','ranking'].includes($assistance.status) ? 'Checking the discussions on this device.' : 'Try a different search or explore more communities.'}</p>
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
      {#if ordered.length > limit}<button
          class="load-more outline"
          onclick={() => (limit += 24)}
          >Load more discussions <Icon name="down" size={15} /></button
        >{/if}
    {/if}
  </main>
  <aside class="right-rail" aria-label="Community information">
    {#if route.page === 'topic'}
      <CommunityIntro {title} {subtitle} joined={joined.includes(route.value)} onjoin={() => join(route.value)}/>
    {/if}
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
      ? 'Nostr profile'
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
          go(postUrl(p.id));
          notify('Post saved');
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

<style>
  .hot-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 12px;font-size:12px;color:var(--muted)}
  .hot-status{color:var(--muted)}
  .hot-controls button{font-size:12px;color:var(--accent)}
</style>
