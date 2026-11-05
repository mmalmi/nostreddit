import test from 'node:test';
import assert from 'node:assert/strict';
import {graphRelayPolicy} from '../src/lib/graph-relays';
import {relayUrls} from '../src/lib/relayTypes';
const defaults=['wss://a.example','wss://b.example'];
test('graph catch-up uses only the configured scope and public bootstrap only with shipped defaults',()=>{
  assert.deepEqual(graphRelayPolicy(['wss://b.example/','wss://a.example'],defaults),{bootstrap:true,relays:['wss://graph-relay.iris.to','wss://b.example','wss://a.example']});
  assert.deepEqual(graphRelayPolicy(['ws://127.0.0.1:1234/'],defaults),{bootstrap:false,relays:['ws://127.0.0.1:1234']});
  assert.deepEqual(graphRelayPolicy([],defaults),{bootstrap:false,relays:[]});
  assert.deepEqual(graphRelayPolicy(defaults,defaults,true),{bootstrap:false,relays:[]});
});
test('fresh public graph defaults select Ditto within the bounded first three even when reordered',()=>{
  assert.ok(relayUrls.includes('wss://relay.ditto.pub'));
  const policy=graphRelayPolicy([...relayUrls].reverse());
  assert.equal(policy.bootstrap,true);
  assert.deepEqual(policy.relays.slice(0,2),['wss://graph-relay.iris.to','wss://relay.ditto.pub']);
});
test('previous public defaults keep their graph scope without new relay injection',()=>{
  const previous=['wss://relay.damus.io','wss://nos.lol','wss://relay.primal.net','wss://temp.iris.to'];
  const policy=graphRelayPolicy(previous);
  assert.equal(policy.bootstrap,true);
  assert.deepEqual(policy.relays,['wss://graph-relay.iris.to',...previous]);
  assert.deepEqual(graphRelayPolicy(['wss://private.example']).relays,['wss://private.example']);
});
