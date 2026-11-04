import { expect, test } from '@playwright/test'
import { hex } from '@scure/base'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { WebSocket } from 'ws'
import { authorKey, bolt11, metadata, preimage, target } from './helpers/zapInvoice'

test('guest can scan an invoice and see wallet-confirmed payment for a post', async ({ page }) => {
  const relay = new WebSocket('ws://127.0.0.1:43164')
  try {
    await new Promise<void>((resolve, reject) => { relay.once('open', resolve); relay.once('error', reject) })
    for (const event of [
      finalizeEvent({ kind: 0, content: JSON.stringify({ name: 'Zap fixture', lud16: 'author@lightning.example' }), tags: [], created_at: 1 }, authorKey),
      target,
    ]) {
      const acknowledged = new Promise<void>((resolve, reject) => {
        relay.once('message', raw => {
          const [type, id, ok] = JSON.parse(String(raw))
          if (type === 'OK' && id === event.id && ok === true) resolve()
          else reject(new Error('Fixture relay rejected event.'))
        })
      })
      relay.send(JSON.stringify(['EVENT', event]))
      await acknowledged
    }
  } finally { relay.close() }

  await page.route('https://lightning.example/**', route => route.fulfill({ json: metadata }))
  await page.route('https://pay.example/**', route => {
    const url = new URL(route.request().url())
    const request = JSON.parse(url.searchParams.get('nostr')!)
    expect(verifyEvent(request)).toBe(true)
    expect(request.tags).toContainEqual(['e', target.id])
    expect(request.tags).toContainEqual(['p', target.pubkey])
    expect(request.tags).toContainEqual(['amount', '100000'])
    return route.fulfill({ json: { pr: bolt11(url.searchParams.get('nostr')!, { sats: 100 }) } })
  })
  await page.addInitScript((proof: string) => {
    Object.assign(window, { webln: { enable: async () => {}, sendPayment: async () => ({ preimage: proof }) } })
  }, hex.encode(preimage))

  await page.goto('/post/' + target.id)
  await page.getByRole('button', { name: 'Zap with Lightning' }).first().click()
  await page.getByRole('button', { name: '100', exact: true }).click()
  await page.getByRole('button', { name: 'Get Lightning invoice' }).click()
  await expect(page.getByRole('img', { name: 'Scan this invoice with a Lightning wallet' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Lightning wallet' })).toHaveAttribute('href', /^lightning:lnbc/)
  await expect(page.getByText('Zap confirmed')).toHaveCount(0)
  await page.getByRole('button', { name: 'Pay with browser wallet' }).click()
  await expect(page.getByText('Zap confirmed')).toBeVisible()
})
