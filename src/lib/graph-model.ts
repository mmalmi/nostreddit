import type { Event as NostrEvent } from 'nostr-tools';
import type { SocialGraph } from 'nostr-social-graph';

export const snapshotRoot = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
export const snapshotHash = '19b490ce9c8715cc5c8dc24b73719051ce932febaec4ec369ab1ed9f7c575d20';
export type GraphBadge = { distance: number | null; muted: boolean; overmuted: boolean; followedByFriends?:number; influence?:number };
export type RelationshipKind = 'following' | 'followers';
export type ProfileList = {
  author: string; id: string; at: number; followsSubject: boolean; followsViewer: boolean; following: number; followKeys?: string[];
};
export type ProfileRelations = {
  subject: string; viewer: string; followers: number | null; following: number | null;
  followingFromList: boolean; followsViewer: boolean; mutuals: string[]; mutualCount: number; directory: {kind:RelationshipKind; keys:string[]; known:boolean} | null;
};
export type PendingEdges = {follows:Record<string,boolean>; mutes:Record<string,boolean>};
export type GraphRequest = {
  ranking:boolean;
  edges:PendingEdges;
  root: string; authors: string[]; events: NostrEvent[]; version: number; profile: string; lists: ProfileList[]; directory: RelationshipKind | null;
};
export type GraphReply = { version: number; discoveryRoot:string; badges: Record<string, GraphBadge>; profile: ProfileRelations | null } | { version: number; error: true };

// Like Iris Social, compare the opinions at the nearest distance with any
// followers or muters. More mutes than follows at that distance hides the author.
function moreMutedThanFollowed(graph: SocialGraph, key: string, omitMuteAt?:number): boolean {
  if (key === graph.getRoot() || !graph.getUserMutedBy(key).size) return false;
  const stats = graph.stats(key);
  if (omitMuteAt !== undefined && stats[omitMuteAt]) stats[omitMuteAt].muters--;
  const nearest = Object.entries(stats)
    .sort(([a], [b]) => Number(a) - Number(b))
    .find(([,counts]) => counts.muters + counts.followers > 0);
  return !!nearest && nearest[1].muters > nearest[1].followers;
}

export function discoveryRoot(graph: SocialGraph, viewer: string): string {
  return viewer === snapshotRoot || (graph.getInternalData().ids.has(viewer) && graph.getFollowedByUser(viewer).size)
    ? viewer : snapshotRoot;
}

export function badgesFor(graph: SocialGraph, authors: readonly string[], viewer = graph.getRoot(), pendingMutes:Record<string,boolean> = {}): Record<string, GraphBadge> {
  const {ids} = graph.getInternalData();
  const muted = ids.has(viewer) ? graph.getMutedByUser(viewer) : new Set<string>();
  return Object.fromEntries(authors.map(author => {
    // Graph getters assign IDs to unknown keys. Keep public lookups read-only.
    const known = ids.has(author);
    const distance = author === viewer ? 0 : known ? graph.getFollowDistance(author) : 1000;
    const unmuting = pendingMutes[author] === false && muted.has(author);
    return [author, {distance:distance < 1000 ? distance : null, followedByFriends:known ? graph.followedByFriendsCount(author) : 0, muted:pendingMutes[author] ?? muted.has(author),
      overmuted:author !== viewer && known && moreMutedThanFollowed(graph,author,unmuting ? graph.getFollowDistance(viewer) : undefined)}];
  }));
}

// Keep only the edges needed for this profile. Public contact lists can have thousands of tags.
export function summarizeProfileList(event: NostrEvent, subject: string, viewer: string, includeKeys = false): ProfileList {
  if (event.pubkey !== subject) return {author:event.pubkey, id:event.id, at:event.created_at,
    followsSubject:event.tags.some(t => t[0] === 'p' && t[1] === subject), followsViewer:false, following:0};
  const followed = new Set(event.tags.filter(t => t[0] === 'p' && /^[a-f0-9]{64}$/.test(t[1])).map(t => t[1]));
  return {author:event.pubkey, id:event.id, at:event.created_at, followsSubject:followed.has(subject),
    followsViewer:followed.has(viewer), following:followed.size, ...(includeKeys ? {followKeys:[...followed]} : {})};
}

export function profileRelationsFor(graph: SocialGraph, subject: string, lists: readonly ProfileList[], viewer = graph.getRoot(), directory:RelationshipKind|null = null): ProfileRelations | null {
  if (!subject) return null;
  const { ids } = graph.getInternalData();
  const indexed = ids.has(subject);
  const followers = indexed ? graph.getFollowersByUser(subject) : new Set<string>();
  const viewerFollows = ids.has(viewer) ? graph.getFollowedByUser(viewer) : new Set<string>();
  const mutual = new Set([...followers].filter(key => viewerFollows.has(key)));
  let followKeys = indexed && graph.getFollowListCreatedAt(subject) !== undefined ? [...graph.getFollowedByUser(subject)] : null;
  let following = followKeys?.length ?? null;
  let followingFromList = false, followsViewer = indexed && graph.isFollowing(subject, viewer);
  for (const list of lists) {
    const snapshotTime = ids.has(list.author) ? graph.getFollowListCreatedAt(list.author) : undefined;
    if (snapshotTime !== undefined && list.at < snapshotTime) continue;
    if (list.author === subject) {
      following = list.following;
      if (list.followKeys) followKeys = list.followKeys;
      followingFromList = true;
      followsViewer = list.followsViewer;
    } else {
      if (list.followsSubject) {
        followers.add(list.author);
        if (viewerFollows.has(list.author)) mutual.add(list.author);
      }
      else { followers.delete(list.author); mutual.delete(list.author); }
    }
  }
  mutual.delete(viewer);
  mutual.delete(subject);
  for (const key of graph.getMutedByUser(viewer)) mutual.delete(key);
  const keys = directory === 'following' ? followKeys : [...followers];
  return {subject, viewer, directory:directory ? {kind:directory,keys:[...new Set(keys || [])].sort(),
    known:directory === 'following' ? following !== null : indexed || !!followers.size} : null,
    followers: indexed || followers.size ? followers.size : null, following,
    followingFromList, followsViewer, mutualCount:mutual.size, mutuals:[...mutual].sort().slice(0,12)};
}
