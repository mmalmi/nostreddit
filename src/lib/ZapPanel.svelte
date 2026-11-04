<script lang="ts">
  import { onMount } from 'svelte'
  import type { NostrEvent } from 'nostr-tools/pure'
  import {
    lightningEndpoint, payWithWallet, requestZap, webWallet,
    type ZapInvoice, type ZapProfile, type ZapSigner,
  } from './zaps'

  import { watchZapPayment } from './network'

  let { event, profile, relays, sign }: {
    event: NostrEvent
    profile: ZapProfile
    relays: readonly string[]
    sign?: ZapSigner
  } = $props()

  let sats = $state<number | undefined>(21)
  let comment = $state('')
  let zap = $state<ZapInvoice>()
  let busy = $state(false)
  let attempted = $state(false)
  let paidByWallet = $state(false)
  let copied = $state(false)
  let error = $state('')
  let qr = $state('')
  let now = $state(Math.floor(Date.now() / 1000))
  let expired = $derived(!!zap && zap.expiresAt <= now)
  let paidByReceipt = $state(false)
  let confirmed = $derived(!!zap && (paidByWallet || paidByReceipt))
  $effect(() => {
    paidByReceipt = false
    if (zap) return watchZapPayment(event.id, zap, received => { paidByReceipt = received })
  })

  $effect(() => {
    const invoice = zap?.invoice
    let active = true
    qr = ''
    if (invoice) {
      void import('qrcode').then(({ default: code }) =>
        code.toDataURL('LIGHTNING:' + invoice.toUpperCase(), { width: 280, errorCorrectionLevel: 'L' })
      ).then(url => { if (active) qr = url }).catch(() => { /* The invoice link remains available. */ })
    }
    return () => { active = false }
  })

  onMount(() => {
    const timer = setInterval(() => { now = Math.floor(Date.now() / 1000) }, 1000)
    return () => clearInterval(timer)
  })

  async function prepare() {
    if (busy) return
    busy = true
    error = ''
    try {
      zap = await requestZap({ event, profile, relays, sign, sats: Number(sats), comment })
      attempted = false
      copied = false
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Unable to request an invoice.' }
    finally { busy = false }
  }

  async function pay() {
    const wallet = webWallet()
    if (!zap || !wallet || busy || attempted || expired) return
    busy = true
    attempted = true
    error = ''
    try {
      paidByWallet = await payWithWallet(zap, wallet)
      if (!paidByWallet) error = 'Check your wallet for the payment result. We’re waiting for the zap receipt.'
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Check the payment status in your wallet.' }
    finally { busy = false }
  }

  async function copyInvoice() {
    if (!zap) return
    try { await navigator.clipboard.writeText(zap.invoice); copied = true }
    catch { error = 'Select the invoice below to copy it manually.' }
  }
</script>

<section class="zap-panel">
  <span class="bolt" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="25" height="25"><path d="M13.8 1.7 3.4 13.8h6.9l-1.1 8.5L20.6 9.5h-7.3z" fill="currentColor"/></svg>
  </span>
  <h2>Zap this post</h2>
  {#if confirmed}
    <div class="success" role="status"><strong>Zap confirmed</strong><p>{zap?.sats} sats to the author. Thanks for supporting their work.</p></div>
  {:else if !lightningEndpoint(profile)}
    <p>{profile ? 'This author hasn’t added a Lightning address to their profile.' : 'A Lightning address isn’t available for this author yet.'}</p>
  {:else if zap}
    <p>Pay <strong>{zap.sats} sats</strong> to the author in your Lightning wallet.</p>
    {#if expired}
      <p role="status">This invoice has expired.</p>
      <button class="primary" onclick={prepare} disabled={busy}>{busy ? 'Requesting…' : 'Get a fresh invoice'}</button>
    {:else}
      {#if qr}<img class="qr" width="220" height="220" src={qr} alt="Scan this invoice with a Lightning wallet" />{/if}
      <div class="actions">
        {#if webWallet() && !attempted}
          <button class="primary" onclick={pay} disabled={busy}>Pay with browser wallet</button>
        {/if}
        <a class:primary={!webWallet() || attempted} href={'lightning:' + zap.invoice}>Open Lightning wallet</a>
        <button onclick={copyInvoice}>{copied ? 'Copied!' : 'Copy invoice'}</button>
      </div>
      <details><summary>View invoice</summary><code>{zap.invoice}</code></details>
      <small role="status">Waiting for a payment confirmation…</small>
    {/if}
  {:else}
    <p>Send sats directly to the author{sign ? '.' : ' using a one-time guest identity.'}</p>
    <form onsubmit={(event) => { event.preventDefault(); void prepare() }}>
      <label for="zap-amount">Amount in sats</label>
      <div class="choices">{#each [21, 100, 500, 1000] as choice}
        <button type="button" class:selected={sats === choice} aria-pressed={sats === choice} onclick={() => { sats = choice }}>{choice}</button>
      {/each}</div>
      <input id="zap-amount" bind:value={sats} type="number" min="1" max="2100000000000" step="1" required />
      <label for="zap-comment">Public message <small>(optional)</small></label>
      <input id="zap-comment" bind:value={comment} maxlength="240" placeholder="Nice post!" />
      <button class="primary" type="submit" disabled={busy}>{busy ? 'Requesting invoice…' : 'Get Lightning invoice'}</button>
    </form>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .zap-panel {display:grid;gap:14px;color:inherit}
  .bolt {display:grid;place-items:center;width:44px;height:44px;border-radius:15px;background:#fff1c8;color:#ad6b05}
  h2,p,form {margin:0}
  h2 {font-family:var(--serif, Georgia, serif);font-size:1.6rem;letter-spacing:-.035em;line-height:1.15}
  p,small {line-height:1.5}
  p,small,details {font-size:.92rem}
  form {display:grid;gap:10px}
  label {font-weight:650;font-size:.85rem}
  label small {font-weight:400}
  .qr {width:min(220px,100%);height:auto;justify-self:center;border-radius:10px}
  .choices,.actions {display:flex;gap:7px;flex-wrap:wrap}
  button,a,input {border:1px solid var(--line, #ced4c8);border-radius:9px;background:transparent;color:inherit;font:inherit}
  button,a {padding:9px 14px;font-size:.9rem;font-weight:650;cursor:pointer;text-align:center;text-decoration:none}
  .choices button {flex:1;padding:7px 6px}
  .selected {border-color:#a85b07;color:#9d5511;background:#fff3db}
  input {width:100%;box-sizing:border-box;padding:10px 12px}
  .primary {background:var(--green, #214f3c);color:#fff;border-color:var(--green, #214f3c)}
  button:disabled {opacity:.6;cursor:wait}
  summary {cursor:pointer}
  code {display:block;overflow-wrap:anywhere;max-height:8rem;overflow:auto;font-size:.76rem;margin-top:6px}
  small {opacity:.8}
  .success,.error {padding:12px;border-radius:9px}
  .success {background:#e0f5e7;color:#205e35}
  .error {background:#ffebe6;color:#872e20}
</style>
