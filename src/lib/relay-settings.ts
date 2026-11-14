export const maxRelays = 8;

export function validateRelayUrls(input: string | readonly string[], allowEmpty = false): string[] {
  const addresses = typeof input === 'string' ? input.split(/[\s,]+/).filter(Boolean) : input;
  const urls = [...new Set(addresses.map(address => {
    const value = address.trim();
    if (!value || /[\s,]/.test(value)) throw new Error('Enter one relay address in each row.');
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Enter valid wss:// relay addresses.'); }
    if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.hash ||
        (url.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      throw new Error('Use wss:// addresses (ws:// is allowed for local relays).');
    return url.href.replace(/\/$/, '');
  }))];
  if ((!allowEmpty && !urls.length) || urls.length > maxRelays) throw new Error(`Choose between 1 and ${maxRelays} relays.`);
  return urls;
}

export function readStoredRelayUrls(read: () => string | null, defaults: readonly string[]): string[] {
  try {
    const saved = read();
    return saved === null ? [...defaults] : validateRelayUrls(saved, true);
  } catch {
    // Unreadable preferences are not permission to connect to public defaults.
    return [];
  }
}
