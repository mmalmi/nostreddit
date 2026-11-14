import { expect, test } from '@playwright/test'
import { hex } from '@scure/base'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type NostrEvent } from 'nostr-tools/pure'
import { WebSocket } from 'ws'
import { authorKey, bolt11, metadata, preimage, providerKey, target } from './helpers/zapInvoice'
import { profileUrl } from '../src/lib/profile-url'
import { postUrl } from '../src/lib/post-url'
const rateURL = 'https://api.coinbase.com/v2/exchange-rates?currency=BTC'
import { allowFixtureAuthors } from './helpers/graphPreferences';

test.beforeEach(async ({context}) => { await allowFixtureAuthors(context); });

async function publish(events: NostrEvent[]) {
  const relay = new WebSocket('ws://127.0.0.1:43164')
  try {
    await new Promise<void>((resolve, reject) => { relay.once('open', resolve); relay.once('error', reject) })
    for (const event of events) {
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
}

const profile = finalizeEvent({
  kind: 0, content: JSON.stringify({ name: 'Tip fixture', lud16: 'author@lightning.example' }), tags: [], created_at: 1,
}, authorKey)

test('guest enters a fiat tip, verifies the exact Lightning invoice and sees the received total', async ({ page }, testInfo) => {
  await publish([profile, target])
  await page.route(rateURL, route => route.fulfill({ json: { data: { currency: 'BTC', rates: { BTC: '1', USD: '100000' } } } }))
  let invoice = '', description = ''

  await page.route('https://lightning.example/**', route => route.fulfill({ json: metadata }))
  await page.route('https://pay.example/**', route => {
    const url = new URL(route.request().url())
    const request = JSON.parse(url.searchParams.get('nostr')!)
    expect(verifyEvent(request)).toBe(true)
    expect(request.tags).toContainEqual(['e', target.id])
    expect(request.tags).toContainEqual(['p', target.pubkey])
    expect(request.tags).toContainEqual(['amount', '100000'])
    expect(url.searchParams.get('amount')).toBe('100000')
    description = url.searchParams.get('nostr')!
    invoice = bolt11(description, { sats: 100 })
    return route.fulfill({ json: { pr: invoice } })
  })
  await page.addInitScript((proof: string) => {
    Object.assign(window, { webln: { enable: async () => {}, sendPayment: async () => ({ preimage: proof }) } })
  }, hex.encode(preimage))

  await page.goto('/post/' + target.id)
  const tip = page.getByRole('button', { name: 'Tip with Lightning' }).first()
  await tip.click()
  await expect(page.getByLabel('Amount in USD')).toHaveValue('0.1')
  await expect(page.getByText('100 sats via Lightning')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('tip-fiat-entry.png') })
  await page.getByRole('button', { name: 'Get Lightning invoice' }).click()
  await expect(page.getByRole('img', { name: 'Scan this invoice with a Lightning wallet' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Lightning wallet' })).toHaveAttribute('href', /^lightning:lnbc/)
  await expect(page.getByText('Tip confirmed')).toHaveCount(0)
  await page.getByRole('button', { name: 'Pay with browser wallet' }).click()
  await expect(page.getByText('Tip confirmed')).toBeVisible()
  await expect(page.getByText('$0.10 (100 sats) to the author.')).toBeVisible()
  const request = JSON.parse(description)
  await publish([finalizeEvent({
    kind: 9735, created_at: Math.floor(Date.now() / 1000), content: '',
    tags: [['p', target.pubkey], ['e', target.id], ['P', request.pubkey], ['description', description], ['bolt11', invoice]],
  }, providerKey)])
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(tip).toHaveText('$0.10')

})


test('tip settings persist and missing exchange rates allow exact sats entry', async ({page}, testInfo) => {
  await publish([profile, target])
  let requests = 0
  await page.route(rateURL, route => { requests++; return route.abort() })
  await page.setViewportSize({width: 390, height: 844})
  await page.goto('/settings/appearance')
  const currency = page.getByLabel('Tip currency')
  await expect(currency).toHaveValue('USD')
  await currency.selectOption('EUR')
  await page.reload()
  await expect(currency).toHaveValue('EUR')
  await page.screenshot({path: testInfo.outputPath('tip-currency-settings.png')})
  await page.goto('/post/' + target.id)
  await page.getByRole('button', {name: 'Tip with Lightning'}).first().click()
  await expect(page.getByLabel('Amount in EUR')).toBeVisible()
  await expect(page.getByText('Exchange rate unavailable.')).toBeVisible()
  const getInvoice = page.getByRole('button', {name: 'Get Lightning invoice'})
  await expect(getInvoice).toBeDisabled()
  await page.getByRole('button', {name: 'Enter sats instead'}).click()
  await expect(page.getByLabel('Amount in sats')).toHaveValue('21')
  await expect(getInvoice).toBeEnabled()
  await page.goto('/settings/appearance')
  await expect(currency).toHaveValue('EUR')
  await currency.selectOption('SATS')
  await page.goto('/post/' + target.id)
  await page.getByRole('button', {name: 'Tip with Lightning'}).first().click()
  await expect(page.getByLabel('Amount in sats')).toHaveValue('21')
  expect(requests).toBe(1)
})


test('inbox shows a verified tip once, in the chosen currency, and links its sender', async ({ page }, testInfo) => {
  const recipient = generateSecretKey(), sender = generateSecretKey(), stranger = generateSecretKey()
  const pubkey = getPublicKey(recipient), now = Math.floor(Date.now() / 1000) - 3
  const signedProfile = (key: Uint8Array, content: object) => finalizeEvent({
    kind: 0, created_at: now, tags: [], content: JSON.stringify(content),
  }, key)
  const post = finalizeEvent({kind: 1, tags: [], content: 'Harbor lights', created_at: now}, recipient)
  const receipt = (from: Uint8Array, sats: number, at: number) => {
    const req = finalizeEvent({
      kind: 9734, tags: [['p', pubkey], ['e', post.id], ['relays', 'wss://relay.example'], ['amount', String(sats * 1000)]],
      created_at: at, content: '',
    }, from)
    const description = JSON.stringify(req)
    const invoice = bolt11(description, {sats, proof: generateSecretKey()})
    return {kind: 9735, created_at: at, tags: [['p', pubkey], ['e', post.id], ['P', req.pubkey],
      ['description', description], ['bolt11', invoice]], content: ''}
  }
  const payment = receipt(sender, 1, now)
  await publish([
    signedProfile(recipient, {name: 'Harbor keeper', lud16: 'keeper@lightning.example'}),
    signedProfile(sender, {name: 'Harbor visitor'}),
    signedProfile(stranger, {name: 'Ignored sender'}),
    post, finalizeEvent(payment, providerKey), finalizeEvent({...payment, created_at: now + 1}, providerKey),
    finalizeEvent(receipt(stranger, 1000, now + 2), stranger),
  ])
  let rateLookups = 0
  await page.route(rateURL, route => { rateLookups++; return route.fulfill({
    json: {data:{currency:'BTC',rates:{BTC:'1',EUR:'50000',USD:'100000',JPY:'15000000'}}},
  }) })
  await page.route('https://lightning.example/**', route => route.fulfill({json: metadata}))
  await page.addInitScript(key => {
    localStorage.setItem('nostreddit.account.v1', JSON.stringify({pubkey:key,method:'extension'}))
    localStorage.setItem('nostreddit.ui.tipCurrency', JSON.stringify('EUR'))
  }, pubkey)
  await page.goto('/settings/appearance')
  await expect(page.getByLabel('Tip currency')).toHaveValue('EUR')
  expect(rateLookups).toBe(0)
  await page.goto('/notifications')
  const feed = page.getByRole('region', {name: 'Recent notifications'})
  const tips = feed.locator('article').filter({hasText: 'sent you a tip'})
  await expect(tips).toHaveCount(1)
  await expect(tips.first().getByRole('link', {name: 'Harbor visitor'})).toHaveAttribute('href', profileUrl(getPublicKey(sender)))
  await expect(tips.first().getByText('<€0.01', {exact:true})).toHaveAttribute('title', '1 sat')
  await expect(feed.getByText('Ignored sender')).toHaveCount(0)
  await page.screenshot({path: testInfo.outputPath('tip-inbox-eur.png')})
  const settings = await page.context().newPage()
  await settings.goto('/settings/appearance')
  for (const [code,label] of [['USD','<$0.01'],['JPY','<¥1']]) {
    await settings.getByLabel('Tip currency').selectOption(code)
    await expect(tips.first().getByText(label, {exact:true})).toHaveAttribute('title', '1 sat')
  }
  await settings.close()
  await expect(tips.first().getByText('Unread')).toHaveCount(0)
  await page.evaluate(() => localStorage.setItem('nostreddit.relays.v1', ''))
  await page.route('https://lightning.example/**', route => route.abort())
  await page.reload()
  await expect(tips).toHaveCount(1)
  await expect(tips.first().getByRole('link', {name:'Harbor visitor'})).toBeVisible()
  await expect(tips.first().getByText('Unread')).toHaveCount(0)
  await expect(feed.getByText('Ignored sender')).toHaveCount(0)
})

test('five tips weeks apart share a post notification, total, discussion link and unseen badge', async ({ page }, info) => {
  const owner=generateSecretKey(), pubkey=getPublicKey(owner), now=Math.floor(Date.now()/1000)-10
  const sign=(key:Uint8Array,kind:number,content:string,tags:string[][],at=now) =>
    finalizeEvent({kind,content,tags,created_at:at},key)
  const names=['River','Jetty','Reed','Cove','Bay'], senders=names.map(()=>generateSecretKey())
  const post=sign(owner,1,'A launch at the harbor',[]), other=sign(owner,1,'Harbor birds',[])
  const tip=(sender:Uint8Array, id:string, sats:number, daysAgo:number, anonymous=false) => {
    const at=now-daysAgo*86400
    const tags=[['p',pubkey],['e',id],['relays','wss://relay.example'],['amount',String(1000*sats)]]
    if (anonymous) tags.push(['anon'])
    const request=sign(sender,9734,'',tags,at)
    const description=JSON.stringify(request)
    return sign(providerKey,9735,'',[['e',id],['p',pubkey],['P',request.pubkey],['description',description],
      ['bolt11',bolt11(description,{sats,proof:generateSecretKey()})]],at)
  }
  const payments=[1980,20,400,480,40].map((sats,i)=>tip(senders[i],post.id,sats,[2,2,17,24,26][i],i===4))
  await publish([post,other,sign(owner,0,JSON.stringify({name:'Harbor keeper',lud16:'keeper@lightning.example'}),[]),
    ...names.map((name,i)=>sign(senders[i],0,JSON.stringify({name}),[])),...payments,
    finalizeEvent({...payments[0],created_at:now},providerKey),tip(senders[0],other.id,100,1),
    sign(senders[0],7,'+',[['e',post.id],['p',pubkey]])])
  await page.route('https://lightning.example/**', route=>route.fulfill({json:metadata}))
  await page.route(rateURL, route=>route.fulfill({json:{data:{currency:'BTC',rates:{GBP:'50000',BTC:'1'}}}}))
  await page.addInitScript(key=>{
    localStorage.setItem('nostreddit.account.v1',JSON.stringify({pubkey:key,method:'extension'}))
    localStorage.setItem('nostreddit.ui.tipCurrency',JSON.stringify('GBP'))
  },pubkey)
  await page.goto('/settings/appearance')
  const badge=page.locator('[data-route-active="true"] .nav-row[href="/notifications"] .unread-count')
  await expect(badge).toHaveText('3')
  await page.goto(postUrl(post.id))
  await expect(page.getByRole('heading',{name:post.content})).toBeVisible()
  await expect(badge).toHaveText('1')
  await page.goto('/notifications')
  const inbox=page.getByRole('region',{name:'Recent notifications'})
  const group=inbox.locator('article').filter({hasText:'5 tips on your post'})
  await expect(inbox.locator('article')).toHaveCount(3)
  await expect(group.getByText('£1.46',{exact:true})).toBeVisible()
  await expect(group.getByRole('link',{name:post.content})).toHaveAttribute('href',postUrl(post.id))
  await expect(group.getByRole('listitem')).toHaveCount(0)
  await group.getByText('View tips',{exact:true}).click()
  await expect(group.getByRole('listitem')).toHaveCount(5)
  for (const [i,name] of names.slice(0,4).entries()) {
    await expect(group.getByRole('link',{name,exact:true})).toHaveAttribute('href',profileUrl(getPublicKey(senders[i])))
  }
  const anon=group.getByRole('listitem').filter({hasText:'Anonymous'})
  await expect(anon).toContainText('£0.02')
  await expect(anon.getByRole('link')).toHaveCount(0)
  for (const payment of payments) await expect(group.locator('li time[datetime="'+new Date(payment.created_at*1000).toISOString()+'"]').first()).toBeVisible()
  await page.screenshot({path:info.outputPath('grouped-post-tips.png')})
  await expect(badge).toHaveCount(0)
  await page.goto('/settings/appearance')
  await publish([tip(senders[0],post.id,200,0)])
  await expect(badge).toHaveText('1')
  await page.goto('/notifications')
  await expect(inbox.locator('article').filter({hasText:'6 tips on your post'})).toContainText('£1.56')
  await expect(badge).toHaveCount(0)
  await page.evaluate(()=>localStorage.setItem('nostreddit.relays.v1',''))
  await page.route('https://lightning.example/**', route=>route.abort())
  await page.reload()
  await expect(inbox.locator('article').filter({hasText:'6 tips on your post'})).toContainText('£1.56')
  await expect(badge).toHaveCount(0)
})
