<script lang="ts">
  import Icon from './Icon.svelte';
  import { topicInfo } from '../lib/ui';
  export let slug: string;
  export let small = false;
  $: info = topicInfo(slug);
</script>

<span class={'topic-icon ' + info.color} class:small
  ><Icon name={info.icon} size={small ? 13 : 17} /></span
>
