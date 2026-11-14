import assert from 'node:assert/strict';
import test from 'node:test';
import { groupNotifications } from '../src/lib/notification-groups';
import type { NostrEvent } from 'nostr-pubsub';

const hex = (n: number) => n.toString(16).padStart(64, '0');
const reaction = (id: number, author: number, post: number, time = 86401): NostrEvent => ({
  id: hex(id), pubkey: hex(author), sig: '', kind: 7, content: '♥', created_at: time, tags: [['e', hex(post)]],
});

test('overlapping reactions keep popular posts together and every activity in exactly one row', () => {
  const records = [reaction(1,10,50),reaction(2,10,51),reaction(3,11,50),reaction(4,12,51)];
  const grouped = groupNotifications(records);
  assert.deepEqual(grouped.map(row => row.authors.length),[2,2]);
  // The extra post is exclusive to the first actor, allowing one actor row.
  records.push(reaction(5,10,52),reaction(6,10,52));
  const rows = groupNotifications(records.reverse());
  assert.deepEqual(rows.map(row => row.targets.length),[3,1,1]);
  assert.deepEqual(rows[0].events.map(e => e.id),[1,2,5,6].map(hex));
  assert.equal(rows.flatMap(row => row.events).length,6);
  assert.deepEqual(rows,groupNotifications([...records].reverse()));
});

test('separate days, mentions and reactions without a target keep independent entries', () => {
  const events = [reaction(1,10,50,86399),reaction(2,10,51,86400),
    {...reaction(3,10,50),kind:1},{...reaction(4,10,50),tags:[['e','unavailable']]}];
  assert.equal(groupNotifications(events).length,4);
});
