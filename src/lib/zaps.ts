import { bech32, hex, utils } from '@scure/base'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, generateSecretKey, verifyEvent, type EventTemplate, type NostrEvent } from 'nostr-tools/pure'
import { makeZapRequest } from 'nostr-tools/nip57'

export type ZapProfile = { lud16?: string; lud06?: string } | undefined | null
export type ZapSigner = (event: EventTemplate) => Promise<NostrEvent>
export type ZapInvoice = {
  invoice: string
  request: NostrEvent
  description: string
  provider: string
  sats: number
  paymentHash: string
  expiresAt: number
}
type Wallet = {
  enable(): Promise<unknown>
  sendPayment(invoice: string): Promise<{ preimage?: string } | undefined>
}

const utf8 = new TextEncoder()
const hash = (bytes: Uint8Array) => hex.encode(sha256(bytes))
const unix = () => Math.floor(Date.now() / 1000)

function publicHttps(value: string): URL {
  const url = new URL(value)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      !host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) ||
      /\.(local|localhost|internal)$/.test(host)) {
    throw new Error('Lightning addresses must use a public HTTPS endpoint.')
  }
  return url
}

export function lightningEndpoint(profile: ZapProfile): string | null {
  const address = profile?.lud16?.trim().replace(/^lightning:/i, '')
  if (address && /^[^@\s/?#\\]+@[^@\s/?#\\]+$/.test(address)) {
    const [user, host] = address.split('@')
    try { return publicHttps('https://' + host + '/.well-known/lnurlp/' + encodeURIComponent(user)).href } catch { /* Try lud06. */ }
  }
  if (profile?.lud06) {
    try {
      const encoded = bech32.decodeUnsafe(profile.lud06.trim().replace(/^lightning:/i, ''), 4096)
      if (encoded && encoded.prefix === 'lnurl') {
        return publicHttps(new TextDecoder().decode(bech32.fromWords(encoded.words))).href
      }
    } catch { /* No usable address. */ }
  }
  return null
}

async function walletJson(url: string) {
  const response = await fetch(url, {
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' },
  })
  if (!response.ok || !response.body) throw new Error('The Lightning provider could not handle this request.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let body = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 65_536) {
        await reader.cancel()
        throw new Error('The Lightning provider response is too large.')
      }
      body += decoder.decode(value, { stream: true })
    }
  } finally { reader.releaseLock() }
  const data = JSON.parse(body + decoder.decode())
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Lightning provider response.')
  if (data.status === 'ERROR') throw new Error(String(data.reason || 'The Lightning provider rejected this request.').slice(0, 200))
  return data as Record<string, unknown>
}

type Provider = { provider: string; min: number; max: number; callback: string }
const providers = new Map<string, { value: Promise<Provider>; until: number }>()

async function readProvider(endpoint: string): Promise<Provider> {
  const hit = providers.get(endpoint)
  if (hit && hit.until > Date.now()) return hit.value
  const value = (async () => {
    const metadata = await walletJson(endpoint)
    if (metadata.tag !== 'payRequest' || metadata.allowsNostr !== true || typeof metadata.callback !== 'string') {
      throw new Error('This Lightning address does not support Nostr zaps.')
    }
    const provider = metadata.nostrPubkey
    if (typeof provider !== 'string' || !/^[a-f0-9]{64}$/.test(provider)) throw new Error('This provider has no valid zap signing key.')
    try { schnorr.utils.lift_x(BigInt('0x' + provider)) } catch { throw new Error('This provider has no valid zap signing key.') }
    const min = Number(metadata.minSendable)
    const max = Number(metadata.maxSendable)
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) throw new Error('The provider has invalid payment limits.')
    return { provider, min, max, callback: publicHttps(new URL(metadata.callback, endpoint).href).href }
  })()
  const entry = { value, until: Date.now() + 300_000 }
  providers.set(endpoint, entry)
  if (providers.size > 256) providers.delete(providers.keys().next().value!)
  try { return await value }
  catch (error) {
    entry.until = Date.now() + 5000
    throw error
  }
}

const units: Record<string, bigint> = { '': 1_000_000_000_000n, m: 1_000_000_000n, u: 1_000_000n, n: 1_000n, p: 1n }
const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const integer = (words: number[]) => words.reduce((sum, word) => sum * 32 + word, 0)

export function inspectZapInvoice(invoice: string, millisats: number | undefined, description: string, requireUnexpired = true) {
  const decoded = bech32.decodeUnsafe(invoice, 20_000)
  const amount = decoded?.prefix.match(/^ln(?:bc|tb|bcrt|tbs)([1-9]\d{0,17})([munp]?)$/)
  if (!decoded || !amount) throw new Error('The Lightning provider returned an invalid invoice.')
  const picoBtc = BigInt(amount[1]) * units[amount[2]]
  if (picoBtc % 10n || picoBtc / 10n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The invoice has an invalid amount.')
  const invoiceMillisats = Number(picoBtc / 10n)
  if (millisats !== undefined && millisats !== invoiceMillisats) {
    throw new Error('The invoice amount does not match your zap.')
  }
  const payload = decoded.words.slice(0, -104)
  if (payload.length < 7) throw new Error('The invoice is missing its payment details.')
  const fields = new Map<string, number[]>()
  for (let i = 7; i < payload.length;) {
    const tag = alphabet[payload[i]]
    const length = payload[i + 1] * 32 + payload[i + 2]
    i += 3
    if (!Number.isInteger(length) || i + length > payload.length) throw new Error('The invoice contains an invalid field.')
    if ('phdsnx'.includes(tag)) {
      if (fields.has(tag)) throw new Error('The invoice contains conflicting payment details.')
      fields.set(tag, payload.slice(i, i + length))
    }
    i += length
  }
  const fieldBytes = (tag: string) => bech32.fromWords(fields.get(tag) ?? [])
  if (fields.has('d') || fieldBytes('h').length !== 32 || hex.encode(fieldBytes('h')) !== hash(utf8.encode(description))) {
    throw new Error('The invoice is not bound to this zap request.')
  }
  if (fieldBytes('p').length !== 32 || fieldBytes('s').length !== 32) throw new Error('The invoice is missing payment details.')
  const signature = bech32.fromWords(decoded.words.slice(-104))
  const message = Uint8Array.from([...utf8.encode(decoded.prefix), ...utils.convertRadix2(payload, 5, 8, true)])
  const recovered = Uint8Array.from([signature[64], ...signature.slice(0, 64)])
  if (signature[64] > 3) throw new Error('The invoice signature is invalid.')
  if (fields.has('n')) {
    if (fieldBytes('n').length !== 33 || !secp256k1.verify(signature.slice(0, 64), message, fieldBytes('n'))) {
      throw new Error('The invoice signature is invalid.')
    }
  } else {
    secp256k1.recoverPublicKey(recovered, message)
  }
  const expiry = fields.has('x') ? integer(fields.get('x')!) : 3600
  const expiresAt = integer(payload.slice(0, 7)) + expiry
  if (!Number.isSafeInteger(expiresAt) || requireUnexpired && expiresAt <= unix()) throw new Error('The invoice has expired. Request a new one.')
  return { paymentHash: hex.encode(fieldBytes('p')), expiresAt, millisats: invoiceMillisats }
}

export async function requestZap(options: {
  event: NostrEvent; profile: ZapProfile; relays: readonly string[]; sign?: ZapSigner; sats: number; comment?: string
}): Promise<ZapInvoice> {
  const { event, profile, relays, sign, sats, comment = '' } = options
  const amount = sats * 1000
  if (!Number.isSafeInteger(sats) || sats <= 0 || !Number.isSafeInteger(amount)) throw new Error('Enter a positive, whole number of sats.')
  const endpoint = lightningEndpoint(profile)
  if (!endpoint) throw new Error('This author has no Lightning address on their profile.')
  const metadata = await readProvider(endpoint)
  const { provider, min, max, callback } = metadata
  if (amount < min || amount > max) throw new Error('This address accepts ' + Math.ceil(min / 1000) + ' to ' + Math.floor(max / 1000) + ' sats.')
  const url = new URL(callback)
  const lnurl = bech32.encode('lnurl', bech32.toWords(utf8.encode(endpoint)), 4096)
  const template = makeZapRequest({ event, amount, comment, relays: [...relays] })
  template.tags.push(['lnurl', lnurl])
  const expected = JSON.stringify(template.tags)
  const request = sign ? await sign(template) : finalizeEvent(template, generateSecretKey())
  if (!verifyEvent(JSON.parse(JSON.stringify(request))) || request.kind !== 9734 || request.content !== comment || JSON.stringify(request.tags) !== expected) {
    throw new Error('The signer returned an invalid zap request.')
  }
  const description = JSON.stringify(request)
  url.searchParams.set('amount', String(amount))
  url.searchParams.set('lnurl', lnurl)
  url.searchParams.set('nostr', description)
  const response = await walletJson(url.href)
  if (typeof response.pr !== 'string') throw new Error('The provider did not return a Lightning invoice.')
  const invoice = response.pr.trim()
  return { invoice, description, sats, provider, request, ...inspectZapInvoice(invoice, amount, description) }
}

export function webWallet(): Wallet | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { webln?: Wallet }).webln
}

function matchesPreimage(value: unknown, paymentHash: string) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) && hash(hex.decode(value.toLowerCase())) === paymentHash
}

export async function payWithWallet(zap: ZapInvoice, wallet: Wallet) {
  if (zap.expiresAt <= unix()) throw new Error('This invoice has expired. Request a new one.')
  await wallet.enable()
  const result = await wallet.sendPayment(zap.invoice)
  return matchesPreimage(result?.preimage, zap.paymentHash)
}

// A receipt is emitted by a Lightning provider. Attribute it only to a signed
// zap request whose recipient and post exactly match the receipt. Payment and
// provider authorization are still independently verified at presentation time.
export function signedZapAuthor(receipt: NostrEvent): string | null {
  if (receipt.kind !== 9735) return null;
  const tag = (event: NostrEvent, key: string) => {
    const tags = event.tags.filter(t => t[0] === key);
    return tags.length === 1 ? tags[0][1] : undefined;
  };
  try {
    const description = tag(receipt,'description');
    const invoice = tag(receipt,'bolt11');
    if (!description || description.length > 32000 || !invoice || invoice.length > 20000) return null;
    const request: NostrEvent = JSON.parse(description);
    if (request.kind !== 9734 || !verifyEvent(request)) return null;
    for (const key of ['p','e']) {
      const id = tag(receipt,key);
      if (!id || !/^[a-f0-9]{64}$/.test(id) || tag(request,key) !== id) return null;
    }
    if (receipt.tags.some(t => t[0] === 'P') && tag(receipt,'P') !== request.pubkey) return null;
    return verifyEvent(JSON.parse(JSON.stringify(receipt))) ? request.pubkey : null;
  } catch { return null; }
}

export function matchesZapReceipt(event: NostrEvent, zap: ZapInvoice) {
  const tag = (key: string) => {
    const tags = event.tags.filter(([name]) => name === key)
    return tags.length === 1 ? tags[0][1] : undefined
  }
  if (event.kind !== 9735 || event.pubkey !== zap.provider || !verifyEvent(JSON.parse(JSON.stringify(event)))) return false
  const target = (name: string) => zap.request.tags.find(([key]) => key === name)?.[1]
  return tag('e') === target('e') && tag('p') === target('p') && tag('a') === target('a') &&
    (!event.tags.some(([key]) => key === 'P') || tag('P') === zap.request.pubkey) &&
    tag('description') === zap.description && tag('bolt11')?.toLowerCase() === zap.invoice.toLowerCase() &&
    (!event.tags.some(([key]) => key === 'preimage') || matchesPreimage(tag('preimage'), zap.paymentHash))
}


type PaidInvoice = { paymentHash: string; millisats: number }
const checked = new WeakMap<NostrEvent, { key: string; payment: PaidInvoice | null }>()

function receiptPayment(event: NostrEvent, target: NostrEvent, provider: string, endpoint: string): PaidInvoice | null {
  const description = event.tags.find(([name]) => name === 'description')?.[1]
  const invoice = event.tags.find(([name]) => name === 'bolt11')?.[1]
  if (!description || !invoice || invoice.length > 20_000 || description.length > 32_000) return null
  const request: NostrEvent = JSON.parse(description)
  if (request.kind !== 9734 || !verifyEvent(request)) return null
  const tags = (key: string) => request.tags.filter(([name]) => name === key)
  if (tags('p').length !== 1 || tags('p')[0][1] !== target.pubkey || tags('e').length !== 1 || tags('e')[0][1] !== target.id) return null
  if (tags('relays').length !== 1 || tags('relays')[0].length < 2) return null
  if (tags('P').length && (tags('P').length !== 1 || tags('P')[0][1] !== provider)) return null
  const lnurl = tags('lnurl')
  if (lnurl.length) {
    if (lnurl.length !== 1) return null
    const address = lnurl[0][1]
    if (address !== endpoint && lightningEndpoint({ lud16: address, lud06: address }) !== endpoint) return null
  }
  const amount = tags('amount')
  if (amount.length > 1 || amount.length && !/^[1-9]\d{0,15}$/.test(amount[0][1])) return null
  const details = inspectZapInvoice(invoice, amount.length ? Number(amount[0][1]) : undefined, description, false)
  const zap = { ...details, description, invoice, request, provider, sats: details.millisats / 1000 }
  return matchesZapReceipt(event, zap) ? details : null
}

// Resolve the authorized signer once per endpoint and verify each immutable event once per target.
export async function receivedZapSats(target: NostrEvent, profile: ZapProfile, receipts: readonly NostrEvent[]) {
  const endpoint = lightningEndpoint(profile)
  if (!endpoint || !receipts.length) return 0
  const { provider } = await readProvider(endpoint)
  const key = target.id + ':' + provider + ':' + endpoint
  const payments = new Map<string, number>()
  for (const event of receipts) {
    if (event.kind !== 9735 || event.pubkey !== provider) continue
    let record = checked.get(event)
    if (record?.key !== key) {
      let payment: PaidInvoice | null = null
      try { payment = receiptPayment(event, target, provider, endpoint) } catch { /* Ignore malformed relay events. */ }
      record = { key, payment }
      checked.set(event, record)
    }
    if (record.payment) payments.set(record.payment.paymentHash, record.payment.millisats)
  }
  return Math.floor([...payments.values()].reduce((sum, value) => sum + value, 0) / 1000)
}
