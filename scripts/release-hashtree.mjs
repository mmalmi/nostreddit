import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const gate = process.env.IRIS_NATIVE_RELEASE_GATE;
assert.ok(gate && path.isAbsolute(gate) && statSync(gate, { throwIfNoEntry: false })?.isFile(),
  'Set IRIS_NATIVE_RELEASE_GATE to the installed Iris Sites native release runner');

function run(bin, args) {
  const result = spawnSync(bin, args, { cwd: appDir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const script of ['check', 'test', 'build', 'test:browser', 'test:relay-privacy']) run('pnpm', [script]);

const dist = path.join(appDir, 'dist');
copyFileSync(path.join(appDir, 'LICENSE'), path.join(dist, 'LICENSE'));
run(process.execPath, [gate, '--dist', dist, '--tree', 'nostreddit-site', '--htree', process.env.HTREE_BIN || 'htree']);
