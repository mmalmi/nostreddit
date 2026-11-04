import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Keep the optional model, runtime and worker out of the first-visit offline shell.
const assets = ({names}: {names: string[]}) => {
  const optional = names.some(name => /^(search-|ort-wasm-)/.test(name));
  return (optional ? 'assets/search/' : 'assets/') + '[name]-[hash][extname]';
};
export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // main.ts owns registration. Let a new worker wait for older tabs to close.
      injectRegister: false,
      registerType: 'prompt',
      manifest: {
        id: '/', name: 'Nostreddit', short_name: 'Nostreddit',
        description: 'Community discussions on Nostr',
        lang: 'en', scope: '/', start_url: '/', display: 'standalone',
        background_color: '#f5f5ee', theme_color: '#163f31',
        icons: [
          {src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
          {src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
          {src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
        ],
      },
      injectManifest: {
        // The worker uses this list to recognize optional hashed assets, without
        // fetching search models or their WASM runtime at install.
        globPatterns: ['index.html', 'manifest.webmanifest', 'favicon.svg', 'icons/*.png',
          'socialGraph.bin', 'starter-feed.json', 'assets/**/*'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        dontCacheBustURLsMatching: /^assets\/.+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/,
        rollupFormat: 'iife',
      },
    }),
  ],
  build: {rollupOptions:{output:{assetFileNames:assets}}},
  worker: {format:'es', rollupOptions:{output:{
    assetFileNames:assets,
    entryFileNames: chunk => (['meaning.worker','hot.worker'].includes(chunk.name) ? 'assets/search/' : 'assets/') + '[name]-[hash].js',
  }}},
  server: { host: '127.0.0.1', port: 43162, strictPort: true },
  preview: { host: '127.0.0.1', port: 43162, strictPort: true }
});
