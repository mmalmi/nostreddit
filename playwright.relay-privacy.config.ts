import { defineConfig } from '@playwright/test';
// Production defaults are intentional: VITE_NOSTR_RELAYS would hide fallback leaks.
export default defineConfig({
  testDir: 'tests', testMatch: 'relay-search-privacy.spec.ts', workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:43176', serviceWorkers: 'block' },
  webServer: {
    command: 'pnpm exec vite build --outDir .work/relay-privacy-dist && pnpm exec vite preview --outDir .work/relay-privacy-dist --port 43176 --strictPort',
    env: { VITE_NOSTR_RELAYS: '' }, url: 'http://127.0.0.1:43176',
  },
});
