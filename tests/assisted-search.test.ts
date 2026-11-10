import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { asPost } from '../src/lib/posts';
import { checkSearch, searchTopics } from '../src/lib/search';
import { allowModel, keywordScore, matchesRetrieval, noExpansion, relevance, relayFilters } from '../src/lib/discovery/discussions';
import { planPostSearch } from '../src/lib/discovery/query';

const event = finalizeEvent({kind:1,created_at:10,content:'An archive of images from the launch party.',
  tags:[['t','film-lab'],['subject','Behind the lens']]}, generateSecretKey());
const post = asPost(event)!;
test('search suggests the literal topic first, including topics not yet seen', () => {
  assert.deepEqual(searchTopics(planPostSearch('cats'), ['catstr', 'cats', 'catsofinternet']), ['cats', 'catstr', 'catsofinternet']);
  assert.deepEqual(searchTopics(planPostSearch('find posts about Nature'), []), ['nature']);
  assert.deepEqual(searchTopics(planPostSearch('coffee brewing #coffee'), ['coffee']), ['coffee']);
  assert.deepEqual(searchTopics(planPostSearch('日本'), []), ['日本']);
});
test('titles, authors, hashtags and Unicode text are searchable without the model', () => {
  assert.ok(keywordScore(planPostSearch('show me discussions about behind the lens'), post, '') > 1);
  assert.equal(keywordScore(planPostSearch('Zoë'), post, 'Zoe\u0308'), 1);
  assert.equal(keywordScore(planPostSearch('art'), post, ''), 0);
  assert.equal(keywordScore(planPostSearch('images #film-lab'), post, ''), 1);
  assert.equal(relevance(keywordScore(planPostSearch('images #music'), post, ''), 1), 0);
  assert.ok(relevance(1, undefined) > relevance(0, 1));
  assert.equal(relevance(0.3, undefined), 0);
  assert.equal(allowModel(planPostSearch('🔭')), false);
  assert.equal(allowModel(planPostSearch('a'.repeat(64))), false);
});
test('reader-initiated relay filters are bounded, retain term/tag spelling and discard ignored search filters', () => {
  const plan = planPostSearch('find me posts about seaside walks #film-lab');
  assert.equal(plan.relayQuery, 'seaside walks');
  const filters = relayFilters(plan,{terms:['beaches','walking','ignored'], tags:['CoastalTrails','film-lab']});
  assert.equal(filters.length, 6);
  assert.deepEqual(filters.at(-1)?.['#t'], ['film-lab','CoastalTrails']);
  assert.ok(matchesRetrieval(event,filters));
  const image = {...event, kind:20, content:'', tags:[['imeta','alt Tern at the breakwater']]};
  const mediaFilters = relayFilters(planPostSearch('breakwater'),noExpansion);
  assert.ok(mediaFilters[0].kinds?.includes(image.kind));
  assert.ok(matchesRetrieval(image, mediaFilters));
  assert.equal(matchesRetrieval(event,relayFilters(planPostSearch('seaside walks'),noExpansion)),false);
  assert.throws(()=>checkSearch('about nsec1deadbeef'));
  assert.ok(!JSON.stringify(relayFilters(plan,{terms:['nsec1deadbeef'],tags:[]})).includes('nsec'));
});
