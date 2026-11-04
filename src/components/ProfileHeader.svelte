<script lang="ts">
  import { profileUrl } from '../lib/profile-url';
  import ProxyAvatar from './ProxyAvatar.svelte';
  import { proxyImage } from '../lib/image-load';
  import Name from '@iris/svelte-ui/Name.svelte';
  import CopyButton from '@iris/svelte-ui/CopyButton.svelte';
  import { npubEncode } from 'nostr-tools/nip19';
  import { account, follows, mutes, profiles, outboxReady, canSeeAuthor } from '../lib/network';
  import { graphInfo, profileRelations, graphStatus, observeEventAuthors } from '../lib/graph';
  import { snapshotRoot } from '../lib/graph-model';
  import { safeURL, displayName } from '../lib/ui';
  import Icon from './Icon.svelte';

  export let pubkey: string;
  export let followBusy: boolean;
  export let muteBusy: boolean;
  export let onFollow: () => void;
  export let onMute: () => void;
  export let onEdit: () => void;

  let expandedFor = '';
  $: profile = $profiles[pubkey];
  $: mine = pubkey === $account?.pubkey;
  $: following = $follows.includes(pubkey);
  $: muted = $mutes.includes(pubkey);
  $: npub = npubEncode(pubkey);
  $: banner = safeURL(profile?.banner);
  $: website = safeURL(profile?.website);
  $: distance = $graphInfo[pubkey]?.distance;
  $: social = $profileRelations?.subject === pubkey && $profileRelations?.viewer === ($account?.pubkey || snapshotRoot)
    ? $profileRelations : null;
  $: observeEventAuthors([pubkey, ...(social?.mutuals ?? [])]);
  $: allowed = $canSeeAuthor(pubkey);
  $: allowedPeople = social?.mutuals.filter($canSeeAuthor) ?? [];
  $: people = allowedPeople.slice(0, expandedFor === pubkey ? 12 : 3);
</script>

<section class="identity" aria-label="Profile">
  {#if !allowed}
    <div class="restricted">
      <h1>Profile</h1>
      {#if !muted && !$graphInfo[pubkey] && $graphStatus !== 'unavailable'}
        <p>Checking your social graph…</p>
      {:else}
        <p>Your <a href="/settings">visibility settings</a> hide this profile.</p>
        <div class="actions">
          <button class="outline compact" disabled={followBusy || (!!$account && !$outboxReady)} onclick={onFollow}>{following ? 'Following' : 'Follow'}</button>
          {#if $account && muted}<button class="outline compact" disabled={muteBusy || (!!$account && !$outboxReady)} onclick={onMute}>Unmute</button>{/if}
        </div>
      {/if}
    </div>
  {:else}
  <div class="cover">
    {#if banner}{#key banner}<img use:proxyImage={{url:banner,width:655}} alt="" referrerpolicy="no-referrer"/>{/key}{/if}
  </div>
  <div class="bio">
    <div class="identity-row">
      <div class="avatar"><ProxyAvatar {pubkey} {profile} size={68}/></div>
      <div class="actions">
        {#if mine}<button class="outline compact" onclick={onEdit}>Edit profile</button>
        {:else}
          <button class="primary compact" disabled={followBusy || (!!$account && !$outboxReady)} onclick={onFollow}><Icon name={following ? 'check' : 'plus'} size={14}/>{following ? 'Following' : 'Follow'}</button>
          {#if $account}<button class="outline compact" disabled={muteBusy || (!!$account && !$outboxReady)} onclick={onMute}>{muted ? 'Unmute' : 'Mute'}</button>{/if}
        {/if}
      </div>
    </div>
    <h1><Name {pubkey} {profile} name={displayName(pubkey,profile)}/></h1>
    <div class="identifiers">
      {#if profile?.nip05}<span title="Nostr address listed by this profile">{profile.nip05}</span>{/if}
      <CopyButton class="profile-copy" text={npub} label="Copy public key" ariaLabel="Copy public key" title="Copy public key" promptLabel="Public key"/>
    </div>
    {#if profile?.about}<p class="about">{profile.about}</p>{/if}
    {#if website || profile?.lud16}
      <div class="links">
        {#if website}<a href={website} target="_blank" rel="noopener noreferrer"><Icon name="link" size={14}/>{new URL(website).hostname}</a>{/if}
        {#if profile?.lud16}<span title="Lightning address"><Icon name="zap" size={14}/>{profile.lud16}</span>{/if}
      </div>
    {/if}
    <div class="stats">
      <a class="stat-link" href={profileUrl(pubkey,'following')} aria-label="View following">
        {#if social?.following != null}<strong>{social.following.toLocaleString()}</strong>{/if} Following
      </a>
      <a class="stat-link" href={profileUrl(pubkey,'followers')} aria-label="View followers">
        {#if social?.followers != null}<strong>{social.followers.toLocaleString()}</strong>{/if} Followers
      </a>
      {#if !mine && $account && social?.followsViewer}<span class="badge">Follows you</span>{/if}
      {#if distance != null}<span class="badge"><Icon name="globe" size={13}/>{distance === 0 ? 'Graph center' : distance === 1 ? 'Direct connection' : distance + ' steps away'}</span>{/if}
    </div>
    {#if social && people.length}
      <div class="connections">
        <div class="faces" aria-hidden="true">
          {#each people.slice(0,3) as key (key)}<span><ProxyAvatar pubkey={key} profile={$profiles[key]} size={22}/></span>{/each}
        </div>
        <div>
          <span>Followed by </span>{#each people as key, index (key)}{#if index}, {/if}<a href={profileUrl(key)}><Name pubkey={key} profile={$profiles[key]} name={displayName(key,$profiles[key])}/></a>{/each}
          {#if allowedPeople.length > people.length}
            <button class="more" onclick={() => expandedFor = pubkey}>and {allowedPeople.length - people.length} more</button>
          {/if}
          {#if !$account}<small>From the public social graph</small>{/if}
        </div>
      </div>
    {/if}
  </div>
  {/if}
</section>

<style>
  .restricted {padding:18px 20px;color:var(--muted)}
  .restricted a {color:var(--green);text-decoration:underline}
  .restricted .actions {justify-content:flex-start;margin-top:10px}
  .identity {border:1px solid var(--line);border-radius:13px;background:var(--paper);overflow:hidden}
  .cover {height:78px;background:repeating-linear-gradient(135deg,transparent 0 15px,#ffffff12 15px 16px),linear-gradient(120deg,var(--deep),color-mix(in srgb,var(--deep) 40%,#f5ebc8))}
  .cover img {width:100%;height:100%;object-fit:cover}
  .bio {padding:0 20px 17px}
  .identity-row {display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:-29px;position:relative}
  .avatar {background:var(--paper);border:3px solid var(--paper);border-radius:50%;flex:none;overflow:hidden}
  .actions,.links,.links a,.links span,.identifiers,.stats,.badge,.connections,.faces {display:flex;align-items:center}
  .actions {gap:6px;flex-wrap:wrap;justify-content:flex-end}
  h1 {font:700 29px/1.25 var(--serif);letter-spacing:-.8px;margin:9px 0 2px;display:flex;min-width:0}
  .identifiers,.links,.stats {flex-wrap:wrap;gap:6px 12px;color:var(--muted);font-size:13px;overflow-wrap:anywhere}
  .identifiers :global(.profile-copy) {display:inline-flex;align-items:center;gap:4px;color:var(--green);font-size:12px}
  .about {margin-top:10px;white-space:pre-line;overflow-wrap:anywhere;font-size:14px;line-height:1.55}
  .links,.stats {margin-top:10px}
  .links a,.links span,.badge {gap:4px}
  .links a,.connections a,.more {color:var(--green)}
  .links a:hover,.connections a:hover,.more:hover {text-decoration:underline}
  .stat-link:hover,.stat-link:focus-visible {color:var(--green);text-decoration:underline}
  .stats strong {color:var(--ink)}
  .stats:empty {display:none}
  .badge {font-size:11px;border-radius:4px;background:var(--light);color:var(--green);padding:2px 6px}
  .connections {gap:9px;margin-top:14px;border-top:1px solid var(--line);padding-top:12px;color:var(--muted);font-size:13px}
  .connections :global(.iris-identity-name) {display:inline;white-space:normal;overflow-wrap:anywhere}
  .connections a,.more {font-weight:650}
  .connections a {margin-left:.22em}
  .more {margin-left:3px}
  .connections small {display:block;font-size:11px}
  .faces {flex:none}
  .faces span {border:2px solid var(--paper);border-radius:50%;overflow:hidden;background:var(--light)}
  .faces span + span {margin-left:-8px}
  @media(max-width:520px) {.bio {padding-inline:14px}.cover {height:62px}.actions {gap:4px}}
</style>
