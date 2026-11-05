import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { get, writable } from 'svelte/store';
import { asPost, type Post } from '../src/lib/posts';
import { TopicCatalog, type CatalogSnapshot } from '../src/lib/topic-catalog';
import { seenTopics, startTopicCatalog } from '../src/lib/topic-catalog-store';

const storageKey='nostreddit.ui.seenTopics.v1';
const now=1_700_000_000;
const key=(n:number)=>n.toString(16).padStart(64,'0');
function post(author:number,tag:string,reply=false):Post {
  return asPost({id:key(author),pubkey:key(author),created_at:now,kind:1,content:'A discussion',sig:'',
    tags:[['t',tag],...(reply ? [['e',key(100),'','root']] : [])]})!;
}

function setup(t:TestContext) {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:now*1000});
  const memory=new Map<string,string>(), window=new EventTarget(), document=Object.assign(new EventTarget(),{hidden:false});
  const storage={blocked:false,writes:0,getItem:(name:string)=>memory.get(name) ?? null,setItem:(name:string,value:string)=>{
    storage.writes++;
    if(storage.blocked)throw new Error('Storage unavailable');
    memory.set(name,value);
  }};
  const globals={window,document,localStorage:storage};
  const previous=new Map(Object.keys(globals).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const [name,value] of Object.entries(globals))Object.defineProperty(globalThis,name,{configurable:true,value});
  const stops=new Set<()=>void>();
  seenTopics.set([]);
  t.after(()=>{
    for(const stop of stops)stop();
    for(const [name,descriptor] of previous) {
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);
      else Reflect.deleteProperty(globalThis,name);
    }
    seenTopics.set([]);
  });
  return {memory,storage,window,document,
    saved:()=>JSON.parse(memory.get(storageKey) ?? 'null') as CatalogSnapshot | null,
    remote:(snapshot:CatalogSnapshot)=>{
      memory.set(storageKey,JSON.stringify(snapshot));
      window.dispatchEvent(Object.assign(new Event('storage'),{key:storageKey}));
    },
    start:(roots:Post[]=[],replies:Post[]=[],allowed=(pubkey:string)=>true)=>{
      const posts=writable(roots), comments=writable(replies), policy=writable(allowed), authors=new Set<string>();
      const stop=startTopicCatalog(posts,comments,policy,keys=>keys.forEach(key=>authors.add(key)));
      stops.add(stop);
      return {posts,comments,policy,authors,stop:()=>{stop();stops.delete(stop);}};
    }
  };
}

test('pagehide saves pending tags and author references, restoring them without feed history',t=>{
  const app=setup(t), first=app.start([post(1,'gardens'),post(3,'hidden')],[post(2,'gardens',true)],author=>author!==key(3));
  // Neither the observation timer nor the batched save has run yet.
  app.window.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(app.saved(),{version:1,authors:[key(1),key(2)],tags:[['gardens',[[0,now],[1,now]]]]});
  first.stop();
  const restored=app.start();
  t.mock.timers.tick(80);
  assert.deepEqual([...restored.authors],[key(1),key(2)]);
  assert.deepEqual(get(seenTopics),[{slug:'gardens',authors:2,latest:now}]);
  restored.policy.set(author=>author!==key(2));t.mock.timers.tick(80);
  assert.equal(get(seenTopics)[0].authors,1);
  restored.policy.set(()=>true);t.mock.timers.tick(80);
  assert.equal(get(seenTopics)[0].authors,2);
});

test('hiding or stopping the app flushes pending observations immediately',t=>{
  const app=setup(t), session=app.start([post(1,'art')]);
  app.document.hidden=true;app.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(app.saved()?.authors,[key(1)]);
  session.comments.set([post(2,'music',true)]);
  session.stop();
  assert.deepEqual(app.saved()?.authors,[key(1),key(2)]);
  const writes=app.storage.writes;
  t.mock.timers.tick(10_000);
  assert.equal(app.storage.writes,writes,'cleanup leaves no pending saves');
});

test('a failed save retries on later activity even without new tags or authors',t=>{
  const app=setup(t), session=app.start([post(1,'art')]);
  app.storage.blocked=true;
  t.mock.timers.tick(80);t.mock.timers.tick(1000);
  assert.equal(app.saved(),null);
  assert.equal(get(seenTopics)[0].slug,'art');
  const attempts=app.storage.writes;
  t.mock.timers.tick(10_000);
  assert.equal(app.storage.writes,attempts,'unavailable storage does not trigger background retry loops');
  app.storage.blocked=false;
  session.posts.set([post(1,'art')]);
  t.mock.timers.tick(80);t.mock.timers.tick(1000);
  assert.deepEqual(app.saved()?.authors,[key(1)]);
});

test('a competing tab cannot permanently replace locally seen tags or authors',t=>{
  const app=setup(t), session=app.start([post(1,'art')]);
  t.mock.timers.tick(80);t.mock.timers.tick(1000);
  const other=new TopicCatalog();other.observe([post(2,'art'),post(2,'music')],now);
  // A competing writer read an older snapshot, then overwrote this tab's save.
  app.remote(other.snapshot());
  assert.ok(session.authors.has(key(2)));
  t.mock.timers.tick(1000);
  assert.deepEqual(app.saved()?.authors,[key(1),key(2)]);
  assert.deepEqual(app.saved()?.tags,[['art',[[0,now],[1,now]]],['music',[[1,now]]]]);
  app.remote(other.snapshot());t.mock.timers.tick(1000);
  assert.deepEqual(app.saved()?.authors,[key(1),key(2)],'repair also works when no new evidence was merged');
  const writes=app.storage.writes;
  app.remote(app.saved()!);t.mock.timers.tick(2000);
  assert.equal(app.storage.writes,writes,'equal snapshots do not cause cross-tab write loops');
  session.stop();app.start();t.mock.timers.tick(80);
  assert.deepEqual(get(seenTopics).map(({slug,authors})=>[slug,authors]),[['art',2],['music',1]]);
});

test('authors merged while saving are registered for visibility checks',t=>{
  const app=setup(t), session=app.start([post(1,'art')]);
  t.mock.timers.tick(80);
  const other=new TopicCatalog();other.observe([post(2,'music')],now);
  app.memory.set(storageKey,JSON.stringify(other.snapshot()));
  t.mock.timers.tick(1000);
  assert.ok(session.authors.has(key(2)));
  assert.deepEqual(app.saved()?.authors,[key(1),key(2)]);
});
