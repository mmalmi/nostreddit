import { decode } from 'nostr-tools/nip19';
import { topicSlug } from './posts';

export function searchTarget(input: string): string {
  const value = input.trim();
  if (/^(?:r\/|#)/i.test(value)) {
    const topic = topicSlug(value.replace(/^(?:r\/|#)/i, ''));
    if (topic) return '/r/' + topic;
  }
  const identifier = value.replace(/^nostr:/i, '');
  if (!/^(npub|nprofile|note|nevent)1/i.test(identifier)) return '';
  try {
    const pointer = decode(identifier);
    if (pointer.type === 'npub') return '/u/' + pointer.data;
    if (pointer.type === 'nprofile') return '/u/' + pointer.data.pubkey;
    if (pointer.type === 'note') return '/post/' + pointer.data;
    if (pointer.type === 'nevent') return '/post/' + pointer.data.id;
  } catch { /* Treat an incomplete identifier as a local text search. */ }
  return '';
}
export function checkSearch(input: string) {
  const value = input.trim();
  if (/nsec1[0-9a-z]+/i.test(value)) throw new Error('A secret key can only be used in the sign-in dialog.');
  if (value.length < 2 || value.length > 128) throw new Error('Search for 2–128 characters.');
  return value;
}
