<script lang="ts">
  import Icon from './Icon.svelte';
  let { title, joined, onjoin }: { title:string; joined:boolean; onjoin:()=>void } = $props();
</script>

<section class="rail-panel about">
  <div class="rail-eyebrow">COMMUNITY FEED</div>
  <h1>{title}</h1>
  <button class="outline compact" aria-pressed={joined} onclick={onjoin}>
    <Icon name={joined ? 'check' : 'plus'} size={14}/>{joined ? 'Joined' : 'Join community'}
  </button>
</section>

<style>
  h1 {margin:.5rem 0 .25rem;font:700 1.5rem/1.15 var(--serif);letter-spacing:-.04em;overflow-wrap:anywhere}
  button {margin-top:.75rem}
</style>
