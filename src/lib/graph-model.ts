import type { Event as NostrEvent } from 'nostr-tools';
import type { SocialGraph } from 'nostr-social-graph';

export const snapshotRoot = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
export const snapshotHash = '085ba69fa37725c98c5c8e214bccf2cb4d748c542df5396830e122604c00577e';
export type GraphBadge = { distance: number | null; muted: boolean; overmuted: boolean };
export type ProfileList = {
  author: string; id: string; at: number; followsSubject: boolean; followsViewer: boolean; following: number;
};
export type ProfileRelations = {
  subject: string; viewer: string; followers: number | null; following: number | null;
  followingFromList: boolean; followsViewer: boolean; mutuals: string[]; mutualCount: number;
};
export type GraphRequest = {
  root: string; authors: string[]; events: NostrEvent[]; version: number; profile: string; lists: ProfileList[];
};
export type GraphReply = { version: number; badges: Record<string, GraphBadge>; profile: ProfileRelations | null } | { version: number; error: true };

// Like Iris Social, compare the opinions at the nearest distance with any
// followers or muters. More mutes than follows at that distance hides the author.
function moreMutedThanFollowed(graph: SocialGraph, key: string): boolean {
  if (key === graph.getRoot() || !graph.getUserMutedBy(key).size) return false;
  const nearest = Object.entries(graph.stats(key))
    .sort(([a], [b]) => Number(a) - Number(b))
    .find(([,counts]) => counts.muters + counts.followers > 0);
  return !!nearest && nearest[1].muters > nearest[1].followers;
}

export function discoveryRoot(graph: SocialGraph, viewer: string): string {
  return viewer === snapshotRoot || (graph.getInternalData().ids.has(viewer) && graph.getFollowedByUser(viewer).size)
    ? viewer : snapshotRoot;
}

export function badgesFor(graph: SocialGraph, authors: readonly string[], viewer = graph.getRoot()): Record<string, GraphBadge> {
  const {ids} = graph.getInternalData();
  const muted = ids.has(viewer) ? graph.getMutedByUser(viewer) : new Set<string>();
  return Object.fromEntries(authors.map(author => {
    // Graph getters assign IDs to unknown keys. Keep public lookups read-only.
    const known = ids.has(author);
    const distance = author === viewer ? 0 : known ? graph.getFollowDistance(author) : 1000;
    return [author, {distance:distance < 1000 ? distance : null, muted:muted.has(author),
      overmuted:author !== viewer && known && moreMutedThanFollowed(graph,author)}];
  }));
}

// Keep only the edges needed for this profile. Public contact lists can have thousands of tags.
export function summarizeProfileList(event: NostrEvent, subject: string, viewer: string): ProfileList {
  const followed = new Set(event.tags.filter(t => t[0] === 'p' && /^[a-f0-9]{64}$/.test(t[1])).map(t => t[1]));
  return {author:event.pubkey, id:event.id, at:event.created_at, followsSubject:followed.has(subject),
    followsViewer:followed.has(viewer), following:followed.size};
}

export function profileRelationsFor(graph: SocialGraph, subject: string, lists: readonly ProfileList[], viewer = graph.getRoot()): ProfileRelations | null {
  if (!subject) return null;
  const { ids } = graph.getInternalData();
  const indexed = ids.has(subject);
  const followers = indexed ? graph.getFollowersByUser(subject) : new Set<string>();
  const viewerFollows = ids.has(viewer) ? graph.getFollowedByUser(viewer) : new Set<string>();
  const mutual = new Set([...followers].filter(key => viewerFollows.has(key)));
  let following = indexed && graph.getFollowListCreatedAt(subject) !== undefined ? graph.getFollowedByUser(subject).size : null;
  let followingFromList = false, followsViewer = indexed && graph.isFollowing(subject, viewer);
  for (const list of lists) {
    const snapshotTime = ids.has(list.author) ? graph.getFollowListCreatedAt(list.author) : undefined;
    if (snapshotTime !== undefined && list.at < snapshotTime) continue;
    if (list.author === subject) {
      following = list.following;
      followingFromList = true;
      followsViewer = list.followsViewer;
    } else if (list.author !== viewer && ids.has(list.author) && graph.isFollowing(viewer, list.author)) {
      if (list.followsSubject) { followers.add(list.author); mutual.add(list.author); }
      else { followers.delete(list.author); mutual.delete(list.author); }
    }
  }
  mutual.delete(viewer);
  mutual.delete(subject);
  for (const key of graph.getMutedByUser(viewer)) mutual.delete(key);
  return {subject, viewer, followers: indexed || followers.size ? followers.size : null, following,
    followingFromList, followsViewer, mutualCount:mutual.size, mutuals:[...mutual].sort().slice(0,12)};
}
