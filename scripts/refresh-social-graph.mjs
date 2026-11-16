import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SocialGraph } from 'nostr-social-graph';
import { DEFAULT_GRAPH_SNAPSHOT, MOBILE_GRAPH_MAX_BYTES, mobileGraphFile, openGraphSnapshot } from 'nostr-social-graph/hashtreeSnapshot';

const provenancePath = 'public/socialGraphSnapshot.provenance.json';
const previous = JSON.parse(await readFile(provenancePath, 'utf8'));
const root = previous.root;
const signal = AbortSignal.timeout(45_000);
const snapshot = await openGraphSnapshot({ signal });
const file = mobileGraphFile(snapshot.manifest, root);
const bytes = await snapshot.readFile(file, { signal, maxBytes: MOBILE_GRAPH_MAX_BYTES });
if (bytes[0] !== 4) throw new Error('Expected a v4 mobile graph');
const graph = await SocialGraph.fromBinary(root, bytes);
const revisions = graph.getListRevisions();
if (![3, 10000].every(kind => revisions.some(revision => revision.kind === kind))) {
  throw new Error('Expected follow and mute list revisions in the discovery graph');
}
const { generated_at, graph_completed_at } = snapshot.manifest;
const metadata = file === 'mobile.bin' ? snapshot.manifest.files[file] : snapshot.manifest.mobile_roots[root];
const provenance = {
  format: 'nostreddit/public-social-graph-snapshot@3',
  root,
  source: {
    tree: `htree://${DEFAULT_GRAPH_SNAPSHOT.publisher}/${DEFAULT_GRAPH_SNAPSHOT.treeName}`,
    eventId: snapshot.eventId,
    directoryHash: snapshot.directoryHash,
    file,
    generatedAt: generated_at,
    graphCompletedAt: graph_completed_at,
  },
  snapshot: {
    sha256: metadata.sha256,
    bytes: bytes.length,
    ...graph.size(),
    revisions: revisions.length,
    completeRevisions: revisions.filter(revision => revision.complete).length,
    rootFollow: graph.getListRevision(root, 3),
    rootMute: graph.getListRevision(root, 10000),
  },
};

// Stage both verified inputs on the destination filesystem. The offline build
// checks the pair again, including if a refresh was interrupted between renames.
const stage = '.work/refresh-social-graph';
await mkdir('.work', { recursive: true });
await mkdir(stage);
try {
  const current = JSON.parse(await readFile(provenancePath, 'utf8'));
  if (current.root !== root || current.source.graphCompletedAt > graph_completed_at) {
    throw new Error('The bundled graph root or generation changed during refresh');
  }
  await writeFile(join(stage, 'graph.bin'), bytes);
  await writeFile(join(stage, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  await rename(join(stage, 'graph.bin'), 'public/socialGraph.bin');
  await rename(join(stage, 'provenance.json'), provenancePath);
} finally {
  await rm(stage, { recursive: true, force: true });
}
console.log(`Verified signed graph ${snapshot.eventId}, ${bytes.length} bytes`);
