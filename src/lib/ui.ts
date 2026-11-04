import { getProfileDisplayName, getProfileNameCandidates, type IrisProfile } from '@iris/svelte-ui/profile';

import { topicSlug } from './hashtags';

const publicIdentifier = /^(?:nostr:)?(?:(?:npub|nprofile|nsec)1[0-9a-z]+|(?:0x)?[a-f0-9]{64})$/i;
export function displayName(pubkey: string, profile?: IrisProfile | null): string {
  const published = getProfileNameCandidates(profile).find(value => !publicIdentifier.test(value));
  return getProfileDisplayName(undefined, pubkey.toLowerCase(), published);
}

export const topics = [
  {
    slug: 'nostr',
    name: 'Nostr',
    icon: 'nostr',
    color: 'violet',
    desc: 'Clients, relays, and the open network',
  },
  {
    slug: 'bitcoin',
    name: 'Bitcoin',
    icon: 'bitcoin',
    color: 'gold',
    desc: 'Bitcoin and Lightning',
  },
  {
    slug: 'photography',
    name: 'Photography',
    icon: 'camera',
    color: 'sky',
    desc: 'Life through a lens',
  },
  {
    slug: 'art',
    name: 'Art',
    icon: 'art',
    color: 'coral',
    desc: 'Sketches, studies, and finished work',
  },
  {
    slug: 'music',
    name: 'Music',
    icon: 'music',
    color: 'rose',
    desc: 'Listening, playing, and sharing',
  },
  {
    slug: 'technology',
    name: 'Technology',
    icon: 'tech',
    color: 'moss',
    desc: 'Tools, experiments, and ideas',
  },
];
export function topicInfo(slug: string) {
  return (
    topics.find((item) => item.slug === slug) ?? {
      slug,
      name: slug,
      icon: 'hash',
      color: 'moss',
      desc: 'A public Nostr topic',
    }
  );
}
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
