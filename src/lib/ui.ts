import { getProfileDisplayName, getProfileNameCandidates, type IrisProfile } from '@iris/svelte-ui/profile';

import { topicSlug } from './hashtags';

const publicIdentifier = /^(?:nostr:)?(?:(?:npub|nprofile|nsec)1[0-9a-z]+|(?:0x)?[a-f0-9]{64})$/i;
export function displayName(pubkey: string, profile?: IrisProfile | null): string {
  const published = getProfileNameCandidates(profile).find(value => !publicIdentifier.test(value));
  return getProfileDisplayName(undefined, pubkey.toLowerCase(), published);
}

// Navigation suggestions are open tag names.
export function topicInfo(slug: string) {
  const colors = ['violet','gold','sky','coral','rose','moss'];
  let hash = 0;
  for (const letter of slug) hash = (hash * 31 + letter.codePointAt(0)!) >>> 0;
  return {slug, name:slug, icon:'hash', color:colors[hash % colors.length]};
}
export const topics = ['nostr','bitcoin','photography','art','music','technology'].map(topicInfo);
export function validTopic(slug: string) {
  return !!slug && topicSlug(slug)===slug;
}
export function safeURL(value: string | undefined) {
  try {
    const u = new URL(value ?? '');
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}
export function age(time: number) {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - time);
  if (delta < 60) return 'now';
  if (delta < 3600) return Math.floor(delta / 60) + 'm';
  if (delta < 86400) return Math.floor(delta / 3600) + 'h';
  if (delta < 86400 * 7) return Math.floor(delta / 86400) + 'd';
  return new Date(time * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(delta > 31536000 ? { year: 'numeric' } : {}),
  });
}
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem('nostreddit.ui.' + key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem('nostreddit.ui.' + key, JSON.stringify(value));
  } catch {
    /* Private browsing may disable storage. */
  }
}
