import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialGraph } from 'nostr-social-graph';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { NostrRuntime, NostrFilter } from 'nostr-pubsub';
import { freshestContactLists, queryDirectory } from '../src/lib/contactDirectory';
import { profileRelationsFor, summarizeProfileList } from '../src/lib/graph-model';

const contacts = (key:Uint8Array, at:number, ...people:string[]) => finalizeEvent({
  kind:3, created_at:at, tags:people.map(person=>['p',person]), content:'',
},key);

test('reverse discovery confirms latest untagged kind 3 before admitting a nonmutual follower', async () => {
  const [reader,target,person,former,potential] = Array.from({length:5}, generateSecretKey);
  const subject=getPublicKey(target), viewer=getPublicKey(reader);
  const old=contacts(former,5,subject), newer=contacts(former,7);
  const current=contacts(person,4,subject), unconfirmed=contacts(potential,3,subject);
  const arrived:string[] = [];
  let settled = false, finishReverse = () => {};
  const runtime = {
    subscribe(filters:NostrFilter[], handlers:{onEvent(event:unknown):void; onEose(status:unknown):void}) {
      const reverse = filters.some(f=>f['#p']?.includes(subject));
      if (!reverse) assert.ok(filters.every(f=>f.authors?.length===1 && f.limit===1 && !f['#p']));
      (reverse ? [old,current,unconfirmed] : [newer,current,old]).forEach(handlers.onEvent);
      const finish = () => handlers.onEose({sources:[{complete:true}]});
      // The reverse lookup has a silent relay: its history stays open for now.
      if (reverse) finishReverse = finish; else finish();
      return {close() {}};
    }
  } as unknown as NostrRuntime;
  const reading = queryDirectory(runtime,'fixture',{type:'contacts',mode:'followers',subject},
    events=>arrived.push(...events.map(e=>e.id)));
  void reading.then(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,120));
  // Confirmed lists are reported while the reverse lookup is still unanswered.
  assert.ok(arrived.includes(newer.id) && arrived.includes(current.id));
  assert.equal(settled,false);
  finishReverse();
  const verified = await reading;
  assert.deepEqual(verified.map(e=>e.id).sort(),[newer.id,current.id].sort());
  const graph=new SocialGraph(viewer);
  const lists=verified.map(e=>summarizeProfileList(e,subject,viewer));
  const result=profileRelationsFor(graph,subject,lists,viewer,'followers')!;
  assert.deepEqual(result.directory?.keys,[getPublicKey(person)]);
  assert.deepEqual(result.mutuals,[]);
});

test('the newest contact list replaces previous follows and equal timestamps favor the lower event ID', () => {
  const [reader,target,oldFriend,newFriend]=Array.from({length:4},generateSecretKey);
  const viewer=getPublicKey(reader), subject=getPublicKey(target);
  const graph=new SocialGraph(viewer), old=contacts(target,2,getPublicKey(oldFriend)), current=contacts(target,4,getPublicKey(newFriend),getPublicKey(newFriend));
  graph.handleEvent(old,true);
  const page=profileRelationsFor(graph,subject,[summarizeProfileList(current,subject,viewer,true)],viewer,'following')!;
  assert.deepEqual(page.directory?.keys,[getPublicKey(newFriend)]);
  assert.equal(page.following,1);
  const cleared=contacts(target,5);
  assert.deepEqual(profileRelationsFor(graph,subject,[summarizeProfileList(cleared,subject,viewer,true)],viewer,'following')!.directory,
    {kind:'following',keys:[],known:true});
  assert.equal(profileRelationsFor(graph,subject,[summarizeProfileList(contacts(target,1),subject,viewer,true)],viewer,'following')!.following,1);
  const tie=contacts(target,4);
  assert.equal(freshestContactLists([tie,current])[0].id, [tie.id,current.id].sort()[0]);
  assert.equal(freshestContactLists([current,tie])[0].id, [tie.id,current.id].sort()[0]);
  assert.equal(profileRelationsFor(graph,getPublicKey(generateSecretKey()),[],viewer,'following')!.directory?.known,false);
});
