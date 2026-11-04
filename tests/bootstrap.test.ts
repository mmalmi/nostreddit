import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyEvent, type Event } from 'nostr-tools';

test('the first-visit feed contains verified, distinct public posts in every featured topic', () => {
  const events: Event[] = JSON.parse(readFileSync('public/starter-feed.json','utf8'));
  assert.equal(new Set(events.map(event => event.id)).size,events.length);
  assert.ok(events.every(verifyEvent));
  for (const topic of ['nostr','bitcoin','photography','art','technology','music']) {
    assert.ok(events.some(e => e.kind === 1 && e.tags.some(t => t[0] === 't' && t[1] === topic)));
  }
});
