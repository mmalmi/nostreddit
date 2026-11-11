import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { starterBadges } from '../scripts/starter-badges';

test('bundled starter badges match the bundled graph snapshot', async () => {
  // Regenerate with: pnpm exec tsx scripts/starter-badges.ts
  assert.deepEqual(JSON.parse(readFileSync('src/lib/starter-badges.json', 'utf8')), JSON.parse(JSON.stringify(await starterBadges())));
});
