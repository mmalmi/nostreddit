import { isEventId, postIdFromPath, postUrl } from './post-url';
import { profileUrl } from './profile-url';
import { decode } from 'nostr-tools/nip19';
import { topicSlug, topicPath } from './hashtags';
import type { SearchPlan } from './discovery/query';

export function searchTopics(plan: SearchPlan, known: string[]) {
  // Topics need no creation step: offer the literal topic even before seeing a post.
  const exact = [topicSlug(plan.relayQuery), ...plan.hashtags.map(topicSlug)].filter(Boolean);
  const related = known.filter(slug => plan.terms.some(term =>
    slug === term || (term.length >= 3 && slug.startsWith(term))));
  return [...new Set([...exact, ...related])].slice(0, 5);
}

export const containsSearchSecret = (value: string) => /nsec1[0-9a-z]+/i.test(value);
export const secretSearchMessage = 'Use secret keys only in the sign-in dialog.';

export function singleHashtag(input: string): string {
  return input.trimStart().startsWith('#') ? topicSlug(input) : '';
}

export function searchTarget(input: string, {knownProfiles, topic}: {
  knownProfiles?: Readonly<Record<string, unknown>>;
  topic?: string;
} = {}): string {
  const value = input.trim();
  if (value.startsWith('#')) {
    const slug = singleHashtag(value);
    return slug && !topic ? topicPath(slug) : '';
  }
  const shortcut = value.match(/^[tr]\/([^\s#]+)$/i);
  if (shortcut) {
    const slug = topicSlug(shortcut[1]);
    return slug ? topicPath(slug) : '';
  }
  const identifier = value.replace(/^(?:web\+)?nostr:/i, '');
  // Bare hex can also name a profile. Use known metadata without delaying navigation for a relay lookup.
  if (isEventId(identifier)) {
    const hex = identifier.toLowerCase();
    return knownProfiles?.[hex] ? profileUrl(hex) : postUrl(hex);
  }
  if (/^(?:note|nevent)1/i.test(identifier)) {
    const id = postIdFromPath(identifier);
    return id ? postUrl(id) : '';
  }
  if (!/^(?:npub|nprofile)1/i.test(identifier)) return '';
  try {
    const pointer = decode(identifier);
    if (pointer.type === 'npub' && isEventId(pointer.data)) return profileUrl(pointer.data);
    if (pointer.type === 'nprofile') return profileUrl(pointer.data.pubkey);
  } catch { /* Treat an incomplete identifier as a local text search. */ }
  return '';
}
export function checkSearch(input: string) {
  const value = input.trim();
  if (containsSearchSecret(value)) throw new Error(secretSearchMessage);
  if (value.length < 2 || value.length > 128) throw new Error('Search for 2–128 characters.');
  return value;
}
