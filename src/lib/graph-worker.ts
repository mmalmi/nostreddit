import { SocialGraph } from 'nostr-social-graph';
import { createGraphRanker } from './graph-ranking';
import { badgesFor, discoveryRoot, profileRelationsFor, snapshotRoot, snapshotHash, type GraphRequest, type GraphReply } from './graph-model';

async function load() {
  const response = await fetch('/socialGraph.bin?v=' + snapshotHash.slice(0, 16));
  if (!response.ok) throw new Error('Graph unavailable');
  const bytes = await response.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== snapshotHash) throw new Error('Graph snapshot failed verification');
  return SocialGraph.fromBinary(snapshotRoot, new Uint8Array(bytes));
}

// Main sends one request at a time. Full graph traversals occur only on root or edge changes.
let loaded: Promise<SocialGraph> | undefined;
const ranker=createGraphRanker();
let graphRevision=0;
// Keep unsigned local edges separate from the verified graph. Undo the previous
// overlay before applying an authoritative list or switching the active profile.
let overlayOwner='', overlayKey='', undo:Record<string,boolean>={};
function setEdge(graph:SocialGraph, owner:string, person:string, followed:boolean) {
  if (followed) graph.addFollower(owner,person); else graph.removeFollower(owner,person);
}
self.onmessage = async ({ data }: MessageEvent<GraphRequest>) => {
  try {
    const graph = await (loaded ??= load());
    let changed = false;
    const nextKey=JSON.stringify(data.edges.follows);
    const updateEdges=data.root!==overlayOwner || nextKey!==overlayKey || data.events.some(e=>e.pubkey===data.root && e.kind===3);
    if (updateEdges) {
      for (const [person,wasFollowed] of Object.entries(undo)) setEdge(graph,overlayOwner,person,wasFollowed);
      changed=Object.keys(undo).length>0;
      undo={};
    }
    if (data.events.length) {
      await graph.setRoot(data.root);
      changed = graph.handleEvent(data.events, true) || changed;
    }
    if (updateEdges) {
      overlayOwner=data.root; overlayKey=nextKey;
      for (const [person,followed] of Object.entries(data.edges.follows)) {
        if (person===data.root) continue;
        const current=graph.isFollowing(data.root,person);
        if (current===followed) continue;
        undo[person]=current; setEdge(graph,data.root,person,followed); changed=true;
      }
    }
    const effective = discoveryRoot(graph,data.root);
    if (graph.getRoot() !== effective) await graph.setRoot(effective);
    else if (changed) await graph.recalculateFollowDistances(5000, 100000, () => {});
    if(changed)graphRevision++;
    await ranker.update(graph,data.root,data.edges.mutes,graphRevision,data.ranking);
    const badges=badgesFor(graph,data.authors,data.root,data.edges.mutes);
    for(const [author,badge] of Object.entries(badges))badge.influence=ranker.weight(author);
    self.postMessage({version:data.version, discoveryRoot:effective, badges,
      profile:profileRelationsFor(graph,data.profile,data.lists,data.root,data.directory)} satisfies GraphReply);
  } catch {
    self.postMessage({ version: data.version, error: true } satisfies GraphReply);
  }
};
