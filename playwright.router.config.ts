import { defineConfig } from '@playwright/test';
process.env.NOSTREDDIT_TEST_RELAY_URL = 'ws://127.0.0.1:43174';
export default defineConfig({
  testDir: 'tests', testMatch: '**/*.spec.ts', workers: 1,
  timeout: 60_000, outputDir: '.work/router-results',
  use: { baseURL: 'http://127.0.0.1:43173', viewport: { width: 1440, height: 960 } },
  webServer: [
    { command: 'node tests/relay.mjs', env: { TEST_RELAY_PORT: '43174' }, url: 'http://127.0.0.1:43174' },
    { command: 'pnpm exec vite build --outDir .work/router-dist && pnpm exec vite preview --outDir .work/router-dist --port 43173 --strictPort', env: { VITE_NOSTR_RELAYS: 'ws://127.0.0.1:43174' }, url: 'http://127.0.0.1:43173' }
  ]
});
