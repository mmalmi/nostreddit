import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { contentTopics, hashtagParts, topicPath, topicTags } from '../src/lib/hashtags';
import { asPost, commentDraft, matchesTopic, postDraft } from '../src/lib/posts';
import { noteParts } from '../src/lib/mentions';

test('hashtag text, links and signed tags agree without exposing URL fragments', () => {
  const text='(#Cafe\u0301), #ART #art! #海辺 #coastal-art. word#skip /#anchor https://photo.example/file#hidden htree://share/file#private';
  const tags=['café','art','海辺','coastal-art'];
  assert.deepEqual([...contentTopics(text)],tags);
  assert.deepEqual([...new Set(noteParts(text,[]).flatMap(p=>p.topic || []))],tags);
  assert.equal(hashtagParts(text).map(p=>p.text).join(''),text);
  assert.equal(topicPath('海辺'),'/t/%E6%B5%B7%E8%BE%BA');
  assert.deepEqual(topicTags('art',text).map(t=>t[1]),['art','café','海辺','coastal-art']);
  assert.deepEqual([...contentTopics('#'+ 'a'.repeat(49))],[]);
});

test('written hashtags preserve topic order and threading without community ownership', () => {
  const author=generateSecretKey(), pubkey=getPublicKey(author);
  const sign=(draft:ReturnType<typeof postDraft> | ReturnType<typeof commentDraft>)=>asPost(finalizeEvent({...draft,created_at:123},author))!;
  let root=sign(postDraft({topic:'mostro',title:'Using #Bitcoin',body:'Trade with #Mostro and #Lightning.'}));
  const tags=(event:typeof root.event)=>event.tags.filter(t=>t[0]==='t').map(t=>t[1]);
  assert.deepEqual(tags(root.event),['mostro','bitcoin','lightning']);
  assert.ok(matchesTopic(root,'bitcoin')); assert.equal(root.topic,'mostro');
  const reply=sign(commentDraft(root,'#Relays, #Bitcoin and #relays'));
  assert.deepEqual(tags(reply.event),['mostro','relays','bitcoin']); assert.equal(reply.parent,root.id);
  const address='34550:'+pubkey+':mostro';
  root=asPost(finalizeEvent({kind:1,created_at:124,content:'About #Bitcoin',tags:[['a',address]]},author))!;
  const scoped=sign(commentDraft(root,'#Bitcoin'));
  assert.ok(matchesTopic(scoped,'bitcoin')); assert.equal(matchesTopic(scoped,'mostro'),false);
  assert.ok(scoped.event.tags.some(tag=>tag[0]==='a' && tag[1]===address));
  const unsignedTag=asPost(finalizeEvent({kind:1,created_at:125,content:'Some #music',tags:[]},author))!;
  assert.ok(matchesTopic(unsignedTag,'music'));
});

test('choosing a topic adds a signed tag without inserting a visible hashtag', () => {
  const draft=postDraft({topic:'Gardening',title:'Winter seedlings',body:'What are you growing?'});
  assert.deepEqual(draft.tags.filter(tag=>tag[0]==='t'),[['t','gardening']]);
  assert.equal(draft.content,'Winter seedlings\n\nWhat are you growing?');
  const post=asPost(finalizeEvent({...draft,created_at:123},generateSecretKey()))!;
  assert.ok(matchesTopic(post,'gardening'));
});
