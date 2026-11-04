import test from 'node:test';
import assert from 'node:assert/strict';
import {SocialGraph} from 'nostr-social-graph';
import {createGraphRanker} from '../src/lib/graph-ranking';
const key=(n:number)=>n.toString(16).padStart(64,'0');
function graph(){const g=new SocialGraph(key(0));g.addFollower(key(0),key(1));g.addFollower(key(1),key(2));return g;}
test('ranking is opt-in, cached by graph/root/revision, and disabled work releases the result',async()=>{
  const g=graph(),ranker=createGraphRanker();
  await ranker.update(g,key(0),{},0,false);assert.equal(ranker.calculations,0);assert.equal(ranker.weight(key(2)),undefined);
  await ranker.update(g,key(0),{},0,true);const score=ranker.weight(key(2))!;assert.ok(score>0);assert.equal(ranker.calculations,1);
  for(let i=0;i<100;i++){await ranker.update(g,key(0),{},0,true);ranker.weight(key(i));}
  assert.equal(ranker.calculations,1);
  g.removeFollower(key(1),key(2));await ranker.update(g,key(0),{},1,true);assert.equal(ranker.weight(key(2)),0);assert.equal(ranker.calculations,2);
  await ranker.update(g,key(0),{},1,false);assert.equal(ranker.weight(key(1)),undefined);
});
test('pending offline mutes suppress a whole exclusive branch and undo restores it without graph mutation',async()=>{
  const g=graph(),ranker=createGraphRanker();
  await ranker.update(g,key(0),{},0,true);const before=ranker.weight(key(2));
  await ranker.update(g,key(0),{[key(1)]:true},0,true);assert.equal(ranker.weight(key(2)),0);
  assert.equal(g.getMutedByUser(key(0)).size,0);
  await ranker.update(g,key(0),{[key(1)]:false},0,true);assert.equal(ranker.weight(key(2)),before);
});
test('personal mutes apply when discovery uses a different public root',async()=>{
  const g=graph(),ranker=createGraphRanker();
  await ranker.update(g,key(99),{[key(1)]:true},0,true);assert.equal(ranker.weight(key(2)),0);
  assert.equal(g.getInternalData().ids.has(key(99)),false);
  await ranker.update(g,key(99),{},0,true);assert.ok(ranker.weight(key(2))!>0);
});
