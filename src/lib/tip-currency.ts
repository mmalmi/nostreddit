import { get, writable } from 'svelte/store';
import { readLocal, writeLocal } from './ui';

export const fiatCurrencies = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'CHF', 'CAD', 'AUD', 'JPY', 'CNY', 'INR'] as const;
type Fiat = typeof fiatCurrencies[number];
export const tipCurrencies = [...fiatCurrencies, 'SATS', 'BTC'] as const;
export type TipCurrency = typeof tipCurrencies[number];
const regions: Record<string, Fiat> = {
  US: 'USD', GB: 'GBP', SE: 'SEK', NO: 'NOK', DK: 'DKK', CH: 'CHF', LI: 'CHF', CA: 'CAD',
  AU: 'AUD', JP: 'JPY', CN: 'CNY', IN: 'INR',
};
const euroRegions = 'AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK AD MC SM VA'.split(' ');

export function initialTipCurrency(saved: unknown, locales: readonly string[]): TipCurrency {
  const explicit = tipCurrencies.find(code => code === saved);
  if (explicit) return explicit;
  for (const language of locales) {
    try {
      const region = new Intl.Locale(language).region;
      if (region && euroRegions.includes(region)) return 'EUR';
      if (region && regions[region]) return regions[region];
    } catch { /* Skip unrecognized locales. */ }
  }
  return 'USD';
}

const loadCurrency = () => initialTipCurrency(readLocal('tipCurrency', null), globalThis.navigator?.languages ?? []);
export const tipCurrency = writable<TipCurrency>(loadCurrency(), set => {
  const changed = (event: StorageEvent) => {
    if (event.key === 'nostreddit.ui.tipCurrency' || event.key === null) set(loadCurrency());
  };
  globalThis.addEventListener?.('storage', changed);
  return () => globalThis.removeEventListener?.('storage', changed);
});
export function setTipCurrency(code: string) {
  const choice = tipCurrencies.find(unit => unit === code);
  if (choice) {
    writeLocal('tipCurrency', choice);
    tipCurrency.set(choice);
  }
}

type Rates = Partial<Record<Fiat, number>>;
export type TipQuote = { at: number; rates: Rates };
const quoteKey = 'tipExchangeRates';
const freshMs = 15 * 60_000;
const satsPerBtc = 100_000_000;
export const rateURL = 'https://api.coinbase.com/v2/exchange-rates?currency=BTC';

function cleanRates(input: unknown): Rates {
  const result: Rates = {};
  if (input && typeof input === 'object') {
    for (const code of fiatCurrencies) {
      const raw = (input as Record<string, unknown>)[code];
      const value = typeof raw === 'number' || (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw)) ? Number(raw) : 0;
      if (Number.isFinite(value) && value > 0 && value <= 1e18) result[code] = value;
    }
  }
  return result;
}
export function freshQuote(value: TipQuote | null, now = Date.now()): TipQuote | null {
  if (!value || !Number.isSafeInteger(value.at) || value.at > now || value.at <= now - freshMs) return null;
  const rates = cleanRates(value.rates);
  return Object.keys(rates).length ? { at: value.at, rates } : null;
}
export function parseTipRates(body: {data?: { currency?: unknown; rates?: Record<string, unknown> }} | null, now = Date.now()) {
  if (body?.data?.currency !== 'BTC' || Number(body.data.rates?.BTC) !== 1) return null;
  return freshQuote({ at: now, rates: cleanRates(body.data.rates) }, now);
}

// Only request public rates for a visible amount. All cards and the payment form share one request.
const cached = freshQuote(readLocal<TipQuote | null>(quoteKey, null));
export const tipQuote = writable<TipQuote | null>(cached);
export const loadingTipRates = writable(false);
let retryAfter = 0;
let expiry: ReturnType<typeof setTimeout>;
function expireAt(quote: TipQuote) {
  clearTimeout(expiry);
  expiry = setTimeout(() => tipQuote.set(null), Math.max(0, quote.at + freshMs - Date.now()));
}
if (cached && typeof window !== 'undefined') expireAt(cached);
export async function loadTipRates(currency: TipCurrency) {
  if (currency === 'BTC' || currency === 'SATS' || get(loadingTipRates) || Date.now() < retryAfter) return;
  const current = get(tipQuote);
  if (current && Date.now() < current.at + freshMs && current.rates[currency]) return;
  loadingTipRates.set(true);
  retryAfter = Date.now() + 60_000;
  try {
    const response = await fetch(rateURL, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return;
    const now = Date.now(), at = Date.parse(response.headers.get('date') ?? '');
    if (Number.isFinite(at) && (at > now + 60_000 || at < now - freshMs)) return;
    const quote = parseTipRates(await response.json(), Math.min(now, Number.isFinite(at) ? at : now));
    if (quote) {
      writeLocal(quoteKey, quote);
      tipQuote.set(quote);
      expireAt(quote);
    }
  } catch { /* Exact sat amounts remain usable offline. */ }
  finally { loadingTipRates.set(false); }
}

export function unitRate(currency: TipCurrency, quote: TipQuote | null, now = Date.now()): number | undefined {
  if (currency === 'SATS') return satsPerBtc;
  if (currency === 'BTC') return 1;
  return quote && now >= quote.at && now < quote.at + freshMs ? quote.rates[currency] : undefined;
}
export function satsForAmount(amount: number | undefined, rate?: number): number | undefined {
  if (!amount || amount <= 0 || !rate) return;
  const sats = Math.round(amount * satsPerBtc / rate);
  return Number.isSafeInteger(sats) && sats >= 1 && sats <= 2_100_000_000_000 ? sats : undefined;
}
export function formatTipUnit(value: number, currency: TipCurrency) {
  if (currency === 'SATS') return value.toLocaleString() + (value === 1 ? ' sat' : ' sats');
  if (currency === 'BTC') return value.toLocaleString(undefined, {maximumFractionDigits: 11}) + ' BTC';
  const format = new Intl.NumberFormat(undefined, {style: 'currency', currency});
  const minor = 10 ** -(format.resolvedOptions().maximumFractionDigits ?? 2);
  return value > 0 && value < minor ? '<' + format.format(minor) : format.format(value);
}
export function formatTip(sats: number, currency: TipCurrency, quote: TipQuote | null, exact = false) {
  const satText = formatTipUnit(sats, 'SATS');
  const rate = unitRate(currency, quote);
  if (currency === 'SATS' || !rate) return satText;
  const amount = formatTipUnit(sats / satsPerBtc * rate, currency);
  const primary = currency === 'BTC' || amount.startsWith('<') ? amount : '≈' + amount;
  return exact ? primary + ' (' + satText + ')' : primary;
}
