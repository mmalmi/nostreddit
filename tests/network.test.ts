import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import type { NostrEvent } from 'nostr-pubsub';
import { asPost, matchesTopic, postDraft, commentDraft, resolveCommunityThreads } from '../src/lib/posts';
import { mergeChanges } from '../src/lib/local-writes';
import { nhashEncode } from '@hashtree/core';
import { account, exportKey, importAccount, signOut, start, loadNotifications, notifications, signInExtension, signEvent } from '../src/lib/network';
import { visibilitySettings } from '../src/lib/visibility';
import { setShowClientTag } from '../src/lib/client-tag';
import type { Request, Response } from '../src/lib/relayTypes';

const secret = generateSecretKey(), pubkey = getPublicKey(secret);
const sign = (draft: Omit<EventTemplate,'created_at'>, time = Math.floor(Date.now()/1000)) =>
  finalizeEvent({...draft, created_at:time},secret);

test('attributes public posts and both reply formats, respecting the posting preference', () => {
  const photo = asPost(sign({kind:20, content:'Photo', tags:[['client','other']]}))!;
  const comment = asPost(sign(commentDraft(photo,'First reply')))!;
  const note = asPost(sign({kind:1, content:'Note', tags:[['client','other']]}))!;
  try {
    for (const enabled of [true, false]) {
      setShowClientTag(enabled);
      for (const draft of [postDraft({body:'Hello'}), ...[note, photo, comment].map(parent => commentDraft(parent,'Reply'))]) {
        assert.deepEqual(sign(draft).tags.filter(t => t[0] === 'client'), enabled ? [['client','nostreddit']] : []);
      }
    }
  } finally { setShowClientTag(true); }
});

test('a submitted thread remains legible in plain Nostr clients and preserves its URL and topic', () => {
  const draft = postDraft({topic:'Art',title:'Ink study',body:'Drawn from life.',url:'https://example.org/study'});
  const post = asPost(sign(draft))!;
  assert.equal(post.topic,'art'); assert.equal(post.title,'Ink study');
  assert.equal(post.body,'Drawn from life.\n\nhttps://example.org/study');
  assert.equal(post.url,'https://example.org/study');
  assert.ok(post.event.content.startsWith('Ink study\n\n'));
  assert.equal(post.parent,'');
  assert.throws(() => postDraft({topic:'art',title:'X',body:'',url:'javascript:alert(1)'}));
});

test('NIP-10 replies preserve the original root, immediate parent and recipients', () => {
  const root = asPost(sign(postDraft({topic:'nostr',title:'Thread',body:''})))!;
  const direct = asPost(sign(commentDraft(root,'One')))!, nested = asPost(sign(commentDraft(direct,'Two')))!;
  assert.equal(direct.root,root.id); assert.equal(direct.parent,root.id);
  assert.equal(nested.root,root.id); assert.equal(nested.parent,direct.id);
  assert.deepEqual(nested.event.tags.filter(t=>t[0]==='p'),[['p',pubkey]]);
  assert.equal(nested.body,'Two');
  const mention = asPost(sign({kind:1,tags:[['e',root.id,'','mention']],content:'A standalone quote'}))!;
  assert.equal(mention.parent,'');
});

test('NIP-72 top-level NIP-22 threads and replies retain their community scope', () => {
  const address = '34550:'+pubkey+':music';
  const post = asPost(sign({kind:1111,content:'Record of the week',tags:[['A',address],['a',address],['K','34550'],['k','34550'],['P',pubkey]]}))!;
  assert.equal(post.topic,'general'); assert.equal(post.root,'');
  assert.equal(matchesTopic(post,'music'),false);
  const reply = asPost(sign(commentDraft(post,'Nice pick')))!;
  assert.equal(reply.parent,post.id); assert.equal(reply.root,post.id);
  assert.ok(reply.event.tags.some(t => t[0] === 'A' && t[1] === address));
  const nested = asPost(sign(commentDraft(reply,'Thanks')))!;
  const deep = asPost(sign(commentDraft(nested,'You’re welcome')))!;
  const unordered = new Map([deep,nested,reply].map(p=>[p.id,p]));
  resolveCommunityThreads(unordered);
  assert.equal(unordered.get(deep.id)?.root,post.id);
  assert.equal(unordered.get(nested.id)?.root,post.id);
  assert.equal(asPost({...post.event,created_at:1e20}),undefined);
});

test('rebase changes over newer contact, mute and metadata records without modifying unrelated fields', () => {
  const key=getPublicKey(generateSecretKey()), other=getPublicKey(generateSecretKey());
  const follow=sign({kind:3,tags:[['p',other,'wss://example.org','alias'],['t','old']],content:'{"relays":true}'});
  const change={kind:3 as const,key,enabled:true};
  assert.deepEqual(mergeChanges(3,[change],follow),{kind:3,tags:[...follow.tags,['p',key]],content:follow.content});
  assert.deepEqual(mergeChanges(3,[change,{...change,enabled:false}],follow).tags,follow.tags);
  const mute=sign({kind:10000,tags:[['word','quiet']],content:'opaque private section'});
  assert.deepEqual(mergeChanges(10000,[{...change,kind:10000}],mute),{kind:10000,tags:[...mute.tags,['p',key]],content:mute.content});
  const profile=sign({kind:0,tags:[],content:'{"name":"Tern","unfamiliar":{"nested":1}}'});
  assert.deepEqual(JSON.parse(mergeChanges(0,[{kind:0,fields:{about:'Field notes'}}],profile).content),
    {name:'Tern',unfamiliar:{nested:1},about:'Field notes'});
});

test('profile edits keep untouched raw numbers and tags and detect overlapping edits', () => {
  const base = sign({kind:0,tags:[['i','custom',''],['i','custom','']],content:'{"display_name":"Original","count":9007199254740993,"custom":[1,true]}'});
  const merged = mergeChanges(0,[{kind:0,fields:{custom:undefined,display_name:'Updated'},previous:{custom:[1,true],display_name:'Original'}}],base);
  assert.match(merged.content,/9007199254740993/);
  assert.equal(JSON.parse(merged.content).custom,undefined);
  assert.deepEqual(merged.tags,base.tags);
  assert.throws(() => mergeChanges(0,[{kind:0,fields:{display_name:'Updated'},previous:{display_name:'Old'}}],base),/reopen the editor/);
});

test('queued profile edits retain exact nested numbers and detect precision-only conflicts', () => {
  const old = '9007199254740992', next = '[9007199254740993,1.000000000000000000001,1e-800]';
  const head = {...finalizeEvent({kind:0,tags:[],created_at:1,content:"{}"},generateSecretKey()), kind:0, content:'{"count":'+old+'}'};
  const row = {kind:0 as const, encoding:'raw-json' as const, fields:{count:next}, previous:{count:old}};
  assert.equal(mergeChanges(0,[row],head).content,'{"count":'+next+'}');
  assert.throws(()=>mergeChanges(0,[row],{...head,content:'{"count":9007199254740993}'}),/Profile changed/);
});

test('topic feeds use tags regardless of community addresses', () => {
  const tags=[['t','bitcoin'],['t','mostro']];
  const note=asPost(sign({kind:1,content:'Market notes',tags}))!;
  assert.equal(note.topic,'bitcoin');
  assert.ok(matchesTopic(note,'mostro')); assert.ok(matchesTopic(note,'bitcoin'));
  assert.equal(matchesTopic(note,'nostr'),false);
  for(const marker of ['a','A']) {
    const scoped=asPost(sign({kind:1,content:'Market notes',tags:[...tags,[marker,'34550:'+pubkey+':bitcoin']]}))!;
    assert.ok(matchesTopic(scoped,'mostro'));
    assert.ok(matchesTopic(scoped,'bitcoin'));
    const addressOnly=asPost(sign({kind:1,content:'Market notes',tags:[[marker,'34550:'+pubkey+':bitcoin']]}))!;
    assert.equal(matchesTopic(addressOnly,'bitcoin'),false);
  }
});

test('post links can carry a Hashtree attachment in a signed note', () => {
  const root=nhashEncode({hash:new Uint8Array(32).fill(7)});
  const post=asPost(sign(postDraft({topic:'art',title:'Fresco',body:'',url:root+'/fresco.jpg'})))!;
  const link='htree://'+root+'/fresco.jpg';
  assert.equal(post.url,link); assert.equal(post.body,link);
  assert.deepEqual(post.event.tags.find(t=>t[0]==='r'),['r',link]);
  assert.throws(()=>postDraft({topic:'art',title:'X',body:'',url:'https://elsewhere.test/%6ehash1'+root.slice(6)}));
});

test('media-first notes use the author’s caption and preserve a standalone link', () => {
  const url = 'https://files.example/' + 'a'.repeat(64) + '.png', caption = 'New version is out.';
  const imeta = ['imeta', 'url ' + url, 'alt An app on a phone'];
  for (const text of [url+'\n\n'+caption, url+' '+caption, caption+' '+url]) {
    const post = asPost(sign({kind:1, content:text+'\n\n* Native apps\n\nhttps://product.example', tags:[imeta]}))!;
    assert.equal(post.title, caption);
    assert.equal(post.body, '* Native apps\n\nhttps://product.example');
    assert.equal(post.event.content.startsWith(text), true);
  }
  for (const [kind,content] of [[1,url],[20,'']] as const) {
    const post = asPost(sign({kind,content,tags:[imeta]}))!;
    assert.equal(post.title, '');
    assert.equal(post.body, '');
  }
  assert.equal(asPost(sign({kind:1,content:url,tags:[imeta,['subject','Official title']]}))!.title,'Official title');
});

test('native picture and video posts accept metadata-only attachments and replies use their event scope', () => {
  for (const kind of [20,21,22]) {
    const post=asPost(sign({kind,content:'',tags:[['t','art'],['imeta','url https://files.example/item','m '+(kind===20?'image/jpeg':'video/mp4')]]}))!;
    assert.ok(post);
    const reply=asPost(sign(commentDraft(post,'Quite a view')))!;
    assert.equal(reply.root,post.id); assert.equal(reply.parent,post.id);
    assert.ok(reply.event.tags.some(t=>t[0]==='K' && t[1]===String(kind)));
  }
});

test('notifications respect graph policy and a signer cannot finish after switching profiles', async () => {
  const memory = new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    setItem:(key:string,value:string) => memory.set(key,value),removeItem:(key:string)=>memory.delete(key)}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:Object.assign(new EventTarget(),{visibilityState:'visible',hidden:true})});
  Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  const target = getPublicKey(generateSecretKey());
  const baseTime = Math.floor(Date.now()/1000);
  let receiver: MockWorker;
  class MockWorker {
    constructor() {receiver = this;}
    onmessage?: (event:{data:Response}) => void;
    postMessage(_request:Request) {}
    terminate() {}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:MockWorker});
  const stop=start();
  await importAccount(nsecEncode(secret));
  assert.equal(get(account)?.pubkey,pubkey); assert.equal(exportKey(),nsecEncode(secret));
  const close = loadNotifications(pubkey);
  const peerSecret = generateSecretKey();
  const peerNote = (kind:number,pub:string,time:number) => finalizeEvent({kind,tags:[['p',pub]],content:'Hi',created_at:time},peerSecret);
  const recent = peerNote(1,pubkey,baseTime), older = peerNote(7,pubkey,baseTime-10);
  receiver!.onmessage?.({data:{type:'events',events:[older,recent,recent,peerNote(9735,pubkey,baseTime),peerNote(1,target,baseTime),sign({kind:1,tags:[['p',pubkey]],content:'Self'})]}});
  assert.deepEqual(get(notifications),[], 'default distance cannot admit unknown senders while the graph is loading');
  visibilitySettings.set({maxDistance:null,hideOvermuted:false});
  assert.deepEqual(get(notifications).map(e=>e.id),[recent.id,older.id]);
  signOut();
  assert.deepEqual(get(notifications),[]);
  close(); stop(); assert.equal(get(account),null); assert.deepEqual([...memory.keys()],['nostreddit.ui.graphVisibility']);

  let release: (()=>void) | undefined;
  const signDelay = new Promise<void>(resolve => release = resolve);
  Object.defineProperty(globalThis,'window',{configurable:true,value:{nostr:{
    getPublicKey:async()=>pubkey,
    signEvent:async(draft:EventTemplate)=>{await signDelay; return finalizeEvent(draft,secret);},
  }}});
  await signInExtension();
  const inFlight = signEvent({kind:1,content:'Wait for the signer',tags:[],created_at:baseTime});
  signOut(); release?.();
  await assert.rejects(inFlight,/profile changed/i);
});
