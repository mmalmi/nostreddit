import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const lock = readFileSync('pnpm-lock.yaml', 'utf8');
const releases = lock.split('\nsnapshots:')[0].split('\n').filter(line => line.includes('tarball:'));
if (!releases.length || releases.some(line => !/integrity: sha512-[a-zA-Z0-9+/]{86}==/.test(line))) {
  throw new Error('Every release tarball must have a SHA-512 integrity pin');
}
const graph = readFileSync('public/socialGraph.bin');
if (createHash('sha256').update(graph).digest('hex') !== '085ba69fa37725c98c5c8e214bccf2cb4d748c542df5396830e122604c00577e') {
  throw new Error('Unexpected social graph snapshot');
}
console.log('Verified pinned release inputs and social graph snapshot');
