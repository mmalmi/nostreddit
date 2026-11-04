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
    [friend]: { distance: 1, muted: false }, [neighbor]: { distance: 2, muted: false },
    [stranger]: { distance: null, muted: true }, [unused]: { distance: null, muted: false }
  });
  assert.equal(graph.getInternalData().ids.has(unused), false);
  await graph.setRoot(friend);
  assert.equal(badgesFor(graph, [neighbor])[neighbor].distance, 1);
});
