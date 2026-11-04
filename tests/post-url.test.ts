import test from 'node:test';
import assert from 'node:assert/strict';
import { bech32 } from '@scure/base';
import { noteEncode, neventEncode, npubEncode } from 'nostr-tools/nip19';
import { postIdFromPath, postUrl } from '../src/lib/post-url';
import { searchTarget } from '../src/lib/search';

const id = 'f0'.repeat(32);
const note = noteEncode(id);
const pointer = neventEncode({ id, relays:['wss://example.org'],kind:1 });

test('hex, note and nevent identify the same post, including when pasted into search', () => {
  assert.equal(postUrl(id),'/post/'+note);
  assert.equal(postUrl(id.toUpperCase(),'#Järvi'),'/post/'+note+'?r=j%C3%A4rvi');
  assert.equal(postUrl(id,'invalid/path'),'/post/'+note);
  for (const value of [id,id.toUpperCase(),note,note.toUpperCase(),pointer]) assert.equal(postIdFromPath(value),id);
  for (const value of [note,'nostr:'+note,pointer,'nostr:'+pointer]) assert.equal(searchTarget(value),'/post/'+note);
});

test('rejects malformed event paths, wrong entity types and note payloads of the wrong length', () => {
  const short = bech32.encode('note',bech32.toWords(new Uint8Array(31)),false);
  for (const value of ['',id.slice(1),short,note+'x',note.slice(0,-5),npubEncode(id),'not-an-event',note+'/extra','n'+note.slice(1).toUpperCase()]) {
    assert.equal(postIdFromPath(value),null,value);
  }
  assert.throws(()=>postUrl('invalid'),/event ID/);
  assert.equal(searchTarget('nostr:'+short),'');
});
