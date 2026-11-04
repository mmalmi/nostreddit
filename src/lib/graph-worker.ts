import { SocialGraph } from 'nostr-social-graph';
import { badgesFor, snapshotRoot, snapshotHash, type GraphRequest, type GraphReply } from './graph-model';

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
self.onmessage = async ({ data }: MessageEvent<GraphRequest>) => {
  try {
    const graph = await (loaded ??= load());
    await graph.setRoot(data.root);
    if (data.events.length && graph.handleEvent(data.events, true)) {
      await graph.recalculateFollowDistances(5000, 100000, () => {});
    }
    self.postMessage({ version: data.version, badges: badgesFor(graph, data.authors) } satisfies GraphReply);
  } catch {
    self.postMessage({ version: data.version, error: true } satisfies GraphReply);
  }
};
