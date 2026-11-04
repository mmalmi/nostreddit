import { bech32, utils } from '@scure/base'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

export const providerKey = generateSecretKey()
export const authorKey = generateSecretKey()
export const signerKey = generateSecretKey()
export const target = finalizeEvent({ kind: 1, tags: [], content: 'An original post.', created_at: 1 }, authorKey)
export const preimage = generateSecretKey()
export const encoder = new TextEncoder()
export const recipient = { lud16: 'author@lightning.example' }
export const params = { event: target, profile: recipient, relays: ['wss://relay.example'], sats: 21 }
export const metadata = {
  tag: 'payRequest', allowsNostr: true, callback: 'https://pay.example/zap', minSendable: 1000,
  maxSendable: 10000000, nostrPubkey: getPublicKey(providerKey),
}
const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

export function bolt11(description: string, { sats = 21, expired = false, invalidSig = false }: { sats?: number; expired?: boolean; invalidSig?: boolean } = {}) {
  const prefix = 'lnbc' + sats * 10 + 'n'
  const timestamp = Math.floor(Date.now() / 1000) - (expired ? 4000 : 0)
  const payload = Array.from({ length: 7 }, (_, index) => Math.floor(timestamp / 32 ** (6 - index)) % 32)
  function push(tag: string, bytes: Uint8Array) {
    const words = bech32.toWords(bytes)
    payload.push(charset.indexOf(tag), words.length >> 5, words.length % 32, ...words)
  }
  push('h', sha256(encoder.encode(description)))
  push('p', sha256(preimage))
  push('s', generateSecretKey())
  push('n', secp256k1.getPublicKey(providerKey))
  const body = Uint8Array.from([...encoder.encode(prefix), ...utils.convertRadix2(payload, 5, 8, true)])
  const signature = secp256k1.sign(body, invalidSig ? authorKey : providerKey, { format: 'recovered' })
  const signatureWords = bech32.toWords(Uint8Array.from([...signature.slice(1), signature[0]]))
  return bech32.encode(prefix, [...payload, ...signatureWords], false)
}
