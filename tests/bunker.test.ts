import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairBunker, readBunkerSession, signWithBunker} from '../src/lib/bunker';
import {createBunkerSigner} from './helpers/bunkerSigner';

const interaction = () => ({signal:new AbortController().signal, onAuth:() => {}});

test('saved bunker sessions accept only relay-scoped links without pairing secrets', () => {
  const session = {connection:`bunker://${'a'.repeat(64)}?relay=wss%3A%2F%2Fsigner.example`,clientKey:'b'.repeat(64)};
  assert.deepEqual(readBunkerSession(session),session);
  for (const candidate of [null, {}, {...session,clientKey:'bad'}, {...session,connection:session.connection+'&secret=pair'},
    {...session,connection:'https://example.com'}, {...session,connection:`bunker://${'a'.repeat(64)}?relay=https://example.com`}]) {
    assert.equal(readBunkerSession(candidate),undefined);
  }
});

test('a restored bunker must still identify the same profile before any signing request', async () => {
  const signer = await createBunkerSigner();
  try {
    const paired = await pairBunker(signer.link, interaction());
    assert.deepEqual(signer.commands.slice(0,2), ['REQ','EVENT'], 'listen before publishing a request');
    signer.control.owner = signer.remotePubkey;
    await assert.rejects(signWithBunker(paired.bunker,paired.pubkey,{kind:1,created_at:1,tags:[],content:'unchanged'},interaction()),/signer/);
    assert.equal(signer.requests.some(request => request.method === 'sign_event'),false);
  } finally {await signer.close();}
});

test('an aborted pairing never opens a signing channel', async () => {
  const signer = await createBunkerSigner();
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(pairBunker(signer.link,{signal:controller.signal,onAuth:() => {}}));
    assert.equal(signer.connections,0); assert.equal(signer.requests.length,0);
  } finally {await signer.close();}
});
