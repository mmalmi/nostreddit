import test from 'node:test';
import assert from 'node:assert/strict';
import { asPost, matchesTopic, type Post } from '../src/lib/posts';
import { hotScores, rankHot, hotQuery, hotCandidates, hotMeaningText, type HotSignal } from '../src/lib/hot';

const now=Math.floor(Date.now()/1000);
const key=(n:number)=>n.toString(16).padStart(64,'0');
function post(n:number,hours=1,author=n,title='Discussion '+n,topic='nostr'):Post {
  return asPost({id:key(n),pubkey:key(author),sig:'',kind:1,created_at:now-hours*3600,
    content:title,tags:[['subject',title],['t',topic]]})!;
}
function likes(post:Post,count:number,age=1):HotSignal[] {
  return Array.from({length:count},(_,n)=>({target:post.id,actor:key(1000+n),at:now-age*3600,kind:'like'}));
}
test('Hot promotes an active discussion over a newer empty post, and lets old hits fade',()=>{
  const quiet=post(1,.1),conversation=post(2,5),old=post(3,24*12);
  const ranking=rankHot([quiet,conversation,old],{now,signals:[...likes(conversation,8),...likes(old,500,24*10)]});
  assert.deepEqual(ranking.map(p=>p.id),[conversation.id,quiet.id,old.id]);
});
test('repeated likes, replies, self-replies and zap amounts cannot manufacture a crowd',()=>{
  const a=post(1),b=post(2);
  const repeated:HotSignal[]=Array.from({length:100},()=>({target:a.id,actor:key(9),at:now,kind:'reply'}));
  repeated.push(...Array.from({length:100},()=>({target:a.id,actor:a.pubkey,at:now,kind:'reply' as const})));
  const signals=[...repeated,...likes(b,4),{target:a.id,actor:key(9),at:now,kind:'like' as const}];
  assert.equal(rankHot([a,b],{now,signals})[0].id,b.id);
  const score=hotScores([a],{now,signals})[0].score;
  assert.equal(hotScores([a],{now,signals:[...signals,{target:a.id,actor:key(9),at:now,kind:'zap'}]})[0].score,score);
});
test('unique replies have half weight and weakly connected campaigns cannot overwhelm a direct follow',()=>{
  const campaign=post(1),endorsed=post(2);
  const replies:HotSignal[]=Array.from({length:300},(_,n)=>({target:campaign.id,actor:key(2000+n),at:now,kind:'reply'}));
  const directLike:HotSignal={target:endorsed.id,actor:key(8),at:now,kind:'like'};
  assert.equal(rankHot([campaign,endorsed],{now,signals:[...replies,directLike],follows:new Set([key(8)]),influence:()=>.001})[0],endorsed);
  const reply={target:campaign.id,actor:key(9),at:now,kind:'reply' as const};
  const options={now,follows:new Set([key(9)])};
  assert.equal(hotScores([campaign],{...options,signals:[reply]})[0].engagement,.7);
  assert.equal(hotScores([campaign],{...options,signals:Array(100).fill(reply)})[0].engagement,.7);
  assert.equal(hotScores([campaign],{...options,signals:[reply,{...reply,kind:'like'},{...reply,kind:'zap'}]})[0].engagement,1.4);
  const signals=likes(campaign,15);
  const narrow=hotScores([campaign],{now,signals,distance:()=>2,knownBy:()=>1})[0].engagement;
  const broad=hotScores([campaign],{now,signals,distance:()=>2,knownBy:()=>20})[0].engagement;
  assert.ok(broad>5*narrow);
});
test('fresh signals from close people carry more weight; malformed future signals carry none',()=>{
  const a=post(1),b=post(2),signals=[...likes(a,1),{target:b.id,actor:key(8),at:now-3600,kind:'like' as const}];
  assert.equal(rankHot([a,b],{now,signals,follows:new Set([key(8)])})[0].id,b.id);
  assert.equal(hotScores([a],{now,signals:[{...signals[0],at:now+99999}]})[0].engagement,0);
});
test('a prolific author and duplicate content do not occupy the whole first page',()=>{
  const flood=Array.from({length:20},(_,n)=>post(n+1,1,1,'Identical announcement repeated across the whole timeline'));
  const others=Array.from({length:8},(_,n)=>post(n+30,1.1));
  const first=rankHot([...flood,...others],{now}).slice(0,8);
  assert.ok(new Set(first.map(p=>p.pubkey)).size>=7);
  assert.equal(first.filter(p=>p.pubkey===key(1)).length,1);
});
test('a fresh unanswered post gets a discovery slot without letting an old empty post win',()=>{
  const popular=Array.from({length:8},(_,n)=>post(n+1,3));
  const fresh=post(20,.2),old=post(21,200);
  const signals=popular.flatMap(p=>likes(p,10));
  const ranked=rankHot([...popular,old,fresh],{now,signals});
  assert.equal(ranked[4].id,fresh.id);assert.equal(ranked.at(-1)?.id,old.id);
});
test('local interests and semantic matches are boosts, never membership or visibility filters',()=>{
  const a=post(1),b=post(2),outside=post(3,1,3,'Outside community','bitcoin');
  const input=[a,b,outside].filter(p=>matchesTopic(p,'nostr'));
  const result=rankHot(input,{now,topic:'nostr',ai:new Map([[b.id,1],[outside.id,1]])});
  assert.equal(result[0].id,b.id);assert.deepEqual(new Set(result),new Set(input));
  assert.equal(rankHot(input,{now,ai:new Map([[a.id,NaN],[b.id,Infinity]])}).length,2);
  assert.equal(hotQuery('nostr','landscape photography',[],[]),'landscape photography');
  assert.equal(hotQuery('open-source','',[],[]),'open source');
  assert.equal(hotQuery('','',[],[]),'');
});
test('seen posts are downweighted without disappearing, and results are deterministic',()=>{
  const a=post(1),b=post(2);
  const options={now,seen:new Set([a.id])};
  assert.deepEqual(rankHot([a,b],options),[b,a]);assert.deepEqual(rankHot([b,a],options),[b,a]);
});
test('AI can find an interest outside social leaders and outweigh an unrelated viral post',()=>{
  const viral=post(1,12),related=post(99,1,99,'Building open-source software on Nostr');
  const pool=[viral,...Array.from({length:70},(_,i)=>post(i+2,.1)),related];
  const signals=likes(viral,70);
  const social=rankHot(pool,{now,signals});
  assert.ok(social.indexOf(related)>=48);
  assert.ok(hotCandidates(pool,social,'Nostr open-source software').includes(related));
  const ai=new Map(pool.map(post=>[post.id,post===related?.4:0]));
  assert.equal(rankHot(pool,{now,signals,ai})[0],related);
});
test('hashtag-only posts and greetings cannot masquerade as semantic recommendations',()=>{
  for(const title of ['GM #nostr','#nostr #software #opensource #ai','12:45 @ 974,553 #bitcoin #nostr']) {
    const greeting=post(1,1,1,title);
    assert.equal(hotMeaningText(greeting),'');
    assert.deepEqual(hotCandidates([greeting],[greeting],'Nostr software'),[]);
    assert.deepEqual(rankHot([greeting],{now}),[greeting]);
  }
  assert.equal(hotMeaningText(post(2,1,2,'Building a relay with open-source software #nostr')),'Building a relay with open-source software');
  const pool=[post(1),post(2,.5),post(3,2)];
  assert.deepEqual(rankHot(pool,{now,ai:new Map([[pool[0].id,.05],[pool[1].id,0],[pool[2].id,.1]])}),rankHot(pool,{now}));
});
test('a full local window ranks quickly without quadratic graph calls',t=>{
  const posts=Array.from({length:700},(_,n)=>post(n+1,n/100,n%80+1));
  const signals=posts.slice(0,100).flatMap(p=>likes(p,20));
  let calls=0;
  const start=performance.now();
  const result=rankHot(posts,{now,signals,distance:()=>{calls++;return 2;}});
  const ms=performance.now()-start;
  assert.equal(result.length,700);assert.ok(calls<=800);assert.ok(ms<250,`ranking took ${ms}ms`);
  t.diagnostic(`700 posts, 2000 signals: ${ms.toFixed(1)} ms`);
});
