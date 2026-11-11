import test from 'node:test';
import assert from 'node:assert/strict';
import type { NostrEvent, NostrFilter } from 'nostr-pubsub';
import { readSearchPage, type OpenSearch } from '../src/lib/discovery/relay-search';
import { noExpansion, relayFilters } from '../src/lib/discovery/discussions';
import { planPostSearch } from '../src/lib/discovery/query';

const event = (id: string, created_at: number, content = 'nature'): NostrEvent =>
  ({id, created_at, content, kind:1, pubkey:'author', sig:'signature', tags:[]});
const result = (events: NostrEvent[], complete = true) => ({events, sources:[{id:'relay',complete}]});
// A relay that answers at once: its stored events, then the end of its history.
const relay = (answer: (filter: NostrFilter) => ReturnType<typeof result>): OpenSearch => (filter, history) => {
  const {events, sources} = answer(filter);
  events.forEach(history.onEvent);
  history.onEose({sources});
  return () => {};
};

test('short pages continue, with an independent history position for each search term', async () => {
  const filters: NostrFilter[] = [{search:'nature',limit:40},{search:'forest',limit:40}];
  const first = await readSearchPage(filters, [], relay(filter => result(filter.search === 'nature'
    ? [event('recent',100)] : [event('old',10,'forest')])));
  assert.deepEqual(first.cursors,[99,9]);
  const requested: NostrFilter[] = [];
  const second = await readSearchPage(filters, first.cursors, relay(filter => {
    requested.push(filter);
    return result(filter.search === 'nature' ? [event('middle',50)] : []);
  }));
  assert.deepEqual(requested.map(filter=>filter.until),[99,9]);
  assert.deepEqual(second.events.map(event=>event.id),['middle']);
  assert.deepEqual(second.cursors,[49,null]);
});

test('ignored full-text filters still advance and overlapping results are deduplicated', async () => {
  const filters = [{search:'nature',limit:40},{search:'forest',limit:40}];
  const page = await readSearchPage(filters, [], relay(() => result([
    event('shared',40,'nature forest'), event('unrelated',30,'bitcoin'),
  ])));
  assert.deepEqual(page.events.map(event=>event.id),['shared']);
  assert.deepEqual(page.cursors,[29,29]);
  const ignored = await readSearchPage(filters,page.cursors,relay(()=>result([event('ignored',20,'bitcoin')])));
  assert.deepEqual(ignored.events,[]);
  assert.deepEqual(ignored.cursors,[19,19]);
});

test('empty responses end history, but an unavailable relay leaves the page retryable', async () => {
  const filters = [{search:'nature'},{search:'forest'}];
  const page = await readSearchPage(filters,[50,40],relay(filter=>result([],filter.search==='nature')));
  assert.deepEqual(page.cursors,[null,40]);
  await assert.rejects(readSearchPage(filters,page.cursors,relay(()=>result([],false))),/No search relay responded/);
  const finished = await readSearchPage(filters,page.cursors,relay(()=>result([])));
  assert.deepEqual(finished.cursors,[null,null]);
});

test('matches are shown as each relay delivers them, before a silent relay ends the page', async () => {
  const histories: Parameters<OpenSearch>[1][] = [], shown: string[] = [];
  let settled = false;
  const page = readSearchPage([{search:'nature',limit:2}], [], (_, history) => { histories.push(history); return () => {}; },
    events => shown.push(...events.map(event => event.id)));
  void page.then(() => { settled = true; });
  histories[0].onEvent(event('first',90));
  histories[0].onEvent(event('first',90));
  histories[0].onEvent(event('second',80));
  histories[0].onEvent(event('sparse',5));
  await Promise.resolve();
  assert.deepEqual(shown,['first','second']);
  assert.equal(settled,false);
  histories[0].onEose({sources:[{complete:true},{complete:false}]});
  // Older results continue below the newest full page, not below a sparse relay's old match.
  assert.deepEqual((await page).cursors,[79]);
});

test('a replaced search closes its relay requests', async () => {
  const controller = new AbortController();
  let closed = 0;
  const page = readSearchPage([{search:'nature'}], [], () => () => { closed++; }, undefined, controller.signal);
  controller.abort();
  await assert.rejects(page,/interrupted/);
  assert.equal(closed,1);
});

test('a literal topic search also retrieves hashtagged discussions without the model', () => {
  const filters = relayFilters(planPostSearch('Nature'),noExpansion);
  assert.ok(filters.some(filter=>filter.search==='Nature'));
  assert.deepEqual(filters.find(filter=>filter['#t'])?.['#t'],['nature']);
});
