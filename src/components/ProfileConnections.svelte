<script lang="ts">
  import ProxyAvatar from './ProxyAvatar.svelte';
  import { account, canSeeAuthor, follows, profiles, relationshipPage } from '../lib/network';
  import { graphInfo, graphStatus } from '../lib/graph';
  import { profileUrl, type Relationship } from '../lib/profile-url';
  import { displayName } from '../lib/ui';
  import Icon from './Icon.svelte';
  import SocialBadge from './SocialBadge.svelte';

  export let pubkey: string;
  export let direction: Relationship;
  let pageIndex = 0;
  $: permitted = $canSeeAuthor(pubkey);
  $: ownerName = permitted ? displayName(pubkey, $profiles[pubkey]) : 'Profile';
  $: page = relationshipPage(pubkey, direction, pageIndex);
  $: title = direction === 'followers' ? 'Followers' : 'Following';
</script>

<a class="back-link" href={profileUrl(pubkey)}><Icon name="back" size={15}/> {ownerName}</a>
<section class="connections" aria-label="Profile connections">
  <h1>{title}</h1>
  {#if permitted}<p class="description">{direction === 'followers' ? 'Profiles known to follow ' + ownerName + '.' : 'Public follows from ' + ownerName + '.'}</p>{/if}
  <nav aria-label="Relationship lists">
    {#each ['followers', 'following'] as tab}
      <a href={profileUrl(pubkey, tab === 'followers' ? 'followers' : 'following')} aria-current={tab === direction ? 'page' : undefined}>{tab === 'followers' ? 'Followers' : 'Following'}</a>
    {/each}
  </nav>
  {#if !permitted}
    <p class="state loading-state">
      {#if !$graphInfo[pubkey] && $graphStatus === 'loading'}Checking your social graph…
      {:else}Your <a href="/settings">graph settings</a> hide this profile.{/if}
    </p>
  {:else if $page.keys.length}
    <ul aria-label={title}>
      {#each $page.keys as key (key)}
        {@const person = $profiles[key]}
        {@const name = displayName(key, person)}
        <li><a class="person" href={profileUrl(key)} aria-label={name}>
          <SocialBadge pubkey={key}/>
          <ProxyAvatar pubkey={key} profile={person} size={38}/>
          <span class="details"><strong><span class="person-name">{name}</span></strong>{#if person?.about}<small>{person.about}</small>{/if}</span>
          {#if $account && $follows.includes(key)}<span class="followed">You follow</span>{/if}<Icon name="next" size={14}/>
        </a></li>
      {/each}
    </ul>
  {:else if $page.status !== 'limited'}<p class="state loading-state" role="status">
    {#if $page.loading}Loading profiles…
    {:else if $page.status === 'filtered'}No profiles are visible with your <a href="/settings">graph settings</a>.
    {:else if $page.status === 'unknown'}No public list has been found for this profile yet.
    {:else}{direction === 'followers' ? 'No known followers on this page.' : 'No public follows on this page.'}{/if}
  </p>{/if}
  {#if permitted && $page.status === 'limited'}<button class="outline compact" onclick={$page.scanMore}>Check more profiles</button>{/if}
  {#if permitted && (pageIndex > 0 || $page.hasNext)}
    <div class="paging"><button class="outline compact" disabled={!pageIndex} onclick={() => pageIndex -= 1}>Previous</button>
      <span>Page {pageIndex + 1}</span><button class="outline compact" disabled={!$page.hasNext} onclick={() => pageIndex += 1}>Next</button></div>
  {/if}
</section>

<style>
  .connections {background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;overflow:hidden}
  h1 {font:700 30px/1.15 var(--serif);letter-spacing:-.8px}
  .description,.state,.paging {color:var(--muted);font-size:13px}
  .description {margin:5px 0 15px}
  nav {display:flex;gap:20px;border-bottom:1px solid var(--line);margin-top:12px}
  nav a {font-size:14px;font-weight:650;padding:6px 2px 8px;color:var(--muted);border-bottom:2px solid transparent}
  nav a[aria-current='page'] {color:var(--green);border-color:var(--green)}
  ul {list-style:none;padding:0;margin:0}
  li + li {border-top:1px solid var(--line)}
  .person {display:flex;align-items:center;gap:10px;padding:12px 2px;color:var(--ink)}
  .person:hover strong,.state a {color:var(--green);text-decoration:underline}
  .details {flex:1;min-width:0}.details strong,.details small {display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .details small,.followed {color:var(--muted);font-size:12px}
  .details strong{display:flex;align-items:center;gap:5px}.person-name{min-width:0;overflow:hidden;text-overflow:ellipsis}
  .followed {font-size:11px}.state {margin:18px 0}
  .paging {display:flex;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px}
  @media (max-width:520px){.connections{padding:15px}.person{gap:7px}}
</style>
