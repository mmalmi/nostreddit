<script lang="ts">
  import { onMount } from 'svelte'
  import type { NostrEvent } from 'nostr-tools/pure'
  import { postTipSummary, type ZapProfile } from './zaps'
  import TipAmount from '../components/TipAmount.svelte'
  let { event, profile, receipts }: { event: NostrEvent; profile: ZapProfile; receipts: readonly NostrEvent[] } = $props()
  let sats = $state(0)
  let element: HTMLSpanElement
  let visible = $state(false)
  onMount(() => {
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    observer.observe(element)
    return () => observer.disconnect()
  })
  $effect(() => {
    let active = true
    sats = 0
    if (visible && receipts.length) {
      void postTipSummary(event, profile, receipts).then(result => { if (active) sats = result.totalMillisats / 1000 })
    }
    return () => { active = false }
  })
</script>
<span bind:this={element}>{#if sats > 0}<TipAmount {sats} active={visible}/>{:else}Tip{/if}</span>
