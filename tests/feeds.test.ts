import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { asPost } from '../src/lib/posts';
import { defaultFeeds, normalizeFeeds, restoreDefaultFeeds, parseFeedFilters, matchesFeed, feedRelayFilters, type Feed } from '../src/lib/feeds';

const post = asPost(finalizeEvent({ kind: 1, created_at: Math.floor(Date.now()/1000), content: 'Night skies #art', tags: [['t', 'photography'], ['subject', 'A Coastal walk']] }, generateSecretKey()))!;
const custom = (filters = {}): Feed => ({ ...defaultFeeds()[0], id: 'custom-1', name: 'Coast', ...filters });

test('Home stays first and immutable; removed defaults stay removed until restored', () => {
  const feeds = normalizeFeeds([custom(), { ...defaultFeeds()[0], name: 'Changed', source: 'saved', topics: ['art'] }]);
  assert.deepEqual(feeds[0], defaultFeeds()[0]);
  assert.equal(feeds.length, 2);
  assert.deepEqual(restoreDefaultFeeds(feeds), [...defaultFeeds(), custom()]);
  assert.deepEqual(normalizeFeeds(null), defaultFeeds());
});
test('malformed stored feeds cannot break navigation or silently broaden their filters', () => {
  assert.deepEqual(normalizeFeeds([custom({ authors: ['nsec1secret'] }), custom({ id: '../bad' }), custom({ topics: {} })]), [defaultFeeds()[0]]);
  assert.equal(normalizeFeeds([custom(), custom()]).length, 2);
});
test('restoring defaults retains every custom feed at the storage limit', () => {
  const feeds = normalizeFeeds(Array.from({ length: 40 }, (_, i) => custom({ id: 'custom-' + i })));
  assert.equal(feeds.length, 26);
  const restored = restoreDefaultFeeds(feeds);
  assert.equal(restored.length, 30);
  assert.deepEqual(restored.slice(5), feeds.slice(1));
});
test('filter parsing normalizes topics and public keys while rejecting invalid input', () => {
  assert.deepEqual(parseFeedFilters({ topics: '#Art, PHOTOGRAPHY art', keywords: 'Coastal walk, skies', exclude: 'Ads', authors: npubEncode(post.pubkey) }),
    { topics: ['art', 'photography'], keywords: ['coastal walk', 'skies'], exclude: ['ads'], authors: [post.pubkey] });
  assert.throws(() => parseFeedFilters({ topics: 'bad/topic', keywords: '', exclude: '', authors: '' }));
  assert.throws(() => parseFeedFilters({ topics: '', keywords: '', exclude: '', authors: 'nsec1secret' }));
});
test('custom filters combine fields with AND and values with OR, including exclusions and social scope', () => {
  const feed = custom({ topics: ['music', 'art'], keywords: ['coastal walk'], authors: [post.pubkey] });
  assert.equal(matchesFeed(post, feed, []), true);
  assert.equal(matchesFeed(post, { ...feed, exclude: ['skies'] }, []), false);
  assert.equal(matchesFeed(post, { ...feed, topics: ['music'] }, []), false);
  assert.equal(matchesFeed(post, { ...feed, source: 'following' }, []), false);
  assert.equal(matchesFeed(post, { ...feed, source: 'following' }, [post.pubkey]), true);
  assert.equal(matchesFeed(post, { ...feed, source: 'network' }, [], 3), false);
  assert.equal(matchesFeed(post, { ...feed, source: 'network' }, [], 2), true);
});
test('custom feeds fetch their topics and authors in one bounded request and saved feeds stay local', () => {
  const feed = custom({ topics: ['art', 'photography'], authors: [post.pubkey] });
  assert.deepEqual(feedRelayFilters(feed), [{ kinds: [1,20,21,22,1111], limit: 90, '#t': feed.topics, authors: [post.pubkey] }]);
  assert.deepEqual(feedRelayFilters({ ...feed, source: 'saved' }), []);
});
