import { postIdFromPath, postUrl } from './post-url';
import { profileUrl } from './profile-url';
import { decode } from 'nostr-tools/nip19';
import { topicSlug, topicPath } from './hashtags';

export function searchTarget(input: string): string {
  const value = input.trim();
  if (/^(?:[tr]\/|#)/i.test(value)) {
    const topic = topicSlug(value.replace(/^(?:[tr]\/|#)/i, ''));
    if (topic) return topicPath(topic);
  }
  const identifier = value.replace(/^nostr:/i, '');
  if (/^(?:note|nevent)1/i.test(identifier)) {
    const id = postIdFromPath(identifier);
    return id ? postUrl(id) : '';
  }
  if (!/^(?:npub|nprofile)1/i.test(identifier)) return '';
  try {
    const pointer = decode(identifier);
    if (pointer.type === 'npub') return profileUrl(pointer.data);
    if (pointer.type === 'nprofile') return profileUrl(pointer.data.pubkey);
  } catch { /* Treat an incomplete identifier as a local text search. */ }
  return '';
}
export function checkSearch(input: string) {
  const value = input.trim();
  if (/nsec1[0-9a-z]+/i.test(value)) throw new Error('A secret key can only be used in the sign-in dialog.');
  if (value.length < 2 || value.length > 128) throw new Error('Search for 2–128 characters.');
  return value;
}
