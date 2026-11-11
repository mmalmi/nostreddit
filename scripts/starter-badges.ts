// Graph badges for the bundled starter feed, as a guest's graph worker would
// compute them from the bundled snapshot. They let a first visit show the starter
// feed without waiting for the snapshot download.
import { readFileSync, writeFileSync } from 'node:fs';
import { SocialGraph } from 'nostr-social-graph';
import { badgesFor, discoveryRoot, snapshotRoot } from '../src/lib/graph-model';
import { createGraphRanker } from '../src/lib/graph-ranking';

export async function starterBadges() {
  const graph = await SocialGraph.fromBinary(snapshotRoot, readFileSync('public/socialGraph.bin'));
  const effective = discoveryRoot(graph, snapshotRoot);
  if (graph.getRoot() !== effective) await graph.setRoot(effective);
  const feed: {pubkey: string}[] = JSON.parse(readFileSync('public/starter-feed.json', 'utf8'));
  const authors = [...new Set(feed.map(event => event.pubkey))].sort();
  const ranker = createGraphRanker();
  await ranker.update(graph, snapshotRoot, {}, 1, true);
  const badges = badgesFor(graph, authors, snapshotRoot, {});
  for (const [author, badge] of Object.entries(badges)) badge.influence = ranker.weight(author);
  return badges;
}

if (process.argv[1]?.endsWith('starter-badges.ts')) {
  writeFileSync('src/lib/starter-badges.json', JSON.stringify(await starterBadges(), null, 1) + '\n');
}
