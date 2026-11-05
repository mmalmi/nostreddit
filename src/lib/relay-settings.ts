export function validateRelayUrls(input: string, allowEmpty = false): string[] {
  const urls = [...new Set(input.split(/[\s,]+/).filter(Boolean).map(value => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Enter valid wss:// relay addresses.'); }
    if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.hash ||
        (url.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      throw new Error('Use wss:// addresses (ws:// is allowed for local relays).');
    return url.href.replace(/\/$/, '');
  }))];
  if ((!allowEmpty && !urls.length) || urls.length > 8) throw new Error('Choose between 1 and 8 relays.');
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
