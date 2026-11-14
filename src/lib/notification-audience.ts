import type { NostrEvent } from 'nostr-pubsub';
import { hexKey } from './posts';

const bulk = new WeakMap<NostrEvent, boolean>();
export function isBulkAddressed(event: NostrEvent): boolean {
  if (event.kind !== 1 && event.kind !== 1111) return false;
  const cached = bulk.get(event);
  if (cached !== undefined) return cached;
  const recipients = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] === 'p' && hexKey.test(tag[1])) recipients.add(tag[1]);
    if (recipients.size > 10) break;
  }
  const result = recipients.size > 10;
  bulk.set(event, result);
  return result;
}

// Only the immediate parent can make a mass-tagged post a direct reply.
// Prefer a locally verified parent over the author hint signed by the sender.
export function isDirectNotificationReply(event: NostrEvent, viewer: string, authorOf: (id: string) => string | undefined) {
  const refs = event.tags.filter(tag => tag[0] === 'e' && hexKey.test(tag[1]));
  if (event.kind === 1111) {
    const parents = event.tags.filter(tag => ['e','a','i'].includes(tag[0]));
    if (parents.length !== 1) return false;
    const parent = parents[0];
    if (parent[0] === 'a') {
      const address = parent[1]?.match(/^\d+:([a-f0-9]{64}):/);
      return address?.[1] === viewer;
    }
    return refs.length === 1 && (authorOf(parent[1]) ?? parent[3]) === viewer;
  }

  const thread = refs.filter(tag => !tag[3] || tag[3] === 'root' || tag[3] === 'reply');
  const replies = thread.filter(tag => tag[3] === 'reply');
  if (replies.length > 1) return false;
  // A root-only tag is also a direct parent. Legacy unmarked chains use
  // the final reference. A root of a nested reply does not grant an exemption.
  const parent = replies[0] ?? (thread.length === 1 ? thread[0] : thread.filter(tag => !tag[3]).at(-1));
  return !!parent && (authorOf(parent[1]) ?? parent[4]) === viewer;
}
