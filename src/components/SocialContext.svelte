<script lang="ts">
  import { account } from '../lib/network';
  import { graphInfo, graphDiscoveryRoot, graphStatus } from '../lib/graph';
  import SocialBadge from './SocialBadge.svelte';
  export let pubkey:string;
  $: badge=$graphInfo[pubkey];
  $: publicGraph=!$account || $graphDiscoveryRoot!==$account.pubkey;
  $: mine=pubkey===$account?.pubkey;
  $: distance=badge?.distance;
  $: people=badge?.followedByFriends===1?'person':'people';
  $: explanation=mine?'This is your profile.':distance===1?(publicGraph?'A direct connection in the public social graph.':'You follow this profile.')
    :distance===2?`Followed by ${badge?.followedByFriends ?? 0} ${people} ${publicGraph?'in the public graph':'you follow'}.`
    :distance===0?'Center of the public social graph.':distance!=null?`${distance} follow steps away${publicGraph?' in the public graph':''}.`
    :$graphStatus==='loading'?'Checking connections…':'No known follow path in this graph.';
</script>
<details class="social-context">
  <summary><SocialBadge {pubkey}/><span>{explanation}</span></summary>
  <p>{publicGraph?'Discovery uses the public social graph until you follow people.':'Distance is the shortest chain of follows from your profile.'}</p>
  <ul>
    <li><span class="dot blue">✓</span> Blue: {publicGraph?'a direct connection in the public graph.':'you or a direct follow.'}</li>
    <li><span class="dot gray">✓</span> Gray: {publicGraph?'two steps from the public graph’s center.':'followed by someone you follow.'}</li>
    <li><span class="dot gold">✓</span> Gold: followed by more than 10 {publicGraph?'direct connections in that graph.':'people you follow.'}</li>
  </ul>
  <p>These show connections, not identity verification or an endorsement. <a href="/settings">Graph settings</a></p>
</details>
<style>
  .social-context{margin-top:12px;color:var(--muted);font-size:12px;line-height:1.6}
  summary{cursor:pointer;display:flex;align-items:center;gap:6px;list-style:none}summary::-webkit-details-marker{display:none}
  summary::after{content:'ⓘ';font-size:13px;margin-left:3px}p{margin:8px 0}ul{list-style:none;padding:0;margin:7px 0}
  li{display:flex;align-items:center;gap:7px}.dot{display:inline-grid;place-items:center;color:white;width:14px;height:14px;border-radius:50%;font-size:11px}
  .blue{background:#0a84ff}.gray{background:#8e8e93}.gold{background:#d4a017}a{color:var(--accent);text-decoration:underline}
</style>
