import type { NostrFilter } from 'nostr-pubsub';
import { topicSlug } from './hashtags';
import { discussionKinds, matchesTopic, type Post } from './posts';
import { profileKeyFromPath } from './profile-url';

export type FeedSource = 'all' | 'following' | 'network' | 'saved' | 'notifications';
export type FeedOrder = 'Hot' | 'New' | 'Top';
export interface Feed {
  id: string;
  name: string;
  source: FeedSource;
  topics: string[];
  keywords: string[];
  exclude: string[];
  authors: string[];
  order?: FeedOrder;
}
export const maxFeeds = 30;
export const maxCustomFeeds = 25;
export function defaultFeeds(): Feed[] {
  return [
    ['home', 'Home feed', 'all'], ['following', 'Following', 'following'],
    ['network', 'In network', 'network'], ['notifications', 'Notifications', 'notifications'],
    ['saved', 'Saved posts', 'saved'],
  ].map(([id, name, source]) => ({ id, name, source: source as FeedSource, topics: [], keywords: [], exclude: [], authors: [] }));
}
export function isDefaultFeed(id: string) { return defaultFeeds().some(feed => feed.id === id); }
export function feedPath(feed: Feed) { return feed.id === 'home' ? '/' : isDefaultFeed(feed.id) ? '/' + feed.id : '/feeds/' + feed.id; }
export function feedIcon(feed: Feed) {
  return feed.id === 'home' ? 'home' : ({ all: 'hash', following: 'users', network: 'globe', saved: 'save', notifications: 'bell' })[feed.source];
}
const phrases = (value: string) => [...new Set(value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
export function parseFeedFilters(input: { topics: string; keywords: string; exclude: string; authors: string }) {
  const tags = [...new Set(input.topics.split(/[\s,]+/).filter(Boolean).map(value => {
    const slug = topicSlug(value);
    if (!slug) throw new Error('Use topic names with letters, numbers, hyphens, or underscores.');
    return slug;
  }))];
  const authors = [...new Set(input.authors.split(/[\s,]+/).filter(Boolean).map(value => {
    const key = profileKeyFromPath(value.replace(/^nostr:/i, ''));
    if (!key) throw new Error('Enter authors as public npub keys or 64-character public keys.');
    return key;
  }))];
  const keywords = phrases(input.keywords), exclude = phrases(input.exclude);
  if ([tags, authors, keywords, exclude].some(items => items.length > 16)) throw new Error('Use up to 16 entries in each filter.');
  if ([...keywords, ...exclude].some(value => value.length > 100)) throw new Error('Keep each keyword or phrase under 100 characters.');
  return { topics: tags, authors, keywords, exclude };
}
export function normalizeFeeds(raw: unknown): Feed[] {
  if (!Array.isArray(raw)) return defaultFeeds();
  const result = [defaultFeeds()[0]];
  for (const value of raw.slice(0, 100)) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' ||
        !/^[a-z0-9-]{1,64}$/.test(value.id) || result.some(feed => feed.id === value.id) ||
        typeof value.name !== 'string' || !value.name.trim()) continue;
    const builtin = defaultFeeds().find(feed => feed.id === value.id);
    if (!builtin && result.filter(feed => !isDefaultFeed(feed.id)).length >= maxCustomFeeds) continue;
    const source = builtin?.source ?? value.source;
    if (!['all', 'following', 'network', 'saved', 'notifications'].includes(source) || (!builtin && source === 'notifications')) continue;
    try {
      const list = (key: string) => {
        if (value[key] === undefined) return '';
        if (!Array.isArray(value[key]) || value[key].some((item: unknown) => typeof item !== 'string')) throw new Error('Invalid filter');
        return value[key].join(',');
      };
      const filters = parseFeedFilters({ topics: list('topics'), keywords: list('keywords'), exclude: list('exclude'), authors: list('authors') });
      result.push({ id: value.id, name: value.name.trim().slice(0, 40), source, ...filters,
        ...(['Hot', 'New', 'Top'].includes(value.order) ? { order: value.order } : {}) });
    } catch { /* Discard malformed feeds without breaking the navigation. */ }
    if (result.length >= maxFeeds) break;
  }
  return result;
}
export function restoreDefaultFeeds(feeds: Feed[]) {
  return normalizeFeeds([...defaultFeeds(), ...feeds.filter(feed => !isDefaultFeed(feed.id))]);
}
export function matchesFeed(post: Post, feed: Feed, follows: readonly string[], distance?: number | null) {
  if (feed.source === 'following' && !follows.includes(post.pubkey)) return false;
  if (feed.source === 'network' && (distance ?? Infinity) > 2) return false;
  if (feed.authors.length && !feed.authors.includes(post.pubkey)) return false;
  if (feed.topics.length && !feed.topics.some(topic => matchesTopic(post, topic))) return false;
  const text = (post.title + '\n' + post.event.content).toLowerCase();
  return (!feed.keywords.length || feed.keywords.some(word => text.includes(word))) && !feed.exclude.some(word => text.includes(word));
}
// Topics in one request are OR-ed. The other fields narrow that request.
// Keywords stay local: ordinary relays need not support full-text search.
export function feedRelayFilters(feed: Feed): NostrFilter[] {
  if (feed.source === 'saved' || feed.source === 'notifications') return [];
  if (!feed.topics.length && !feed.authors.length && feed.source !== 'all') return [];
  return [{ kinds: discussionKinds, limit: 90,
    ...(feed.topics.length ? { '#t': feed.topics } : {}),
    ...(feed.authors.length ? { authors: feed.authors } : {}),
  }];
}
export function feedSummary(feed: Feed) {
  const source = { all: 'All discussions', following: 'People you follow', network: 'Within two follow steps', saved: 'Saved posts', notifications: 'Replies, mentions, and likes' }[feed.source];
  return [source, feed.topics.map(tag => '#' + tag).join(' or '),
    feed.keywords.length ? 'Includes ' + feed.keywords.join(' or ') : '',
    feed.exclude.length ? 'Excludes ' + feed.exclude.join(', ') : '',
    feed.authors.length ? `${feed.authors.length} ${feed.authors.length === 1 ? 'author' : 'authors'}` : ''].filter(Boolean).join(' · ');
}
