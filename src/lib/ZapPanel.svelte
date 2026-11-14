<script lang="ts">
  import { onMount } from 'svelte'
  import type { NostrEvent } from 'nostr-tools/pure'
  import {
    lightningEndpoint, payWithWallet, requestZap, webWallet,
    type ZapInvoice, type ZapProfile, type ZapSigner,
  } from './zaps'

  import { watchZapPayment } from './network'
  import {
    formatTip, formatTipUnit, loadingTipRates, loadTipRates, satsForAmount, tipCurrency, tipQuote,
    unitRate, type TipCurrency,
  } from './tip-currency'

  let { event, profile, relays, sign }: {
    event: NostrEvent
    profile: ZapProfile
    relays: readonly string[]
    sign?: ZapSigner
  } = $props()

  let useSats = $state(false)
  let draft = $state<{ currency: TipCurrency; amount: number | undefined }>()
  let currency = $derived(useSats ? 'SATS' : $tipCurrency)
  let choices = $derived.by(() => {
    if (currency === 'SATS') return [21, 100, 500, 1000]
    if (currency === 'BTC') return [0.00000021, 0.000001, 0.000005, 0.00001]
    if (currency === 'JPY' || currency === 'INR') return [10, 50, 100, 500]
    if (['SEK', 'NOK', 'DKK', 'CNY'].includes(currency)) return [1, 5, 10, 50]
    return [0.10, 0.50, 1, 5]
  })
  let amount = $derived(draft?.currency === currency ? draft.amount : choices[0])
  let step = $derived(currency === 'SATS' || currency === 'JPY' ? 1 : currency === 'BTC' ? 0.00000001 : 0.01)
  let rate = $derived(unitRate(currency, $tipQuote))
  let sats = $derived(satsForAmount(amount, rate))

  $effect(() => {
    if (!unitRate(currency, $tipQuote) && lightningEndpoint(profile)) void loadTipRates(currency)
  })
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
    // A replacement invoice must request the same sat amount as the original.
    const paymentSats = zap?.sats ?? satsForAmount(amount, unitRate(currency, $tipQuote))
    if (!paymentSats) {
      error = 'Check the amount and exchange rate before requesting an invoice.'
      void loadTipRates(currency)
      return
    }
    busy = true
    error = ''
    try {
      zap = await requestZap({ event, profile, relays, sign, sats: paymentSats, comment })
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
      if (!paidByWallet) error = 'Check your wallet for the payment result. We’re waiting for the payment receipt.'
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
  <h2>Tip this post</h2>
  {#if confirmed}
    <div class="success" role="status"><strong>Tip confirmed</strong><p>{formatTip(zap!.sats, currency, $tipQuote, true)} to the author.</p></div>
  {:else if !lightningEndpoint(profile)}
    <p>{profile ? 'This author hasn’t added a Lightning address to their profile.' : 'A Lightning address isn’t available for this author yet.'}</p>
  {:else if zap}
    <p>Pay <strong>{formatTip(zap.sats, currency, $tipQuote, true)}</strong> to the author in your Lightning wallet.</p>
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
    <p>Tip the author{sign ? '.' : ' using a one-time guest identity.'}</p>
    <form onsubmit={(event) => { event.preventDefault(); void prepare() }}>
      <label for="zap-amount">Amount in {currency === 'SATS' ? 'sats' : currency}</label>
      <div class="choices">{#each choices as choice}
        <button type="button" class:selected={amount === choice} aria-pressed={amount === choice}
          onclick={() => { draft = { currency, amount: choice } }}>{formatTipUnit(choice, currency)}</button>
      {/each}</div>
      <input id="zap-amount" value={amount ?? ''} type="number" min={step} {step} required
        oninput={event => { draft = { currency, amount: event.currentTarget.value ? event.currentTarget.valueAsNumber : undefined } }} />
      {#if !rate}
        <small role="status">{$loadingTipRates ? 'Getting the exchange rate…' : 'Exchange rate unavailable.'}
          <button class="switch-unit" type="button" onclick={() => { useSats = true }}>Enter sats instead</button>
        </small>
      {:else if currency !== 'SATS' && sats}
        <small>{formatTipUnit(sats, 'SATS')} via Lightning</small>
      {/if}
      <label for="zap-comment">Public message <small>(optional)</small></label>
      <input id="zap-comment" bind:value={comment} maxlength="240" placeholder="Nice post!" />
      <button class="primary" type="submit" disabled={busy || !sats}>{busy ? 'Requesting invoice…' : 'Get Lightning invoice'}</button>
    </form>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .zap-panel {display:grid;gap:14px;color:inherit}
  .bolt {display:grid;place-items:center;width:44px;height:44px;border-radius:15px;background:var(--gold-bg);color:var(--gold)}
  h2,p,form {margin:0}
  h2 {font-family:var(--serif, Georgia, serif);font-size:1.6rem;letter-spacing:-.035em;line-height:1.15}
  p,small {line-height:1.5}
  p,small,details {font-size:.92rem}
  form {display:grid;gap:10px}
  label {font-weight:650;font-size:.85rem}
  label small {font-weight:400}
  .qr {width:min(220px,100%);height:auto;justify-self:center;border-radius:10px}
  .choices,.actions {display:flex;gap:7px;flex-wrap:wrap}
  button,a,input {border:1px solid var(--line);border-radius:9px;background:transparent;color:inherit;font:inherit}
  button,a {padding:9px 14px;font-size:.9rem;font-weight:650;cursor:pointer;text-align:center;text-decoration:none}
  .choices button {flex:1;padding:7px 6px}
  .switch-unit {padding:0;border:0;color:var(--accent);text-decoration:underline}
  .selected {border-color:var(--gold);color:var(--gold);background:var(--gold-bg)}
  input {width:100%;box-sizing:border-box;padding:10px 12px}
  .primary {background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
  button:disabled {opacity:.6;cursor:wait}
  summary {cursor:pointer}
  code {display:block;overflow-wrap:anywhere;max-height:8rem;overflow:auto;font-size:.76rem;margin-top:6px}
  small {opacity:.8}
  .success,.error {padding:12px;border-radius:9px}
  .success {background:light-dark(#e0f5e7, #213a2a);color:light-dark(#205e35, #a2d5b1)}
  .error {background:var(--error-bg);color:var(--error)}
</style>
