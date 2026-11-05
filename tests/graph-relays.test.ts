import test from 'node:test';
import assert from 'node:assert/strict';
import {graphRelayPolicy} from '../src/lib/graph-relays';
const defaults=['wss://a.example','wss://b.example'];
test('graph catch-up uses only the configured scope and public bootstrap only with shipped defaults',()=>{
  assert.deepEqual(graphRelayPolicy(['wss://b.example/','wss://a.example'],defaults),{bootstrap:true,relays:['wss://graph-relay.iris.to','wss://b.example','wss://a.example']});
  assert.deepEqual(graphRelayPolicy(['ws://127.0.0.1:1234/'],defaults),{bootstrap:false,relays:['ws://127.0.0.1:1234']});
  assert.deepEqual(graphRelayPolicy([],defaults),{bootstrap:false,relays:[]});
  assert.deepEqual(graphRelayPolicy(defaults,defaults,true),{bootstrap:false,relays:[]});
});
