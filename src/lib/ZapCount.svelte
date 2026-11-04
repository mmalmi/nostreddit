<script lang="ts">
  import { onMount } from 'svelte'
  import type { NostrEvent } from 'nostr-tools/pure'
  import { receivedZapSats, type ZapProfile } from './zaps'
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
      void receivedZapSats(event, profile, receipts).then(amount => { if (active) sats = amount }).catch(() => {})
    }
    return () => { active = false }
  })
</script>
<span bind:this={element}>{sats > 0 ? sats.toLocaleString() + ' sats' : 'Zap'}</span>
