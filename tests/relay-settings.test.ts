import test from 'node:test';
import assert from 'node:assert/strict';
import {readStoredRelayUrls, validateRelayUrls} from '../src/lib/relay-settings';
const defaults=['wss://relay.ditto.pub','wss://relay.damus.io'];

test('only absent relay preferences receive shipped defaults',()=>{
  assert.deepEqual(readStoredRelayUrls(()=>null,defaults),defaults);
  assert.deepEqual(readStoredRelayUrls(()=>'',defaults),[]);
  assert.deepEqual(readStoredRelayUrls(()=>'  \n ',defaults),[]);
  assert.deepEqual(readStoredRelayUrls(()=>'wss://private.example/\nws://localhost:4321',defaults),['wss://private.example','ws://localhost:4321']);
});
test('invalid or unreadable relay preferences remain offline without modifying storage',()=>{
  for(const saved of ['not a URL','https://relay.example','wss://user:password@relay.example','ws://remote.example','wss://valid.example\ninvalid'])
    assert.deepEqual(readStoredRelayUrls(()=>saved,defaults),[]);
  assert.deepEqual(readStoredRelayUrls(()=>{throw new Error('storage unavailable');},defaults),[]);
  assert.deepEqual(defaults,['wss://relay.ditto.pub','wss://relay.damus.io']);
});
test('editing relay settings retains address validation',()=>{
  assert.throws(()=>validateRelayUrls(''));
  assert.deepEqual(validateRelayUrls('wss://one.example/ wss://one.example'),['wss://one.example']);
});
