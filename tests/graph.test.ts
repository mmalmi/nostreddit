import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialGraph } from 'nostr-social-graph';
import { badgesFor, networkPostAuthors, sortVoters, type GraphBadge } from '../src/lib/graph-model';
import type { Event } from 'nostr-tools';

test('voters use cached distance, direct-follow overlap, and available PageRank before stable ties', () => {
  const badge = (distance: number | null, followedByFriends: number, influence?: number): GraphBadge =>
    ({distance, followedByFriends, influence, muted:false, overmuted:false});
  const badges = {
    popularFollow:badge(1,1,4), familiarFollow:badge(1,2,1), otherFollow:badge(1,1,2),
    near:badge(2,3,0.2), rankedNear:badge(2,1,0.4), far:badge(3,8,5), publicRoot:badge(0,0),
  };
  const direct = new Set(['popularFollow','familiarFollow','otherFollow']);
  const expected = ['self','familiarFollow','popularFollow','otherFollow','publicRoot','rankedNear','near','far','unknownA','unknownB'];
  const reversed = [...expected].reverse();
  assert.deepEqual(sortVoters(reversed, 'self', direct, badges), expected);
  assert.deepEqual(sortVoters(reversed, 'self', direct, {}), [
    'self','familiarFollow','otherFollow','popularFollow','far','near','publicRoot','rankedNear','unknownA','unknownB',
  ]);
  assert.deepEqual(reversed,[...expected].reverse());
});

test('a thousand voters read at most one cached graph badge per voter', () => {
  let lookups = 0;
  const badges = new Proxy({}, {get:() => { lookups++; return undefined; }});
  const keys = Array.from({length:1000}, (_,i) => i.toString(16).padStart(64,'0')).reverse();
  const sorted = sortVoters(keys,'viewer',new Set(),badges);
  assert.equal(sorted.length,1000);
  assert.equal(lookups,1000);
  assert.deepEqual(sorted,[...keys].sort());
});

test('network discovery fairly bounds verified friends’ lists and excludes direct follows and invalid keys', () => {
  const key=(n:number)=>n.toString(16).padStart(64,'0');
  const viewer=key(1),a=key(2),b=key(3),outsider=key(4);
  const list=(pubkey:string,people:string[])=>({kind:3,pubkey,tags:people.map(person=>['p',person])} as Event);
  const large=list(a,[viewer,a,b,'invalid',...Array.from({length:1500},(_,i)=>key(i+10))]);
  const small=list(b,[key(2000)]);
  const authors=networkPostAuthors(viewer,[a,b],[large,small,list(outsider,[key(3000)])]);
  assert.equal(authors.length,256);
  assert.equal(new Set(authors).size,256);
  assert.ok(authors.includes(key(2000)));
  for (const excluded of [viewer,a,b,'invalid',key(3000),key(1509)]) assert.ok(!authors.includes(excluded));
  assert.deepEqual(networkPostAuthors(viewer,[b],[large,small]),[key(2000)]);
});

test('graph badges respect account roots, mutes and bounded read-only lookups', async () => {
  const [viewer, friend, neighbor, stranger] = [1, 2, 3, 4].map(n => n.toString(16).padStart(64, '0'));
  const graph = new SocialGraph(viewer);
  graph.addFollower(viewer, friend);
  graph.addFollower(friend, neighbor);
  graph.handleEvent({ pubkey: viewer, kind: 10000, tags: [['p', stranger]], created_at: 1, content: '', sig: '', id: '' });
  await graph.recalculateFollowDistances();
  const unused = 'a'.repeat(64);
  assert.deepEqual(badgesFor(graph, [friend, neighbor, stranger, unused]), {
    [friend]: { distance: 1, muted: false, overmuted: false, followedByFriends: 0 }, [neighbor]: { distance: 2, muted: false, overmuted: false, followedByFriends: 1 },
    [stranger]: { distance: null, muted: true, overmuted: true, followedByFriends: 0 }, [unused]: { distance: null, muted: false, overmuted: false, followedByFriends: 0 }
  });
  assert.equal(graph.getInternalData().ids.has(unused), false);
  await graph.setRoot(friend);
  assert.equal(badgesFor(graph, [neighbor])[neighbor].distance, 1);
});

test('community mutes use the closest opinions while new viewers discover the public graph', async () => {
  const { discoveryRoot, snapshotRoot } = await import('../src/lib/graph-model');
  const [friend, neighbor, target, newViewer] = [5, 6, 7, 8].map(n => n.toString(16).padStart(64,'0'));
  const graph = new SocialGraph(snapshotRoot);
  graph.addFollower(snapshotRoot,friend);
  graph.addFollower(friend,neighbor);
  graph.addFollower(neighbor,target);
  graph.handleEvent({pubkey:friend,kind:10000,tags:[['p',target]],created_at:1,content:'',sig:'',id:''});
  await graph.recalculateFollowDistances();
  assert.equal(discoveryRoot(graph,newViewer),snapshotRoot);
  assert.equal(badgesFor(graph,[target],newViewer)[target].overmuted,true);
  graph.addFollower(friend,target);
  assert.equal(badgesFor(graph,[target],newViewer)[target].overmuted,false);
  graph.addFollower(newViewer,friend);
  assert.equal(discoveryRoot(graph,newViewer),newViewer);
});
