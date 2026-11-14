<script lang="ts">
  import { onMount } from 'svelte';
  import { formatTip, formatTipUnit, loadTipRates, tipCurrency, tipQuote, unitRate } from '../lib/tip-currency';

  let { sats, active = true }: { sats: number; active?: boolean } = $props();
  let element: HTMLSpanElement;
  let visible = $state(false);
  onMount(() => {
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(element);
    return () => observer.disconnect();
  });
  $effect(() => {
    if (active && visible && !unitRate($tipCurrency, $tipQuote)) void loadTipRates($tipCurrency);
  });
</script>

<span bind:this={element} title={formatTipUnit(sats, 'SATS')}>{formatTip(sats, $tipCurrency, $tipQuote)}</span>
