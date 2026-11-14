import assert from 'node:assert/strict';
import test from 'node:test';
import type { TopicPageEnd } from '../src/lib/relayTypes';
import { openTopicHistory, type TopicHistoryState } from '../src/lib/topic-history';

test('a fast relay pages independently while a partial relay retries the same range', () => {
  type Read = {relay: string; until?: number; live: boolean; done(page: TopicPageEnd): void; closed: boolean};
  const reads: Read[] = [];
  let state: TopicHistoryState = 'loading';
  const history = openTopicHistory(['fast','slow'], (relay, until, _limit, live, done) => {
    const read = {relay, until, live, done, closed:false};
    reads.push(read);
    return () => { read.closed = true; };
  }, next => { state = next; });
  const more = (until: number): TopicPageEnd => ({state:'more',until,limit:90,boundaryOnly:false});

  reads[0].done(more(90));
  assert.equal(state,'more');
  history.more();
  assert.equal(reads.length,3);
  assert.equal(reads[2].until,90);
  reads[2].done({state:'retry'});
  reads[1].done(more(5));
  history.more();
  assert.deepEqual(reads.slice(3).map(r => [r.relay,r.until]),[['fast',90],['slow',5]]);
  reads[3].done({state:'end'});
  reads[4].done({state:'end'});
  assert.equal(state,'end');
  assert.ok(reads.every(r => r.closed !== r.live));
  history.close();
  assert.ok(reads.every(r => r.closed));
});
