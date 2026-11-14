import type { NostrEvent } from 'nostr-pubsub';
import { hexKey } from './posts';

// Keep the provider's signed event intact. Verified tips carry a separate
// sender and payment identity for presentation and persistent read tracking.
export type InboxEvent = NostrEvent & {tip?: {sender: string | null; paymentHash: string; millisats: number}};
export const notificationAuthor = (event: InboxEvent) => event.tip ? event.tip.sender : event.pubkey;
export const notificationReadId = (event: InboxEvent) => event.tip?.paymentHash ?? event.id;

export function notificationPostId(event: NostrEvent) {
  return event.kind === 7 || event.kind === 9735
    ? event.tags.filter(tag => tag[0] === 'e' && hexKey.test(tag[1])).at(-1)?.[1]
    : event.id;
}

export interface NotificationGroup {
  key: string;
  latest: InboxEvent;
  events: InboxEvent[];
  authors: string[];
  targets: string[];
  tipMillisats: number;
}

export function groupNotifications(events: readonly InboxEvent[]): NotificationGroup[] {
  // A sender's burst replaces at least one whole post row. Keep busy posts
  // together if moving the sender out of them would only add another row.
  const actorTargets = new Map<string, Set<string>>();
  const targetActors = new Map<string, Set<string>>();
  const byKey = new Map<string, {latest: InboxEvent; events: InboxEvent[]; authors: Set<string>; targets: Set<string>; tipMillisats:number}>();
  const ordered = [...events].sort((a,b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  const entries = ordered.map(event => {
    const target = notificationPostId(event);
    const actorDay = event.pubkey + ':' + Math.floor(event.created_at / 86400);
    if (target && event.kind === 7) {
      if (!actorTargets.has(actorDay)) actorTargets.set(actorDay, new Set());
      if (!targetActors.has(target)) targetActors.set(target, new Set());
      actorTargets.get(actorDay)!.add(target);
      targetActors.get(target)!.add(actorDay);
    }
    return {event, target, actorDay};
  });

  const bursts = new Set<string>();
  for (const [actorDay, targets] of actorTargets) {
    if (targets.size > 1 && [...targets].some(target => targetActors.get(target)!.size === 1)) bursts.add(actorDay);
  }
  for (const {event, target, actorDay} of entries) {
    let key = event.id;
    if (event.kind === 7 && target) key = bursts.has(actorDay) ? 'actor:' + actorDay : 'post:' + target;
    if (event.kind === 9735 && event.tip && target) key = 'tip:post:' + target;
    let row = byKey.get(key);
    if (!row) {
      row = {latest:event, events:[], authors:new Set(), targets:new Set(), tipMillisats:0};
      byKey.set(key, row);
    }
    row.events.push(event);
    row.tipMillisats += event.tip?.millisats ?? 0;
    const author = notificationAuthor(event);
    if (author) row.authors.add(author);
    if (target) row.targets.add(target);
  }
  return [...byKey].map(([key,row]) => ({...row, key, authors:[...row.authors], targets:[...row.targets]}));
}
