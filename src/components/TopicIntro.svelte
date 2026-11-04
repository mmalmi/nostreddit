<script lang="ts">
  let { title }: { title:string } = $props();
</script>

<section class="rail-panel about">
  <div class="rail-eyebrow">TOPIC FEED</div>
  <h1>{title}</h1>
</section>

<style>
  h1 {margin:.5rem 0 .25rem;font:700 1.5rem/1.15 var(--serif);letter-spacing:-.04em;overflow-wrap:anywhere}
</style>
