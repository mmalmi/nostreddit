import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialGraph } from 'nostr-social-graph';
import { badgesFor } from '../src/lib/graph-model';

test('graph badges respect account roots, mutes and bounded read-only lookups', async () => {
  const [viewer, friend, neighbor, stranger] = [1, 2, 3, 4].map(n => n.toString(16).padStart(64, '0'));
  const graph = new SocialGraph(viewer);
  graph.addFollower(viewer, friend);
  graph.addFollower(friend, neighbor);
  graph.handleEvent({ pubkey: viewer, kind: 10000, tags: [['p', stranger]], created_at: 1, content: '', sig: '', id: '' });
  await graph.recalculateFollowDistances();
  const unused = 'a'.repeat(64);
  assert.deepEqual(badgesFor(graph, [friend, neighbor, stranger, unused]), {
    [friend]: { distance: 1, muted: false, overmuted: false }, [neighbor]: { distance: 2, muted: false, overmuted: false },
    [stranger]: { distance: null, muted: true, overmuted: true }, [unused]: { distance: null, muted: false, overmuted: false }
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
