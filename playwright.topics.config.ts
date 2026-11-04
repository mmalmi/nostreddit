import { defineConfig } from '@playwright/test';
process.env.NOSTREDDIT_TEST_RELAY_URL='ws://127.0.0.1:43274';
export default defineConfig({
  testDir:'tests',testMatch:'topic-catalog.spec.ts',workers:1,timeout:60_000,
  outputDir:'.work/topic-catalog-results',
  use:{baseURL:'http://127.0.0.1:43273',viewport:{width:1440,height:960}},
  webServer:[
    {command:'node tests/relay.mjs',env:{TEST_RELAY_PORT:'43274'},url:'http://127.0.0.1:43274'},
    {command:'pnpm exec vite build --outDir .work/topic-catalog-dist && pnpm exec vite preview --outDir .work/topic-catalog-dist --port 43273 --strictPort',env:{VITE_NOSTR_RELAYS:'ws://127.0.0.1:43274'},url:'http://127.0.0.1:43273'},
  ],
});
