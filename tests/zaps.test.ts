import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { bech32, hex } from '@scure/base'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { inspectZapInvoice, lightningEndpoint, matchesZapReceipt, postTipActor, postTipSummary, signedZapAuthor, payWithWallet, receivedZapSats, requestZap } from '../src/lib/zaps'

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
    assert.equal(signedZapAuthor(confirmedReceipt), signed.request.pubkey)
    const forger = finalizeEvent({
      ...receipt, tags: receipt.tags.map(tag => tag[0] === 'description'
        ? ['description', JSON.stringify({...signed.request, pubkey:target.pubkey})] : tag)
    }, providerKey)
    assert.equal(signedZapAuthor(forger), null)
    const wrongTarget = finalizeEvent({
      ...receipt, tags: receipt.tags.map(tag => tag[0] === 'e' ? ['e','0'.repeat(64)] : tag)
    }, providerKey)
    assert.equal(signedZapAuthor(wrongTarget), null)
    assert.equal(await receivedZapSats(target, recipient, [
      confirmedReceipt,
      finalizeEvent({ ...receipt, created_at: receipt.created_at + 1 }, providerKey),
      finalizeEvent(receipt, authorKey),
    ]), 21)
    const reserialized = JSON.stringify(JSON.parse(signed.description), null, 1)
    const statement = finalizeEvent({...receipt, tags:receipt.tags.map(tag =>
      tag[0] === 'description' ? ['description', reserialized] : tag)},providerKey)
    assert.equal(await receivedZapSats(target, recipient, [statement]),21)
    assert.throws(() => inspectZapInvoice(signed.invoice,21000,reserialized), /bound/)
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


test('post tip groups reconcile to the visible total, preserve anonymous receipts, and ignore repeat payment hashes', async () => {
  const groupRecipient = {lud16: 'groups@lightning.example'}
  const fetcher = mock.method(globalThis, 'fetch', async () => Response.json(metadata))
  const senderA = generateSecretKey(), senderB = generateSecretKey(), publicA = getPublicKey(senderA), publicB = getPublicKey(senderB)
  const now = Math.floor(Date.now() / 1000)
  const receipt = (key: Uint8Array, sats: number, at: number, anonymous = false, post = target.id) => {
    const tags = [['p',target.pubkey], ['e',post], ['amount',String(sats * 1000)], ['relays','wss://relay.example']]
    if (anonymous) tags.push(['anon'])
    const request = finalizeEvent({kind:9734,tags,content:'',created_at:at}, key)
    const description = JSON.stringify(request), invoice = bolt11(description, {sats,proof:generateSecretKey()})
    return finalizeEvent({kind:9735,content:'',created_at:at,tags:[
      ['e',post], ['p',target.pubkey], ['P',request.pubkey], ['description',description], ['bolt11',invoice],
    ]}, providerKey)
  }
  const first = receipt(senderA, 100, now - 10), second = receipt(senderA, 200, now - 9)
  const duplicate = finalizeEvent({...first, created_at: now + 1}, providerKey)
  const other = receipt(senderB, 300, now - 8)
  const anonA = receipt(generateSecretKey(), 10, now - 7, true), anonB = receipt(senderA, 0.5, now - 6, true)
  const wrongPost = receipt(senderB, 1000, now, false, 'a'.repeat(64))
  const forgery = finalizeEvent({...first, created_at: now}, generateSecretKey())
  try {
    assert.deepEqual(postTipActor(anonA), {sender:null})
    assert.equal(signedZapAuthor(anonB), null)
    const records = [duplicate, other, first, anonA, second, anonB, wrongPost, forgery]
    const summary = await postTipSummary(target, groupRecipient, records)
    assert.deepEqual(summary, {status:'ready', totalMillisats:610500, groups:[
      {sender:publicB, millisats:300000, count:1, latest:now-8},
      {sender:publicA, millisats:300000, count:2, latest:now-9},
      {sender:null, millisats:10500, count:2, latest:now-6},
    ]})
    assert.deepEqual(await postTipSummary(target, groupRecipient, [...records].reverse()), summary)
    assert.equal(await receivedZapSats(target, groupRecipient, records), 610.5)
    // Match the network's named-author policy: a hidden sender's anonymous
    // payment remains anonymous even when their named payments are hidden.
    const permitted = records.filter(event => postTipActor(event)?.sender !== publicA)
    assert.deepEqual((await postTipSummary(target, groupRecipient, permitted)).groups, [summary.groups[0],summary.groups[2]])
    assert.equal(fetcher.mock.callCount(), 1)
    assert.deepEqual(await postTipSummary(target, undefined, records), {status:'unavailable', totalMillisats:0, groups:[]})
    assert.deepEqual(await postTipSummary(target, undefined, [wrongPost]), {status:'ready', totalMillisats:0, groups:[]})
    assert.deepEqual(await postTipSummary(target, groupRecipient, [forgery]), {status:'ready', totalMillisats:0, groups:[]})
    fetcher.mock.mockImplementation(async () => { throw new Error('offline') })
    assert.deepEqual(await postTipSummary(target, {lud16:'offline@lightning.example'}, records), {
      status:'unavailable', totalMillisats:0, groups:[],
    })
  } finally { fetcher.mock.restore() }
})
