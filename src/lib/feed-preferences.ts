import { get, writable } from 'svelte/store';
import { readLocal, writeLocal } from './ui';
import { normalizeFeeds, type Feed } from './feeds';

export const feedPreferences = writable(normalizeFeeds(readLocal('feeds', null)));
export function setFeeds(feeds: Feed[]) {
  const next = normalizeFeeds(feeds);
  feedPreferences.set(next);
  writeLocal('feeds', next);
}
export function saveFeed(feed: Feed) {
  const current = get(feedPreferences);
  setFeeds(current.some(item => item.id === feed.id) ? current.map(item => item.id === feed.id ? feed : item) : [...current, feed]);
}
export function watchFeedPreferences() {
  const changed = (event: StorageEvent) => {
    if (event.key === null || event.key === 'nostreddit.ui.feeds') feedPreferences.set(normalizeFeeds(readLocal('feeds', null)));
  };
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
}
