import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialGraph } from 'nostr-social-graph';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { profileRelationsFor, summarizeProfileList } from '../src/lib/graph-model';
import { displayName } from '../src/lib/ui';

test('profile context names only people the viewer follows who also follow the subject', async () => {
  const [viewer, friend, removed, stranger, subject, unknown] = Array.from({length:6}, () => generateSecretKey());
  const [v, f, r, s, t, u] = [viewer,friend,removed,stranger,subject,unknown].map(getPublicKey);
  const graph = new SocialGraph(v);
  const list = (sk:Uint8Array, keys:string[], time:number, kind = 3) => finalizeEvent({
    kind, content:'', created_at:time, tags: keys.map(key => ['p',key]),
  },sk);
  graph.handleEvent([list(viewer,[f,r],1),list(removed,[t],4),list(stranger,[t],1),list(subject,[u],3)], true);
  const latest = [list(friend,[t],6),list(removed,[],5),list(subject,[v,r,r],8)].map(e=>summarizeProfileList(e,t,v));
  const relations = profileRelationsFor(graph,t,latest)!;
  assert.deepEqual(relations.mutuals,[f]);
  assert.equal(relations.followers,2);
  assert.equal(relations.following,2);
  assert.equal(relations.followsViewer,true);
  assert.equal(relations.followingFromList,true);
  assert.deepEqual(profileRelationsFor(graph,t,[summarizeProfileList(list(removed,[],2),t,v)])!.mutuals,[r]);
  graph.handleEvent(list(viewer,[f],8,10000), true);
  assert.deepEqual(profileRelationsFor(graph,t,latest)!.mutuals,[]);
  const absent = 'a'.repeat(64);
  assert.equal(profileRelationsFor(graph,absent,[])!.followers,null);
  assert.equal(graph.getInternalData().ids.has(absent),false);
});

test('profile labels use Iris Kit deterministic placeholders for absent or identifier-shaped names', () => {
  const key = getPublicKey(generateSecretKey()), other = getPublicKey(generateSecretKey());
  const fallback = displayName(key);
  assert.equal(displayName(key),fallback);
  assert.equal(displayName(key.toUpperCase()),fallback);
  assert.notEqual(fallback,key);
  assert.match(fallback,/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.equal(displayName(key,{display_name:'Juniper Fox', name:'juniper'}),'Juniper Fox');
  assert.equal(displayName(key,{display_name:npubEncode(key),name:'Juniper'}),'Juniper');
  assert.equal(displayName(key,{name:other}),fallback);
});

test('post mentions use the same deterministic name as a profile without rewriting ordinary hashes or URLs', async () => {
  const {noteParts, partText} = await import('../src/lib/mentions');
  const key = 'a'.repeat(64);
  const npub = npubEncode(key), ref = 'nostr:'+npub;
  const parts = noteParts('Hi '+ref+' and '+key,[['p',key]]);
  assert.deepEqual(parts.filter(part => part.person).map(part => partText(part,{})), ['@'+displayName(key),'@'+displayName(key)]);
  assert.equal(noteParts(key,[])[0].person,undefined);
  assert.equal(noteParts('https://example.com/'+npub,[])[0].url,'https://example.com/'+npub);
});
