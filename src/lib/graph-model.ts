import type { Event as NostrEvent } from 'nostr-tools';
import type { SocialGraph } from 'nostr-social-graph';

export const snapshotRoot = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
export const snapshotHash = '085ba69fa37725c98c5c8e214bccf2cb4d748c542df5396830e122604c00577e';
export type GraphBadge = { distance: number | null; muted: boolean };
export type GraphRequest = { root: string; authors: string[]; events: NostrEvent[]; version: number };
export type GraphReply = { version: number; badges: Record<string, GraphBadge> } | { version: number; error: true };

export function badgesFor(graph: SocialGraph, authors: readonly string[]): Record<string, GraphBadge> {
  const muted = graph.getMutedByUser(graph.getRoot());
  const { ids } = graph.getInternalData();
  return Object.fromEntries(authors.map(author => {
    // getFollowDistance assigns internal IDs to unknown keys. Keep reads side-effect free.
    const distance = ids.has(author) ? graph.getFollowDistance(author) : 1000;
    return [author, { distance: distance < 1000 ? distance : null, muted: muted.has(author) }];
  }));
}
