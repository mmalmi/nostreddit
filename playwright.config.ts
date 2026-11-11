import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  workers: 4,
  fullyParallel: false,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:43163', viewport: { width: 1440, height: 960 } },
  webServer: [
    { command: 'node tests/relay.mjs', url: 'http://127.0.0.1:43164' },
    {
      command: 'pnpm exec vite build --outDir .work/test-dist && pnpm exec vite preview --outDir .work/test-dist --port 43163 --strictPort',
      env: { VITE_NOSTR_RELAYS: 'ws://127.0.0.1:43164' },
      url: 'http://127.0.0.1:43163'
    }
  ]
});
