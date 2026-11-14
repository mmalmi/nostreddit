import assert from 'node:assert/strict';
import test from 'node:test';
import type { NostrEvent } from 'nostr-pubsub';
import { isBulkAddressed, isDirectNotificationReply } from '../src/lib/notification-audience';

const hex = (n:number) => n.toString(16).padStart(64,'0');
const viewer = hex(99), root = hex(100), parent = hex(101);
const event = (tags:string[][],kind=1):NostrEvent => ({tags,kind,content:'test',pubkey:hex(1),id:hex(2),sig:'',created_at:1});
const tags = Array.from({length:10},(_,i)=>['p',hex(i)]);
const unknown = () => undefined;

test('only text posts addressing more than ten distinct valid pubkeys are bulk',()=>{
  assert.equal(isBulkAddressed(event([...tags,tags[0],['P',viewer],['p','bad']])),false);
  const many = [...tags,['p',viewer]];
  for (const kind of [1,1111]) assert.equal(isBulkAddressed(event(many,kind)),true);
  for (const kind of [7,9735]) assert.equal(isBulkAddressed(event(many,kind)),false);
});

test('a direct reply uses its immediate parent and gives a known author priority',()=>{
  const markedRoot = ['e',root,'','root',viewer], other = hex(5);
  assert.equal(isDirectNotificationReply(event([markedRoot]),viewer,unknown),true);
  assert.equal(isDirectNotificationReply(event([markedRoot,['e',parent,'','reply',other]]),viewer,unknown),false);
  assert.equal(isDirectNotificationReply(event([markedRoot,['e',parent,'','reply',viewer]]),viewer,()=>other),false);
  assert.equal(isDirectNotificationReply(event([['e',root],['e',parent]]),viewer,id=>id===parent?viewer:other),true);
  assert.equal(isDirectNotificationReply(event([markedRoot,['e',parent]]),viewer,id=>id===root?viewer:other),false);
  assert.equal(isDirectNotificationReply(event([['e',root,'','mention',viewer]]),viewer,unknown),false);
  assert.equal(isDirectNotificationReply(event([['E',root,'',viewer],['e',parent,'',other],['p',viewer]],1111),viewer,unknown),false);
  assert.equal(isDirectNotificationReply(event([['E',root,'',other],['e',parent,'',viewer]],1111),viewer,unknown),true);
  assert.equal(isDirectNotificationReply(event([['a','30023:'+viewer+':article']],1111),viewer,unknown),true);
});
