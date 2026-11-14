import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTip, freshQuote, initialTipCurrency, parseTipRates, satsForAmount, unitRate } from '../src/lib/tip-currency';

test('the saved tip currency wins over region and unsupported regions use USD', () => {
  assert.equal(initialTipCurrency('BTC', ['fi-FI']), 'BTC');
  assert.equal(initialTipCurrency(null, ['fi-FI']), 'EUR');
  assert.equal(initialTipCurrency('invalid', ['en-GB']), 'GBP');
  assert.equal(initialTipCurrency(null, ['en', 'invalid locale']), 'USD');
});

test('exact invoice sats, BTC and minor fiat amounts format without rounding tiny tips to zero', () => {
  const quote = parseTipRates({data: {currency:'BTC', rates:{BTC:'1',USD:'100000',JPY:'15000000'}}});
  assert.ok(quote);
  assert.equal(satsForAmount(0.1, unitRate('USD', quote)), 100);
  assert.equal(satsForAmount(0.00000021, unitRate('BTC', null)), 21);
  assert.equal(formatTip(1, 'USD', quote), '<$0.01');
  assert.equal(formatTip(100, 'USD', quote, true), '$0.10 (100 sats)');
  assert.equal(formatTip(21, 'BTC', null), '0.00000021 BTC');
  assert.equal(formatTip(1, 'SATS', null), '1 sat');
  assert.equal(formatTip(0.001, 'BTC', null), '0.00000000001 BTC');
  assert.equal(formatTip(0.001, 'EUR', null), '0.001 sats');
  assert.equal(formatTip(0.001, 'USD', quote), '<$0.01');
  for (const amount of [0, -1, Infinity, NaN, 0.000001, Number.MAX_SAFE_INTEGER]) {
    assert.equal(satsForAmount(amount, 100000), undefined);
  }
});

test('an unusable fiat quote leaves exact satoshi display available', () => {
  const at = Date.now();
  const quote = {at, rates: {EUR: 80000}};
  assert.equal(unitRate('EUR', quote, at + 15 * 60000), undefined);
  assert.equal(unitRate('EUR', quote, at - 1), undefined);
  assert.equal(freshQuote({at, rates:{EUR:Infinity}}, at), null);
  assert.equal(parseTipRates({data:{currency:'ETH', rates:{BTC:'1',EUR:'80000'}}}), null);
  assert.equal(parseTipRates({data:{currency:'BTC', rates:{BTC:'1',EUR:'junk'}}}), null);
  assert.equal(formatTip(100, 'EUR', null, true), '100 sats');
});
