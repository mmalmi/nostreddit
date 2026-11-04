import assert from 'node:assert/strict';
import test from 'node:test';
import { TopicCatalog, catalogLimits } from '../src/lib/topic-catalog';
import { asPost, type Post } from '../src/lib/posts';

const now=1_700_000_000;
const key=(n:number)=>n.toString(16).padStart(64,'0');
function post(author:number,tags:string[],at=now):Post {
  return asPost({id:key(author),pubkey:key(author),created_at:at,kind:1,content:'A discussion',sig:'',tags:tags.map(tag=>['t',tag])})!;
}

test('popularity counts distinct authors, normalizes tags and does not invent general',()=>{
  const catalog=new TopicCatalog();
  catalog.observe([post(1,['Art','art']),post(1,['art']),post(2,['music']),post(3,['music']),post(4,[])],now);
  assert.deepEqual(catalog.entries(()=>true,now).map(t=>[t.slug,t.authors]),[['music',2],['art',1]]);
  assert.equal(catalog.observe([post(1,['art'])],now),false);
  assert.deepEqual(catalog.entries(k=>k!==key(2),now).map(t=>t.authors),[1,1]);
  assert.equal(catalog.entries(()=>false,now).length,0);
});

test('compact dictionary survives reloads and merging independent author IDs',()=>{
  const a=new TopicCatalog(),b=new TopicCatalog();
  a.observe([post(1,['art','music'])],now);b.observe([post(2,['art'])],now);
  const stored=JSON.parse(JSON.stringify(a.snapshot()));
  assert.deepEqual(stored.authors,[key(1)]);
  assert.deepEqual(stored.tags,[['art',[[0,now]]],['music',[[0,now]]]]);
  const restored=new TopicCatalog();restored.merge(stored,now);restored.merge(b.snapshot(),now);
  assert.equal(restored.entries(()=>true,now)[0].authors,2);
  assert.equal(restored.merge(stored,now),false);
  assert.equal(restored.entries(()=>true,now+31*86400).length,0);
  restored.observe([],now+31*86400);
  assert.deepEqual(restored.snapshot(),{version:1,authors:[],tags:[]});
});

test('malformed storage and future or expired observations cannot inflate counts',()=>{
  const catalog=new TopicCatalog();
  for(const value of [null,{},[],{version:2},{version:1,authors:'no',tags:[]}])assert.equal(catalog.merge(value,now),false);
  catalog.merge({version:1,authors:[key(1),'bad'],tags:[['art',[[0,now],[1,now],[10,now],[-1,now],[0,now+1]]],['invalid/tag',[[0,now]]],['old',[[0,now-31*86400]]]]},now);
  assert.deepEqual(catalog.entries(()=>true,now).map(t=>[t.slug,t.authors]),[['art',1]]);
});

test('catalog bounds authors, tags, pairs and serialized size under a large influx',()=>{
  const catalog=new TopicCatalog();
  const posts=Array.from({length:4000},(_,i)=>post(i+1,Array.from({length:20},(_,j)=>'tag'+((i+j)%700)),now-i));
  catalog.observe(posts,now);
  const snapshot=catalog.snapshot();
  assert.ok(snapshot.authors.length<=catalogLimits.authors);
  assert.ok(snapshot.tags.length<=catalogLimits.tags);
  assert.ok(snapshot.tags.every(([,users])=>users.length<=catalogLimits.perTag));
  assert.ok(snapshot.tags.reduce((n,[,users])=>n+users.length,0)<=catalogLimits.pairs);
  assert.ok(JSON.stringify(snapshot).length<400_000);
  const crowded=new TopicCatalog();crowded.observe(Array.from({length:100},(_,i)=>post(i+1,['busy'])),now);
  assert.equal(crowded.entries(()=>true,now)[0].authors,64);
});
