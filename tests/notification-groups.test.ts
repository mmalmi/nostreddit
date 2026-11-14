import assert from 'node:assert/strict';
import test from 'node:test';
import { groupNotifications, notificationReadId, type InboxEvent } from '../src/lib/notification-groups';
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

test('verified tips on one post form one row across senders and dates, with every payment readable', () => {
  const tip = (id:number, sender:number|null, post:number, daysAgo:number, sats:number): InboxEvent => ({
    ...reaction(id, 999, post, (100-daysAgo)*86400), kind:9735,
    tip:{sender:sender === null ? null : hex(sender), paymentHash:hex(1000+id), millisats:sats*1000},
  });
  const records=[tip(1,10,70,1,990),tip(2,11,70,1,10),tip(3,12,70,16,200),tip(4,10,70,23,240),tip(5,null,70,25,20)];
  const unrelated=[tip(6,10,71,1,50),reaction(7,10,70),{...tip(8,10,70,1,50),tags:[]}];
  const rows=groupNotifications([...records,...unrelated]);
  assert.equal(rows.length,4);
  const group=rows.find(row=>row.events.length===5)!;
  assert.deepEqual(group.targets,[hex(70)]);
  assert.deepEqual(group.authors,[10,11,12].map(hex));
  assert.equal(group.tipMillisats,1460000);
  assert.deepEqual(group.events.map(notificationReadId),records.map(notificationReadId));
  assert.equal(group.latest.id,records[0].id);
  assert.deepEqual(rows,groupNotifications([...unrelated,...records].reverse()));
});
