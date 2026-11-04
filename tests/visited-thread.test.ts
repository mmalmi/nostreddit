import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools/pure';
import { focusedThread, threadRecords } from '../src/lib/visited-threads';

const key = generateSecretKey();
function note(text: string, kind = 1, tags: string[][] = []) {
  return finalizeEvent({kind,content:text,tags,created_at:10},key);
}
const ref = (post:Event, marker:string) => ['e',post.id,'',marker];

test('only a focused discussion watch allocates a visited record', () => {
  const id = '1'.repeat(64);
  assert.equal(focusedThread([{ids:[id]},{kinds:[1,1111],'#e':[id],limit:180}]),id);
  assert.equal(focusedThread([{ids:[id]}]),undefined);
  assert.equal(focusedThread([{kinds:[7],'#e':[id]}]),undefined);
});

test('out-of-order reply events are retained only for their reachable branch', () => {
  const root = note('root'), first = note('first',1,[ref(root,'root')]);
  const child = note('child',1,[ref(root,'root'),ref(first,'reply')]);
  const grandchild = note('grandchild',1,[ref(root,'root'),ref(child,'reply')]);
  const sibling = note('other',1,[ref(root,'root')]), outside=note('unrelated post');
  const events = [grandchild,sibling,outside,child,root,first,grandchild];
  assert.deepEqual(threadRecords(first.id,events).map(e=>e.id),[first.id,child.id,grandchild.id]);
  assert.deepEqual(new Set(threadRecords(root.id,events).map(e=>e.id)), new Set([root,first,child,grandchild,sibling].map(e=>e.id)));
});

test('focused picture and video discussions and orphaned signed replies remain reachable', () => {
  const photo = note('a photo',20,[['imeta','url https://media.example/x.jpg']]);
  const orphan = note('reply',1,[ref(photo,'root'),['e','2'.repeat(64),'','reply']]);
  assert.deepEqual(threadRecords(photo.id,[orphan,photo]).map(e=>e.id),[photo.id,orphan.id]);
});
