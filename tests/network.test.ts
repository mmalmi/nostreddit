import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type EventTemplate } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import type { NostrEvent } from 'nostr-pubsub';
import { asPost, postDraft, commentDraft, resolveCommunityThreads } from '../src/lib/posts';
import { account, exportKey, follow, importAccount, like, likes, mute, posts, publishPost, signOut, unlike, loadNotifications, notifications, signInExtension, signEvent } from '../src/lib/network';
import { visibilitySettings } from '../src/lib/visibility';
import type { Request, Response } from '../src/lib/relayTypes';

const secret = generateSecretKey(), pubkey = getPublicKey(secret);
const sign = (draft: Omit<EventTemplate,'created_at'>, time = Math.floor(Date.now()/1000)) =>
  finalizeEvent({...draft, created_at:time},secret);

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
  assert.equal(post.topic,'music'); assert.equal(post.root,'');
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

test('signed writes require acknowledgment and preserve follow tags and private mute contents', async () => {
  const memory = new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    setItem:(key:string,value:string) => memory.set(key,value),removeItem:(key:string)=>memory.delete(key)}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible', hidden:true}});
  const other = getPublicKey(generateSecretKey()), target = getPublicKey(generateSecretKey());
  const baseTime = Math.floor(Date.now()/1000);
  const previous = new Map<number,NostrEvent>([
    [3,sign({kind:3,tags:[['p',other,'wss://example.org','alias'],['t','old']],content:'{"relays":true}'},baseTime)],
    [10000,sign({kind:10000,tags:[['word','quiet']],content:'opaque encrypted private section'},baseTime)],
  ]);
  const sent:NostrEvent[] = [];
  let reject = true;
  let receiver: MockWorker;
  class MockWorker {
    constructor() {receiver = this;}
    onmessage?: (event:{data:Response}) => void;
    postMessage(request:Request) {
      queueMicrotask(() => {
        if (request.type === 'publish') {
          assert.ok(verifyEvent(request.event)); sent.push(request.event);
          this.onmessage?.({data:{type:'result',id:request.id, events:reject?[]:[request.event],...(reject?{error:'No relay accepted this action.'}:{})}});
        } else if (request.type === 'latest') {
          const event = previous.get(request.kind);
          this.onmessage?.({data:{type:'result',id:request.id,events:event?[event]:[]}});
        }
      });
    }
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:MockWorker});
  await importAccount(nsecEncode(secret));
  assert.equal(get(account)?.pubkey,pubkey); assert.equal(exportKey(),nsecEncode(secret));
  const input = {topic:'art',title:'Acknowledged',body:'Discussion'};
  await assert.rejects(publishPost(input),/No relay accepted/);
  assert.equal(get(posts).length,0);
  reject = false;
  const post = await publishPost(input);
  assert.ok(get(posts).some(p => p.id === post.id));
  assert.equal(sent[0].id,sent[1].id,'lost acknowledgments can retry the exact same event');
  await like(post); await like(post);
  assert.deepEqual(get(likes)[post.id],[pubkey]);
  assert.equal(sent.filter(event => event.kind===7).length,1);
  await unlike(post);
  assert.deepEqual(get(likes)[post.id],[]);
  await like(post);
  assert.deepEqual(get(likes)[post.id],[pubkey]);
  assert.equal(new Set(sent.filter(e => e.kind===7).map(e=>e.id)).size,2);
  await follow(target,true);
  const contact = sent.at(-1)!;
  assert.deepEqual(contact.tags,[...previous.get(3)!.tags,['p',target]]);
  assert.equal(contact.content,previous.get(3)!.content); assert.ok(contact.created_at>baseTime);
  await mute(target,true);
  assert.deepEqual(sent.at(-1)!.tags,[['word','quiet'],['p',target]]);
  assert.equal(sent.at(-1)!.content,'opaque encrypted private section');

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
  close(); assert.equal(get(account),null); assert.deepEqual([...memory.keys()],['nostreddit.ui.graphVisibility']);

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
