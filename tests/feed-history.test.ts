import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeedPageEnd } from '../src/lib/relayTypes';
import { openFeedHistory, type FeedHistoryState } from '../src/lib/feed-history';

test('a fast relay pages independently while a partial relay retries the same range', () => {
  type Read = {relay: string; until?: number; live: boolean; done(page: FeedPageEnd): void; closed: boolean};
  const reads: Read[] = [];
  let state: FeedHistoryState = 'loading';
  const history = openFeedHistory(['fast','slow'], (relay, until, _limit, live, done) => {
    const read = {relay, until, live, done, closed:false};
    reads.push(read);
    return () => { read.closed = true; };
  }, next => { state = next; });
  const more = (until: number): FeedPageEnd => ({state:'more',until,limit:90,boundaryOnly:false});

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

test('overlapping relays have independent automatic page budgets and can continue manually', () => {
  const pages = new Map<string,(page:FeedPageEnd)=>void>();
  const counts = new Map<string,number>();
  let canFill = false;
  const history = openFeedHistory(['fast','slow'], (relay,_until,_limit,_live,done) => {
    counts.set(relay,(counts.get(relay) || 0)+1); pages.set(relay,done);
    return () => {};
  }, (_state,ready) => canFill=ready);
  const advance = (relay:string,until:number) => pages.get(relay)!({state:'more',until,limit:90,boundaryOnly:false});
  for (const relay of ['fast','slow']) {
    for (let i=0;i<4;i++) {
      advance(relay,100-i);
      assert.equal(canFill,true);
      history.more('automatic');
    }
    advance(relay,96);
    assert.equal(canFill,false);
    history.more('automatic');
    assert.equal(counts.get(relay),5);
  }
  history.more();
  assert.deepEqual([...counts.values()],[6,6]);
  history.close();
});
