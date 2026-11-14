import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { finalizeEvent, generateSecretKey, verifyEvent, type EventTemplate } from 'nostr-tools';
import { uploadAttachment, MAX_ATTACHMENT_BYTES } from '../src/lib/uploads';

const sk = generateSecretKey();
const sign = async (event: EventTemplate) => finalizeEvent(event, sk);
function blossom(reply?: (hash: string) => Response) {
  const calls: {url:string; init:RequestInit}[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({url, init});
    const hash = (init.headers as Record<string,string>)['X-SHA-256'];
    return reply ? reply(hash) : Response.json({sha256:hash, url:`https://blobs.test/${hash}`, size:1});
  }) as unknown as typeof globalThis.fetch;
  return {calls, fetch};
}

test('uploads a file as one Blossom blob with a single signed authorization', async () => {
  const server = blossom();
  let signatures = 0;
  const file = new File(['hello attachment'], 'photo.JPG', {type:'image/jpeg'});
  const link = await uploadAttachment(file, {server:'https://blobs.test/', fetch:server.fetch, sign:async e => (signatures++, sign(e))});
  const hash = createHash('sha256').update('hello attachment').digest('hex');
  assert.equal(link, `https://blobs.test/${hash}.jpg`);
  assert.equal(signatures, 1);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].url, 'https://blobs.test/upload');
  const headers = server.calls[0].init.headers as Record<string,string>;
  assert.equal(headers['Content-Type'], 'image/jpeg');
  const auth = JSON.parse(atob(headers.Authorization.replace(/^Nostr /, '')));
  assert.ok(verifyEvent(auth));
  assert.equal(auth.kind, 24242);
  assert.deepEqual(auth.tags.slice(0,2), [['t','upload'],['x',hash]]);
});
test('failed or mismatched uploads never return a link', async () => {
  const file = new File(['hello'], 'hello.txt');
  const rejected = blossom(() => new Response('', {status:401, headers:{'x-reason':'auth required'}}));
  await assert.rejects(uploadAttachment(file, {fetch:rejected.fetch, sign}), /Upload failed: auth required/);
  const mismatched = blossom(() => Response.json({sha256:'0'.repeat(64)}));
  await assert.rejects(uploadAttachment(file, {fetch:mismatched.fetch, sign}), /verify/);
  const offline = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
  await assert.rejects(uploadAttachment(file, {fetch:offline, sign}), /Upload failed/);
});
test('empty, oversized and invalid filenames are rejected before signing or writing', async () => {
  const server = blossom();
  const refuse = async () => { throw new Error('unexpected signature'); };
  for (const file of [new File([],'empty'),new File([new Uint8Array(MAX_ATTACHMENT_BYTES+1)],'large'),new File(['x'],'..')])
    await assert.rejects(uploadAttachment(file, {fetch:server.fetch, sign:refuse}), /Choose/);
  assert.equal(server.calls.length, 0);
});
