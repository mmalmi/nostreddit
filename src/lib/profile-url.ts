import { decode, npubEncode } from 'nostr-tools/nip19';

export type Relationship = 'followers' | 'following';

export function profileUrl(pubkey: string, list?: Relationship): string {
  return '/u/' + npubEncode(pubkey) + (list ? '/' + list : '');
}

export function profileKeyFromPath(identifier: string): string | null {
  if (/^[0-9a-f]{64}$/i.test(identifier)) return identifier.toLowerCase();
  if (!/^npub1/i.test(identifier)) return null;
  try {
    const pointer = decode(identifier);
    return pointer.type === 'npub' && /^[0-9a-f]{64}$/.test(pointer.data) ? pointer.data : null;
  } catch { return null; }
}
