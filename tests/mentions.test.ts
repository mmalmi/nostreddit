import test from 'node:test';
import assert from 'node:assert/strict';
import { bech32 } from '@scure/base';
import { neventEncode, nprofileEncode, noteEncode, npubEncode, nsecEncode } from 'nostr-tools/nip19';
import { noteParts, partText } from '../src/lib/mentions';
import { displayName } from '../src/lib/ui';

const id = 'ab'.repeat(32), pubkey = 'cd'.repeat(32);
const events = [noteEncode(id), neventEncode({id, author:pubkey, kind:1, relays:['wss://example.org']})];
const people = [npubEncode(pubkey), nprofileEncode({pubkey, relays:['wss://example.org']})];

test('Nostr URIs and bare identifiers resolve event and profile references amid punctuation', () => {
  for (const [identifiers, field, key] of [[events,'event',id],[people,'person',pubkey]] as const) {
    for (const identifier of identifiers) for (const value of [identifier,'nostr:'+identifier,'NOSTR:'+identifier.toUpperCase()]) {
      const text = 'See ('+value+'), then #Nostr.';
      const parts = noteParts(text,[]);
      assert.equal(parts.map(part=>part.text).join(''),text);
      assert.deepEqual(parts.filter(part=>part[field]).map(part=>part[field]),[key],value);
      assert.equal(parts.find(part=>part.topic)?.topic,'nostr');
    }
  }
  assert.equal(partText(noteParts('nostr:'+people[0],[])[0],{}),'@'+displayName(pubkey));
  const reference=noteParts('nostr:'+events[1],[])[0];
  assert.equal(partText(reference,{}),'[note]');
  assert.equal(partText(reference,{},new Map([[id,{pubkey}]])),'[note by '+displayName(pubkey)+']');
});

test('malformed, embedded, unsupported and wrong-length identifiers remain ordinary text', () => {
  const short = bech32.encode('note',bech32.toWords(new Uint8Array(31)),false);
  const shortPubkey = bech32.encode('npub',bech32.toWords(new Uint8Array(31)),false);
  for (const value of [
    'nostr:'+short,'nostr:'+shortPubkey,'nostr:'+events[0].slice(0,-4),
    'nostr:'+events[0]+'b','nostr:'+people[0]+'x','nostr:'+events[0]+'1',
    'nostr:'+events[0].slice(0,12).toUpperCase()+events[0].slice(12),
    'prefix'+events[0],people[0]+'_suffix',people[0]+'/file.txt',
    'nostr:'+nsecEncode(new Uint8Array(32).fill(1)),
  ]) {
    const parts = noteParts(value,[]);
    assert.equal(parts.map(part=>part.text).join(''),value);
    assert.equal(parts.some(part=>part.event || part.person || part.url),false,value);
  }
});

test('web URLs containing identifiers stay intact and untagged hashes stay text', () => {
  for (const identifier of [...events,...people]) {
    const url = 'https://example.org/'+identifier+'#nostr';
    assert.deepEqual(noteParts(url,[]),[{text:url,url}]);
  }
  assert.deepEqual(noteParts(pubkey,[]),[{text:pubkey}]);
  assert.deepEqual(noteParts(pubkey,[['p',pubkey]]),[{text:pubkey,person:pubkey}]);
});
