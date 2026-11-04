<script lang="ts">
  import Badge from '@iris/svelte-ui/SocialDistanceBadge.svelte';
  import { account } from '../lib/network';
  import { graphInfo, graphDiscoveryRoot } from '../lib/graph';
  export let pubkey:string;
  export let size=14;
  $: badge=$graphInfo[pubkey];
  $: publicGraph=!$account || $graphDiscoveryRoot!==$account.pubkey;
  $: mine=pubkey===$account?.pubkey;
  $: people=badge?.followedByFriends===1?'person':'people';
  $: label=mine?'You':badge?.muted?'Muted':badge?.overmuted&&badge.distance!==1?'More mutes than follows in '+(publicGraph?'the public graph':'your network')
    :badge?.distance===1?(publicGraph?'Direct connection in the public graph':'Following')
    :badge?.distance===2?`Followed by ${badge.followedByFriends ?? 0} ${people} ${publicGraph?'in the public graph':'you follow'}`:'';
</script>
{#if badge && (mine || badge.distance!==0)}
  <Badge distance={mine?0:badge.distance} followedByFriends={badge.followedByFriends} muted={badge.muted} overmuted={badge.overmuted} {size} title={label}/>
{/if}
