import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fromBinary} from 'nostr-social-graph';
import {MOBILE_GRAPH_MAX_BYTES} from 'nostr-social-graph/hashtreeSnapshot';
import {assertDiscoveryGraphCoverage} from '../src/lib/graph-snapshot-policy.js';

export async function verifyEmbeddedGraph(directory = process.cwd()) {
  const provenance = JSON.parse(await readFile(join(directory, 'public/socialGraphSnapshot.provenance.json'), 'utf8'));
  const bytes = new Uint8Array(await readFile(join(directory, 'public/socialGraph.bin')));
  const {snapshot} = provenance;
  if (bytes[0] !== 4 || bytes.length > MOBILE_GRAPH_MAX_BYTES || bytes.length !== snapshot.bytes
      || createHash('sha256').update(bytes).digest('hex') !== snapshot.sha256) {
    throw new Error('Unexpected social graph snapshot');
  }
  const graph = await fromBinary(provenance.root, bytes, true);
  const size = graph.size();
  assertDiscoveryGraphCoverage(size);
  for (const field of ['users', 'follows', 'mutes']) {
    if (size[field] !== snapshot[field]) throw new Error('Graph provenance coverage mismatch');
  }
  return {provenance, graph, bytes};
}
