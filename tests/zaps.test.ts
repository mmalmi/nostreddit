import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { bech32, hex } from '@scure/base'
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { inspectZapInvoice, lightningEndpoint, matchesZapReceipt, payWithWallet, receivedZapSats, requestZap } from '../src/lib/zaps'

import { providerKey, authorKey, signerKey, target, preimage, encoder, recipient, params, metadata, bolt11 } from './helpers/zapInvoice'

test('LUD-16 and LUD-06 addresses resolve only to public HTTPS endpoints', () => {
  const url = 'https://wallet.example/pay'
  assert.equal(lightningEndpoint({ lud06: bech32.encode('lnurl', bech32.toWords(encoder.encode(url)), false) }), url)
  assert.equal(lightningEndpoint(recipient), 'https://lightning.example/.well-known/lnurlp/author')
  for (const lud16 of ['person@127.0.0.1', 'person@localhost', 'a@b@example.com', 'name@localhost:80']) {
    assert.equal(lightningEndpoint({ lud16 }), null)
  }
})

test('signed and guest requests produce bound invoices and only matching payment proofs or authorized receipts confirm them', async () => {
  const fetcher = mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input)
    if (url.hostname === 'lightning.example') return Response.json(metadata)
    assert.equal(url.origin, 'https://pay.example')
    const request = JSON.parse(url.searchParams.get('nostr')!)
    assert.ok(verifyEvent(request))
    assert.equal(url.searchParams.get('amount'), '21000')
    assert.equal(request.tags.find(([name]: string[]) => name === 'e')?.[1], target.id)
    assert.equal(request.tags.find(([name]: string[]) => name === 'p')?.[1], target.pubkey)
    assert.equal(request.tags.find(([name]: string[]) => name === 'lnurl')?.[1], url.searchParams.get('lnurl'))
    return Response.json({ pr: bolt11(url.searchParams.get('nostr')!) })
  })
  try {
    const guest = await requestZap(params)
    assert.notEqual(guest.request.pubkey, target.pubkey)
    const signed = await requestZap({ ...params, sign: async event => finalizeEvent(event, signerKey) })
    assert.equal(signed.request.pubkey, getPublicKey(signerKey))
    const wallet = { enable: async () => {}, sendPayment: async () => ({ preimage: hex.encode(preimage) }) }
    assert.equal(await payWithWallet(signed, wallet), true)
    assert.equal(await payWithWallet(signed, { ...wallet, sendPayment: async () => undefined }), false)
    assert.equal(await payWithWallet(signed, { ...wallet, sendPayment: async () => ({ preimage: 'a'.repeat(64) }) }), false)
    const receipt = {
      kind: 9735, created_at: Math.floor(Date.now() / 1000), content: '',
      tags: [['p', target.pubkey], ['e', target.id], ['P', signed.request.pubkey], ['description', signed.description], ['bolt11', signed.invoice]],
    }
    const confirmedReceipt = finalizeEvent(receipt, providerKey)
    assert.ok(matchesZapReceipt(confirmedReceipt, signed))
    assert.equal(await receivedZapSats(target, recipient, [
      confirmedReceipt,
      finalizeEvent({ ...receipt, created_at: receipt.created_at + 1 }, providerKey),
      finalizeEvent(receipt, authorKey),
    ]), 21)
    assert.equal(matchesZapReceipt(finalizeEvent(receipt, authorKey), signed), false)
    assert.equal(matchesZapReceipt(finalizeEvent(receipt, providerKey), guest), false)
    assert.equal(matchesZapReceipt(finalizeEvent({ ...receipt, tags: [...receipt.tags, ['preimage', '0'.repeat(64)]] }, providerKey), signed), false)
  } finally { fetcher.mock.restore() }
})

test('rejects changed amount, request commitment, signature, checksum and expired invoice', () => {
  const invoice = bolt11('request')
  assert.throws(() => inspectZapInvoice(invoice, 22000, 'request'), /amount/)
  assert.throws(() => inspectZapInvoice(invoice, 21000, 'different'), /bound/)
  assert.throws(() => inspectZapInvoice(bolt11('request', { invalidSig: true }), 21000, 'request'), /signature/)
  assert.throws(() => inspectZapInvoice(invoice.slice(0, -1), 21000, 'request'), /invalid invoice/)
  assert.throws(() => inspectZapInvoice(bolt11('request', { expired: true }), 21000, 'request'), /expired/)
})

test('bad provider settings and mismatching signer are rejected before invoicing', async () => {
  let counter = 0
  for (const patch of [{ allowsNostr: false }, { callback: 'http://127.0.0.1' }, { minSendable: 22000 }, { nostrPubkey: 'ff'.repeat(32) }, {}]) {
    const fetcher = mock.method(globalThis, 'fetch', async () => Response.json({ ...metadata, ...patch }))
    try {
      await assert.rejects(requestZap({ ...params, profile: { lud16: 'case' + (++counter) + '@wallet.example' }, sign: async event => finalizeEvent({ ...event, tags: [] }, authorKey) }))
      assert.equal(fetcher.mock.callCount(), 1)
    } finally { fetcher.mock.restore() }
  }
})
