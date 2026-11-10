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
    loadTopic,
    loadHome,
    loadFeed,
    loadNetwork,
    refreshFeed,
    loadThread,
    searchRelays,
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
  import { allowModel, keywordScore, noExpansion, relevance, semanticFloor } from './lib/discovery/discussions';
  import type { SearchCursors } from './lib/discovery/relay-search';
  import { checkSearch, searchTarget } from './lib/search';
  import { observeAuthors, observeEventAuthors, graphInfo, graphStatus, setGraphRanking } from './lib/graph';
  import {
    topics,
    validTopic,
    displayName,
    readLocal,
    writeLocal,
  } from './lib/ui';
  import TopicIntro from './components/TopicIntro.svelte';
  import Mark from './components/Mark.svelte';
  import Icon from './components/Icon.svelte';
  import TopicIcon from './components/TopicIcon.svelte';
  import Card from './components/Card.svelte';
  import { topicPath, topicSlug } from './lib/hashtags';
  import { seenTopics } from './lib/topic-catalog-store';
  import { matchesTopic, mentionsTopic } from './lib/posts';
  import { isEventId, postIdFromPath, postUrl } from './lib/post-url';
  import { profileUrl, profileKeyFromPath, type Relationship } from './lib/profile-url';
  import { hotPreferences } from './lib/hot-preferences';
  import { rankHot, hotQuery, hotCandidates } from './lib/hot';
  import { createHotSession } from './lib/hot-session';
  import { createFeedPresentation } from './lib/feed-presentation';
  import FeedComposer from './components/FeedComposer.svelte';
  import { feedPreferences, saveFeed } from './lib/feed-preferences';
  import { defaultFeeds, feedPath, feedIcon, feedSummary, feedRelayFilters, matchesFeed, type Feed, type FeedOrder } from './lib/feeds';
  let feedList: HTMLElement;
  function viewportSlots() {
    if (!pageVisible || !feedList) return 0;
    const cards = feedList.children;
    // Cards are in vertical reading order. Find the first one below the fold.
    let start = 0, end = cards.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (cards[middle].getBoundingClientRect().top < innerHeight) start = middle + 1;
      else end = middle;
    }
    if (start && start === cards.length && start < limit) {
      const nextTop = feedList.getBoundingClientRect().bottom + parseFloat(getComputedStyle(feedList).rowGap);
      if (nextTop < innerHeight) return start + 1;
    }
    return start;
  }
  const feedPresentation = createFeedPresentation(viewportSlots);
  function watchFeedSize(list: HTMLElement) {
    const observer = new ResizeObserver(feedPresentation.viewportChanged);
    observer.observe(list);
    return { destroy: () => observer.disconnect() };
  }
  export let active = true;
  export let returnTo: string | undefined = undefined;
  export let navigate: (path: string) => void;
  type Route = { page: string; value: string; connections?: Relationship; fromTopic?: string };
  function readRoute(): Route {
    const [base, value = '', section, extra] = location.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/');
    if (!base) return { page: 'home', value: '' };
    if (base === 'feeds' && /^[a-z0-9-]{1,64}$/.test(value) && !section) return { page: 'custom', value };
    if ((base==='t' || base==='r') && !section) {
      let slug='';
      try {slug=topicSlug(decodeURIComponent(value));} catch { /* Invalid escaped topic. */ }
      if(slug) {
        const canonical=topicPath(slug);
        if(location.pathname!==canonical) history.replaceState(history.state,'',canonical+location.search+location.hash);
        return {page:'topic',value:slug};
      }
    }
    if (base === 'post' && section === undefined) {
      const id = postIdFromPath(value);
      if (id) {
        const canonical = postUrl(id);
        if (location.pathname !== canonical) history.replaceState(history.state, '', canonical + location.search + location.hash);
        const params = new URLSearchParams(location.search);
        const from = topicSlug(params.get('t') || params.get('r') || '');
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
  const orders = [
    { name: 'Hot', icon: 'hot' },
    { name: 'New', icon: 'clock' },
    { name: 'Top', icon: 'top' },
  ];
  let documentVisible = document.visibilityState === 'visible';
  let pageVisible = active && documentVisible;
  let route = readRoute(),
    search = route.page === 'search' ? route.value : '',
    menu = false,
    modal = '',
    dialog: HTMLDialogElement;
  let toast = '',
    alertTimer: ReturnType<typeof setTimeout>,
    busy = new Set<string>(),
    zapPost: Post | undefined;
  let saved = readLocal<Post[]>('saved', []),
    sorting = readLocal<string>('sort', 'Hot');
  let showPreviews = readLocal<boolean>('showPreviews', true);
  let limit = 24,
    showAccountAfter = '';
  let composeMode:'text'|'link'|undefined;
  let editingFeed: Feed | undefined;
  function customize(feed?: Feed) { editingFeed = feed; showModal('feeds'); }
  let searchInput: HTMLInputElement;
  let activeCleanup: (() => void) | undefined,
    observedCleanup: (() => void) | undefined,
    mounted = false,
    dialogPrev: HTMLElement | null = null;
  let directoryFilter = '';
  const assistance = createSearchSession();
  const hotAssistance = createHotSession(), hotObserver = createHotObserver();
  let seenHot = readLocal<string[]>('seenHot', []);
  let baseHot: Post[] = [], ranked: Post[] = [];
  let hotRefresh = 0;
  let related = readLocal<boolean>('relatedSearch', true);
  let searchOrder = 'Best match';
  let remoteIds = new Set<string>();
  let searchRun = 0;
  let searchCursors: SearchCursors | undefined;
  let searchExpansion = noExpansion;
  let searching = false, searched = false, searchMessage = '';
  $: canSearchMore = searchCursors?.some(cursor => cursor !== null) ?? true;
  async function expandSearch(more = false) {
    if (searching) return;
    const run = ++searchRun;
    searching = true;
    searchMessage = '';
    try {
      const query = checkSearch(route.value);
      const expansion = more ? searchExpansion : await assistance.relayExpansion(query);
      if (run !== searchRun) return;
      const found = await searchRelays(query, expansion, more ? searchCursors : undefined);
      if (run !== searchRun) return;
      remoteIds = found.ids;
      searchCursors = found.cursors;
      searchExpansion = expansion;
      searched = true;
    } catch (error) {
      if (run === searchRun) searchMessage = error instanceof Error ? error.message : 'Relay search failed.';
    } finally {
      if (run === searchRun) searching = false;
    }
  }
  function go(path: string) { navigate(path); }
  function intercept(e: MouseEvent) {
    if (
      !active ||
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
    if (a.dataset.historyBack) { history.back(); return; }
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
    const removedFeed = modal === 'feeds' && route.page === 'custom' && !$feedPreferences.some(feed => feed.id === route.value);
    showAccountAfter = '';
    modal = '';
    zapPost = undefined;
    dialog?.close();
    tick().then(() => dialogPrev?.focus());
    if (removedFeed && active) go('/');
  }
  function accountDone() {
    const after = showAccountAfter;
    closeModal();
    if ($account && after === 'compose') {
      showModal('compose');
    } else if ($account && after.startsWith('follow:')) {
      void toggleFollow(after.slice(7), true);
    }
  }
  function notify(s: string) {
    toast = s;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => (toast = ''), 4200);
  }
  function compose(mode?:'text'|'link') {
    composeMode=mode;
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
    if (!active) return;
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
  function subscribeRoute(page: string, value: string, connections: Relationship | undefined, feedFilters: string, networkFeed: boolean) {
    activeCleanup?.();
    const closeRoute =
      page === 'home' ? loadHome()
      : page === 'topic'
        ? loadTopic(value)
        : page === 'thread'
          ? loadThread(value)
          : page === 'profile'
            ? loadProfile(value, connections)
            : page && feedFilters ? loadFeed(JSON.parse(feedFilters)) : undefined;
    const closeNetwork = page && networkFeed ? loadNetwork() : undefined;
    activeCleanup = () => { closeRoute?.(); closeNetwork?.(); };
  }
  function watch(ids: string) {
    observedCleanup?.();
    observedCleanup = ids ? observe(ids.split(',')) : undefined;
  }
  onMount(() => {
    mounted = true;
    if (route.page === 'thread' && !seenHot.includes(route.value)) {
      seenHot = [...seenHot, route.value].slice(-500); writeLocal('seenHot', seenHot);
    }
    document.addEventListener('click', intercept);
    document.addEventListener('keydown', keypress);
    return () => {
      hotAssistance.reset(); hotObserver.reset();
      assistance.reset();
      activeCleanup?.();
      observedCleanup?.();
      clearTimeout(alertTimer); feedPresentation.destroy();
      document.removeEventListener('click', intercept);
      document.removeEventListener('keydown', keypress);
    };
  });
  $: selectedFeed = $feedPreferences.find(feed => feed.id === (route.page === 'custom' ? route.value : route.page))
    ?? (route.page !== 'custom' ? defaultFeeds().find(feed => feed.id === route.page) : undefined);
  $: feedFilters = selectedFeed && selectedFeed.id !== 'home' ? JSON.stringify(feedRelayFilters(selectedFeed)) : '';
  $: feedScope = selectedFeed ? JSON.stringify(selectedFeed) : '';
  $: followingFeed = route.page === 'following' || selectedFeed?.source === 'following';
  $: networkFeed = route.page === 'network' || selectedFeed?.source === 'network';
  $: savedFeed = route.page === 'saved' || selectedFeed?.source === 'saved';
  $: if (mounted) subscribeRoute(active ? route.page : '', route.value, route.connections, feedFilters, networkFeed);
  $: if (!active) {
    menu = false;
    if (modal) closeModal();
    searchRun++; searching = false;
  }
  $: if (active && mounted) {
    saved = readLocal<Post[]>('saved', []);
    showPreviews = readLocal<boolean>('showPreviews', true);
  }
  $: pageVisible = active && documentVisible;
  $: if (active) observeEventAuthors(saved.map(p => p.pubkey));
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
  $: source = savedFeed ? visibleSaved : route.page === 'topic'
    ? [...$posts,...$comments.filter(reply=>mentionsTopic(reply,route.value))] : $posts;
  $: plan = route.page === 'search' && route.value ? planPostSearch(route.value) : undefined;
  $: lexical = new Map(plan ? source.map(p => [p.id, keywordScore(plan!, p, displayName(p.pubkey, $profiles[p.pubkey]))] as const) : []);
  $: assistance.update(plan && related && pageVisible && allowModel(plan) ? plan : undefined,
    plan ? [...visibleSearch, ...source.filter(p => !remoteIds.has(p.id))]
      .filter(p => (lexical.get(p.id) ?? -1) >= 0) : []);
  $: minimum = semanticFloor(plan, $assistance.scores);
  $: matchScores = new Map([...lexical].map(([id, score]) => [id, relevance(score, $assistance.scores.get(id), minimum)]));
  $: relayMatchCount = visibleSearch.filter(p => (matchScores.get(p.id) ?? 0) > 0).length;
  $: activeOrder = route.page === 'search' ? searchOrder : selectedFeed?.order ?? sorting;
  $: candidates = source.filter((p) => {
    if (route.page === 'topic') return matchesTopic(p,route.value);
    if (selectedFeed) return matchesFeed(p, selectedFeed, $follows, $graphInfo[p.pubkey]?.distance);
    if (route.page === 'custom') return false;
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
  $: hotActive = activeOrder === 'Hot' && ['home','topic','following','network','saved','custom','profile','search'].includes(route.page) && !route.connections;
  $: hotScope = hotActive ? `${route.page}:${route.value}:${feedScope}:${$account?.pubkey || 'guest'}:${hotRefresh}` : '';
  $: if(mounted && active)setGraphRanking(hotActive && $hotPreferences.connectionStrength);
  $: hotOptions = {now:Date.now()/1000,signals:$hotSignals,follows:new Set($follows),saved:visibleSaved,
    topic:route.page === 'topic' ? route.value : '', seen:new Set(seenHot),
    distance:(key:string)=>$graphInfo[key]?.distance, knownBy:(key:string)=>$graphInfo[key]?.followedByFriends ?? 0,
    influence:$hotPreferences.connectionStrength ? (key:string)=>$graphInfo[key]?.influence : undefined};
  $: if (active) baseHot = hotActive ? rankHot(allowedCandidates,hotOptions) : [];
  $: discoveryActors = $follows.length ? $follows : Object.keys($graphInfo).filter(key=>$graphInfo[key].distance===1);
  $: if(mounted) hotObserver.update(allowedCandidates.map(p=>p.id),pageVisible ? hotScope : '',discoveryActors);
  $: hotInterest = hotQuery(route.page === 'topic' ? route.value : '', $hotPreferences.interests,visibleSaved);
  $: aiHotActive = hotActive && ['home','topic'].includes(route.page) && pageVisible && $hotPreferences.ai;
  $: aiCandidates = aiHotActive ? hotCandidates(allowedCandidates,baseHot,hotInterest) : [];
  $: hotAssistance.update(aiHotActive ? hotInterest : '',aiCandidates,hotScope);
  $: if (active) ranked = hotActive ? ($hotAssistance.scores.size ? rankHot(allowedCandidates,{...hotOptions,ai:$hotAssistance.scores}) : baseHot)
    : [...allowedCandidates].sort((a,b) => {
      const score = (p:Post) => activeOrder === 'Best match' ? matchScores.get(p.id) ?? 0 : activeOrder === 'New' ? p.created_at
        : ($likes[p.id]?.length || 0) + (replyCounts[p.id] || 0);
      return score(b)-score(a) || b.created_at-a.created_at || a.id.localeCompare(b.id);
    });
  $: rankedById = new Map(ranked.map(p=>[p.id,p]));
  $: stableFeed = ['home','topic','following','network','saved','custom','profile'].includes(route.page) && !route.connections;
  $: if (mounted) feedPresentation.update(`${activeOrder}:${feedScope}:${$account?.pubkey || 'guest'}`,
    ranked.map(p=>p.id), stableFeed && pageVisible);
  $: ordered = stableFeed ? $feedPresentation.ids.map(id=>rankedById.get(id)).filter((p):p is Post=>Boolean(p)) : ranked;
  $: preparingFeed = stableFeed && !ordered.length && ranked.length > 0;
  $: visible = ordered.slice(0,limit);
  function showUpdatedPosts() {
    feedPresentation.reveal();
    window.scrollTo({top:0,behavior:'instant'});
  }
  function refreshHot() {
    hotOptions={...hotOptions,now:Date.now()/1000};hotRefresh++;
    // Let the explicit refresh's ranking settle before one atomic replacement.
    tick().then(() => feedPresentation.reveal());
    refreshFeed();
    notify('Hot refreshed');
    window.scrollTo({top:0,behavior:'instant'});
  }
  $: if (mounted && active && route.page !== 'thread')
    observeAuthors([
      ...(route.page === 'profile' ? [route.value] : []),
      ...candidates.slice(0, 240).map((p) => p.pubkey),
    ]);
  $: ids = (route.connections || ['thread','topics','missing','notifications','settings'].includes(route.page)
    ? [] : visible.slice(0, 48).map((p) => p.id))
    .sort()
    .join(',');
  $: if (mounted) watch(active ? ids : '');
  $: discovered = [
    ...new Set([
      ...$seenTopics.map(t=>t.slug),
      ...topics.map((t) => t.slug),
    ]),
  ].filter(validTopic);
  $: directoryTopic = topicSlug(directoryFilter.trim().replace(/^[tr]\//i,''));
  $: topicMatches = plan ? discovered.filter(slug => plan.hashtags.includes(slug) ||
    plan.terms.some(term => slug === term || (term.length >= 3 && slug.startsWith(term)))).slice(0,5) : [];
  $: title =
    route.page === 'home'
      ? 'Home'
      : selectedFeed ? selectedFeed.name : route.page === 'topic'
        ? 't/' + route.value
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
                  ? 'Topics'
                  : route.page === 'search'
                    ? 'Search results'
                    : route.page === 'profile'
                      ? (route.connections ? (route.connections === 'followers' ? 'Followers' : 'Following') + ' · ' + profName : profName)
                      : route.page === 'thread'
                        ? 'Discussion'
                        : 'Page not found';
  $: subtitle =
    route.page === 'custom' && selectedFeed ? feedSummary(selectedFeed) : route.page === 'following'
          ? 'Conversations from people you follow.'
          : route.page === 'network'
            ? 'People within two steps of your social graph.'
            : route.page === 'saved'
              ? 'Posts bookmarked in this browser.'
              : route.page === 'notifications'
                ? 'Replies, mentions, and likes for your profile.'
                : route.page === 'topics'
                  ? 'Browse a topic or enter any tag to open it.'
                  : route.page === 'search'
                    ? 'Loaded discussions and topics.'
                    : '';
  $: if (active) document.title =
    (route.page === 'thread' && thread ? thread.title.slice(0, 70) : title) +
    ' · Nostreddit';
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
  async function toggleFollow(key: string, enabled = !$follows.includes(key)) {
    if (!$account) {
      showAccountAfter = 'follow:' + key;
      showModal('account');
      return;
    }
    if (busy.has('follow')) return;
    busy = new Set([...busy, 'follow']);
    try {
      await follow(key, enabled);
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
    if (selectedFeed && selectedFeed.id !== 'home' && $feedPreferences.some(feed => feed.id === selectedFeed.id)) {
      saveFeed({ ...selectedFeed, order: name as FeedOrder });
      return;
    }
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

{#snippet componentError()}
  <p class="state" role="alert">Could not load this page.</p>
  <button class="outline compact" onclick={() => location.reload()}>Reload page</button>
{/snippet}

<svelte:document onvisibilitychange={() => documentVisible = document.visibilityState === 'visible'} />
<svelte:window onscroll={feedPresentation.viewportChanged} onresize={feedPresentation.viewportChanged} />

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
      <button class="create-button" aria-label="Create post" onclick={()=>compose()}
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
      <div class="feed-nav-heading"><div class="side-label">FEEDS</div><button aria-label="Customize feeds" title="Customize feeds" onclick={() => customize()}><Icon name="settings" size={15}/></button></div>
      {#each $feedPreferences as item (item.id)}<a
          class="nav-row"
          class:active={selectedFeed?.id === item.id}
          aria-current={selectedFeed?.id === item.id ? 'page' : undefined}
          href={feedPath(item)}><Icon name={feedIcon(item)} size={18} />{item.name}
          {#if item.id === 'notifications' && $unreadNotificationIds.size}
            <span class="unread-count" aria-label={$unreadNotificationIds.size + ' unread'}>{$unreadNotificationIds.size}</span>
          {/if}</a
        >{/each}
    </div>
    <div class="nav-group">
      <div class="side-label">TOPICS</div>
      <a class="nav-row" class:active={route.page === 'topics'} href="/topics"
        ><Icon name="compass" />Explore all</a
      >
      {#each topics.map((t) => t.slug) as slug (slug)}<a
          class="nav-row topic-row"
          class:active={route.page === 'topic' && route.value === slug}
          href={topicPath(slug)}><TopicIcon {slug} small />{slug}</a
        >{/each}
    </div>
    <a class="nav-row" class:active={route.page === 'settings'} aria-current={route.page === 'settings' ? 'page' : undefined} href="/settings"><Icon name="settings" size={18} />Settings</a>
    {#if $pendingWrites.length}<a class="sync-link" href="/settings">{$pendingWrites.length} pending {$pendingWrites.length === 1 ? 'change' : 'changes'}</a>{/if}
    <div class="left-foot" class:loading-state={$status === 'loading'}>
      <span class="signal-dot" class:offline={$status === 'offline'}
      ></span>{$status === 'live'
        ? 'Relays connected'
        : $status === 'loading'
          ? 'Connecting to relays'
          : 'Relays offline'}
    </div>
  </aside>
  <main tabindex="-1">
    {#if route.page === 'topic'}
      <div class="mobile-topic-intro">
        <TopicIntro {title}/>
      </div>
    {:else if ['following', 'network', 'saved', 'custom'].includes(route.page) && selectedFeed}
      <section class="hero">
        <div class="hero-content">
          <div class="hero-kicker">
            <span></span>PERSONAL FEED
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <button class="edit-feed" onclick={() => customize(selectedFeed)}><Icon name="edit" size={13}/>Edit feed</button>
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
              {#await import('./components/ProfileConnections.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: ProfileConnections}}
        <ProfileConnections pubkey={route.value} direction={route.connections}/>
      {:catch}
        {@render componentError()}
      {/await}
      {/key}
    {:else if route.page === 'settings'}
            {#await import('./components/SettingsPage.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: SettingsPage}}
        <SettingsPage {active} {sorting} {showPreviews} onOrderChange={changeOrder}
        onPreviewsChange={(value) => { showPreviews = value; writeLocal('showPreviews', value); }} />
      {:catch}
        {@render componentError()}
      {/await}
    {:else if route.page === 'notifications'}
            {#await import('./components/Notifications.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: Notifications}}
        <Notifications {active} onSignIn={() => showModal('account')} />
      {:catch}
        {@render componentError()}
      {/await}
    {:else if route.page === 'topics'}
      <label class="directory-input"
        ><Icon name="search" /><input
          bind:value={directoryFilter}
          placeholder="Find or open a topic"
          aria-label="Find or open a topic"
        /></label
      >
      <section class="directory">
        {#each discovered
          .filter((s) => s.includes(directoryFilter
                .trim()
                .toLowerCase()
                .replace(/^(?:[tr]\/|#)/, '')))
          .slice(0, 80) as slug}
          <div class="directory-row">
            <a href={topicPath(slug)}
              ><TopicIcon {slug} />
              <div>
                <strong>{slug}</strong>
              </div></a
            >
          </div>
        {/each}
        {#if directoryTopic && !discovered.includes(directoryTopic)}<a
            class="new-topic"
            href={topicPath(directoryTopic)}
            >Open {directoryTopic}
            <Icon name="next" size={15} /></a
          >{/if}
      </section>
    {:else if route.page === 'thread'}
      <a class="back-link" data-history-back={returnTo ? 'true' : undefined} href={returnTo ?? (threadTopic ? topicPath(threadTopic) : '/')}
        ><Icon name="back" size={15} />{returnTo ? 'Back' : thread
          ? 't/' + threadTopic
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
                {#await import('./components/ThreadComments.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: ThreadComments}}
        <ThreadComments routeActive={active} {thread} {saved} onaction={action} onSignIn={() => showModal('account')} {notify}/>
      {:catch}
        {@render componentError()}
      {/await}
        {/key}
      {:else if $hiddenPostIds.has(route.value) || saved.some(p => p.id === route.value && !$canSeeAuthor(p.pubkey))}
        <div class="empty loading-state"><Icon name="globe" size={28}/><h2>{$graphStatus === 'loading' ? 'Checking your network…' : 'Outside your graph settings'}</h2>
          <p>Visibility depends on the author’s follow distance and mutes.</p><a href="/settings">Graph settings</a></div>
      {:else}<div class="empty loading-state">
          <Icon name="comment" size={28} />
          <h2>
            {$status === 'loading'
              ? 'Loading discussion…'
              : 'Looking for this discussion'}
          </h2>
          <p>Posts appear when a connected relay has a copy.</p>
          <a href="/">Back to the feed</a>
        </div>{/if}
    {:else if route.page === 'missing' || (route.page === 'custom' && !selectedFeed)}<div class="empty">
        <Icon name="compass" size={32} />
        <h1>{route.page === 'custom' ? 'Feed not found' : 'Page not found'}</h1>
        {#if route.page === 'custom'}<p>This feed isn’t saved in this browser.</p>{/if}
        <a class="primary" href="/">Back to the feed</a>
      </div>
    {:else}
      {#if route.page === 'profile'}<a class="back-link" href="/"
          ><Icon name="back" size={15} />Home feed</a
        >
              {#await import('./components/ProfileHeader.svelte')}
        <div class="profile-loading loading-state" role="status"><p class="state">Loading profile…</p></div>
      {:then {default: ProfileHeader}}
        <ProfileHeader {active} pubkey={route.value} followBusy={busy.has('follow')} muteBusy={busy.has('mute')}
          onFollow={() => toggleFollow(route.value)} onMute={() => toggleMute(route.value)}
          onEdit={() => showModal('profile')}/>
      {:catch}
        {@render componentError()}
      {/await}
      {/if}
      {#if route.page === 'search'}
        <div class="search-assist">
          <label><input type="checkbox" checked={related} onchange={e => {
            related = e.currentTarget.checked; writeLocal('relatedSearch', related);
          }}/> Match related meanings</label>
          <small role="status" class:loading-state={['loading','ranking'].includes($assistance.status)}>{$assistance.status === 'loading' ? 'Preparing on-device search…' :
            $assistance.status === 'ranking' ? 'Finding related discussions…' :
            $assistance.status === 'ready' ? 'Ranked on this device' :
            $assistance.status === 'unavailable' ? 'On-device model unavailable. Showing keyword matches.' : 'Keyword matches'}</small>
        </div>
        <div class="relay-search">
          <button class="outline compact" disabled={searching || route.value.length < 2} onclick={() => expandSearch()}><Icon name="search" size={15}/>{searching ? 'Searching…' : searched ? 'Search again' : 'Search relays'}</button>
          <small role="status">{searchMessage || (searched ? (relayMatchCount ? `Found ${relayMatchCount} matching discussion${relayMatchCount === 1 ? '' : 's'} on relays.` : canSearchMore ? 'No matches in this batch. Load more to search older discussions.' : 'Connected relays returned no matching discussions within your graph settings.') : 'Showing loaded discussions. Search public relays for more.')}</small>
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
            {#each topicMatches as slug}<a href={topicPath(slug)}
                ><TopicIcon {slug} small />{slug}</a
              >{/each}
          </div>{/if}
      {/if}
      {#if ['home','topic','following','network','custom'].includes(route.page)}<FeedComposer oncreate={compose}/>{/if}
      <div class="feed-heading">
        {#if route.page === 'home'}<h1 class="visually-hidden">Home feed</h1>{/if}
        {#if route.page === 'search'}
          <select class="search-order" aria-label="Sort search results" bind:value={searchOrder}>
            {#each ['Best match','New','Top','Hot'] as order}<option value={order}>{order}</option>{/each}
          </select>
        {:else}
        <div class="sort-bar" role="group" aria-label="Sort discussions">
          {#each orders as o}<button
              class:selected={activeOrder === o.name}
              aria-pressed={activeOrder === o.name}
              onclick={() => changeOrder(o.name)}
              ><Icon name={o.icon} size={14} />{o.name}</button
            >{/each}
        </div>
        {/if}
        <button
          class="preview-toggle"
          aria-label="Show media previews"
          aria-pressed={showPreviews}
          title={showPreviews ? 'Hide media previews' : 'Show media previews'}
          onclick={() => {
            showPreviews = !showPreviews;
            writeLocal('showPreviews', showPreviews);
          }}
        ><Icon name="image" size={16} /><span>Previews</span></button>
      </div>
      {#if stableFeed}
        <div class="hot-controls">
          {#if hotActive && (route.page === 'home' || route.page === 'topic')}
          <a href="/settings" class="hot-status">{$hotPreferences.ai && hotInterest
            ? $hotAssistance.status === 'loading' ? 'Personalizing…' : $hotAssistance.status === 'ready' ? 'Personalized on this device'
              : $hotAssistance.status === 'unavailable' ? 'AI unavailable · social ranking' : 'Hot preferences'
            : 'Hot preferences'}</a>
          {:else}<span></span>{/if}
          {#if $feedPresentation.pending}<button class="pending-updates" onclick={showUpdatedPosts}>Show updated posts</button>
          {:else if hotActive && (route.page === 'home' || route.page === 'topic')}<button onclick={refreshHot}>Refresh Hot</button>{/if}
        </div>
      {/if}
      <section bind:this={feedList} use:watchFeedSize class="feed-list" aria-label="Discussions">
        {#each visible as p (p.id)}<Card
            contextTopic={route.page === 'topic' ? route.value : undefined}
            {showPreviews}
            post={p}
            saved={saved.some((s) => s.id === p.id)}
            onaction={action}
          />{:else}
          <!-- A connected relay can still be waiting for posts. Keep the delay
               for the entire empty interval, including loading/status changes. -->
          <div class="empty" class:loading-state={savedFeed ? saved.length > 0 :
            !followingFeed || !!$account}>
            <span class="empty-icon"
              ><Icon
                name={savedFeed
                  ? 'save'
                  : followingFeed
                    ? 'users'
                    : 'wave'}
                size={24}
              /></span
            >
            {#if savedFeed && !saved.length}<h2>No saved posts yet</h2>
              <p>Use the bookmark on any post to keep it here.</p>
              <a href="/">Browse the feed</a>
            {:else if followingFeed && !$account}<h2>
                Your following feed
              </h2>
              <p>Sign in to read posts from the people you follow.</p>
              <button
                class="primary compact"
                onclick={() => showModal('account')}>Sign in</button
              >
            {:else if followingFeed && !$follows.length}<h2>You aren’t following anyone yet</h2>
              <p>Follow people from their profiles to see their posts here.</p>
              <a href="/">Explore the feed</a>
            {:else if followingFeed}<h2>
                No posts from follows yet
              </h2>
              <p>
                Posts from people you follow will appear here as they load. Your filters may also hide some posts.
              </p>
              <a href="/">Explore the feed</a>
            {:else if route.page === 'search'}<h2>{['loading','ranking'].includes($assistance.status) ? 'Looking for matches…' : 'No matching posts'}</h2>
              <p>{['loading','ranking'].includes($assistance.status) ? 'Checking the discussions on this device.' : 'Try a different search or explore more topics.'}</p>
              <a href="/topics">Browse topics</a>
            {:else if route.page === 'network' && $graphStatus === 'unavailable'}<h2
              >
                Social graph unavailable
              </h2>
              <p>You can still browse all public discussions.</p>
              <a href="/">Open home feed</a>
            {:else if preparingFeed || $status === 'loading' || (route.page === 'network' && $graphStatus === 'loading')}<h2
              >
                Tuning in…
              </h2>
              <p>Loading discussions from the network.</p>
            {:else if selectedFeed && (route.page === 'custom' || selectedFeed.topics.length || selectedFeed.keywords.length || selectedFeed.exclude.length || selectedFeed.authors.length)}
              <h2>No posts match this feed yet</h2><p>Try adjusting your filters or check back for new discussions.</p>
              <button class="outline compact" onclick={() => customize(selectedFeed)}>Edit feed</button>
            {:else}<h2>
                {route.page === 'topic'
                  ? 'No discussions here yet'
                  : $status === 'offline'
                    ? 'Relays are offline'
                    : 'No discussions loaded yet'}
              </h2>
              <p>
                {route.page === 'topic'
                  ? 'Start a conversation in t/' + route.value + '.'
                  : 'Posts appear as your relays connect.'}
              </p>
              {#if route.page === 'topic'}<button
                  class="primary compact"
                  onclick={()=>compose()}>Create a post</button
                >{:else}<a href="/topics">Explore topics</a>{/if}
            {/if}
          </div>{/each}
      </section>
      {#if ordered.length > limit}<button
          class="load-more outline"
          onclick={() => (limit += 24)}
          >Load more discussions <Icon name="down" size={15} /></button
        >{:else if route.page === 'search' && route.value.length >= 2}
        <div class="search-more">
          {#if canSearchMore}
            <button class="load-more outline" disabled={searching} onclick={() => expandSearch(searched)}>
              {searching ? 'Searching…' : searched ? 'Load more results' : 'Search more discussions'}
              <Icon name="down" size={15}/>
            </button>
            <small>{searched ? 'Search older discussions on public relays.' : 'Search public relays beyond the discussions already loaded.'}</small>
          {:else}<p class="quiet" role="status">No more results returned by connected relays.</p>{/if}
          {#if searchMessage}<p class="quiet" role="status">{searchMessage}</p>{/if}
        </div>
        {/if}
    {/if}
  </main>
  <aside class="right-rail" aria-label="Topic information">
    {#if route.page === 'topic'}
      <TopicIntro {title}/>
    {/if}
    <section class="rail-panel popular">
      <div class="rail-eyebrow"><Icon name="compass" size={14} /> DISCOVER</div>
      <h2>Explore topics</h2>
      {#each topics.slice(0, 4) as item}<a
          class="rail-topic"
          href={topicPath(item.slug)}
          ><TopicIcon slug={item.slug} />
          <div><strong>{item.slug}</strong></div>
          <Icon name="next" size={12} /></a
        >{/each}
      <a class="all-topics" href="/topics"
        >All topics <Icon name="next" size={14} /></a
      >
    </section>
    <div class="rail-footer">
      <a href="https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/nostreddit">git.iris.to</a>
      <a href="https://github.com/mmalmi/nostreddit">GitHub</a>
    </div>
  </aside>
</div>
{#if modal}
  <dialog
    bind:this={dialog}
    class="modal"
    class:post-modal={modal==='compose'}
    aria-label={modal === 'feeds' ? 'Customize feeds' : modal === 'account'
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
    {#if modal === 'feeds'}
      {#await import('./components/FeedManager.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: FeedManager}}
        <FeedManager initialFeed={editingFeed} ondone={closeModal}/>
      {:catch}{@render componentError()}{/await}
    {:else if modal === 'account'}      {#await import('./components/AccountPanel.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: AccountPanel}}
        <AccountPanel onclose={accountDone} {notify} />
      {:catch}
        {@render componentError()}
      {/await}
    {:else if modal === 'compose' && $account}      {#await import('./components/Composer.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: Composer}}
        <Composer
        initialTopic={route.page === 'topic' ? route.value : ''}
        initialMode={composeMode}
        owner={$account.pubkey}
        oncancel={closeModal}
        onpublish={(p) => {
          closeModal();
          go(postUrl(p.id));
          notify('Post saved');
        }}
      />
      {:catch}
        {@render componentError()}
      {/await}
    {:else if modal === 'profile' && $account}      {#await import('./components/EditProfile.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: EditProfile}}
        <EditProfile
        profile={$profiles[$account.pubkey]}
        ondone={() => {
          closeModal();
          notify('Profile updated');
        }}
      />
      {:catch}
        {@render componentError()}
      {/await}
    {:else if modal === 'zap' && zapPost}<div
        class="dialog-content zap-content"
      >
              {#await import('./lib/ZapPanel.svelte')}
        <p class="state loading-state" role="status">Loading…</p>
      {:then {default: ZapPanel}}
        <ZapPanel
          event={zapPost.event}
          profile={$profiles[zapPost.pubkey]}
          relays={relayUrls}
          sign={$account ? signEvent : undefined}
        />
      {:catch}
        {@render componentError()}
      {/await}
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
  .feed-nav-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  .feed-nav-heading .side-label{margin-bottom:0}
  .feed-nav-heading button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;color:var(--muted);border-radius:5px}
  .feed-nav-heading button:hover{background:var(--light);color:var(--accent)}
  .edit-feed{display:flex;align-items:center;gap:5px;margin-top:12px;font-size:12px;color:inherit;text-decoration:underline;text-underline-offset:3px}
  /* Match the header's reserved desktop/mobile layout while its code loads. */
  .profile-loading{box-sizing:border-box;border:1px solid var(--line);border-radius:13px;background:var(--paper)}
  .profile-loading::before{content:'';display:block;width:100%;aspect-ratio:4/1;min-height:96px;max-height:180px}
  .profile-loading > .state{box-sizing:border-box;min-height:372.75px;margin:0;padding:20px}

  .hot-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:24px;margin:-4px 0 12px;font-size:12px;color:var(--muted)}
  .hot-status{color:var(--muted)}
  .hot-controls button{font-size:12px;color:var(--accent)}
  .pending-updates{display:inline-flex;align-items:center;gap:6px;font-weight:700}
  .pending-updates::before{content:'';width:7px;height:7px;border-radius:50%;background:light-dark(#bc3932,#ff8980)}
</style>
