import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyEmbeddedGraph } from './graph-input.mjs';

const lock = readFileSync('pnpm-lock.yaml', 'utf8');
const releases = lock.split('\nsnapshots:')[0].split('\n').filter(line => line.includes('tarball:'));
if (!releases.length || releases.some(line => !/integrity: sha512-[a-zA-Z0-9+/]{86}==/.test(line))) {
  throw new Error('Every release tarball must have a SHA-512 integrity pin');
}
const treeCore = readFileSync('vendor/hashtree-core-0.4.0.tgz');
if (createHash('sha512').update(treeCore).digest('base64') !== 'hdqjU1MoGjc55BL5WM93jgVxW7cYOWCWHcYUl5glUT8boEinFfmlmnhyjGp7TNwWgxZKQ7Rgag9XiyDnRUGBUA==') {
  throw new Error('Unexpected Hashtree Core archive');
}
// Byte-for-byte copy of the immutable Iris Kit runtime-v0.2.18 Svelte UI release asset.
const irisUi = readFileSync('vendor/iris-svelte-ui-runtime-v0.2.18.tgz');
if (createHash('sha256').update(irisUi).digest('hex') !== 'aa7fe63e8bdaee3fc90853e014cd6ae3b063ab2bbe95e28d54d62e3379bcde96') {
  throw new Error('Unexpected Iris Kit UI archive');
}
if (createHash('sha256').update(readFileSync('vendor/iris-identity-aaa8a51.tgz')).digest('hex') !== 'fcfc59889fa2c9bfdf8ec68e79f5433eb6bc37b45829315f7750bb985486045a') {
  throw new Error('Unexpected Iris Kit identity archive');
}
await verifyEmbeddedGraph();
const modelInputs = {
  'search-minilm-q8.onnx': 'b190f50dd46296b9895ae8f274c3455762d08610f8788f4a9bd15019f4f7160c',
  'search-tokenizer.json': '2fc687b11de0bc1b3d8348f92e3b49ef1089a621506c7661fbf3248fcd54947e',
  'tokenizer_config.json': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
  'search-keywords.bin': '445e2f19b506873911325f594bb620dd156ac0c7ced05e1dbfba34a7814ed866',
  'search-tag-head.json': '7abebd58ec9bf8b94322a362236ee0a983cf0dae1cf590efcea60c98777a8442',
};
for (const [name, digest] of Object.entries(modelInputs)) {
  if (createHash('sha256').update(readFileSync('src/lib/discovery/model/' + name)).digest('hex') !== digest)
    throw new Error('Unexpected discussion search input: ' + name);
}
console.log('Verified pinned release inputs, search model and social graph snapshot');
