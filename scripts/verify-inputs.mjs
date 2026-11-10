import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const lock = readFileSync('pnpm-lock.yaml', 'utf8');
const releases = lock.split('\nsnapshots:')[0].split('\n').filter(line => line.includes('tarball:'));
if (!releases.length || releases.some(line => !/integrity: sha512-[a-zA-Z0-9+/]{86}==/.test(line))) {
  throw new Error('Every release tarball must have a SHA-512 integrity pin');
}
const treeCore = readFileSync('vendor/hashtree-core-0.4.0.tgz');
if (createHash('sha512').update(treeCore).digest('base64') !== 'hdqjU1MoGjc55BL5WM93jgVxW7cYOWCWHcYUl5glUT8boEinFfmlmnhyjGp7TNwWgxZKQ7Rgag9XiyDnRUGBUA==') {
  throw new Error('Unexpected Hashtree Core archive');
}
const irisUi = readFileSync('vendor/iris-svelte-ui-3d26f8c.tgz');
if (createHash('sha256').update(irisUi).digest('hex') !== '888f94c1422f07db33bc4b209a3b2bf5f13b12492c53d717660076de755c935b') {
  throw new Error('Unexpected Iris Kit UI archive');
}
if (createHash('sha256').update(readFileSync('vendor/iris-identity-aaa8a51.tgz')).digest('hex') !== 'fcfc59889fa2c9bfdf8ec68e79f5433eb6bc37b45829315f7750bb985486045a') {
  throw new Error('Unexpected Iris Kit identity archive');
}
const graph = readFileSync('public/socialGraph.bin');
if (createHash('sha256').update(graph).digest('hex') !== '19b490ce9c8715cc5c8dc24b73719051ce932febaec4ec369ab1ed9f7c575d20') {
  throw new Error('Unexpected social graph snapshot');
}
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
