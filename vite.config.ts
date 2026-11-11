import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Keep the optional model, runtime and worker out of the first-visit offline shell.
const assets = ({names}: {names: string[]}) => {
  const optional = names.some(name => /^(search-|ort-wasm-)/.test(name));
  return (optional ? 'assets/search/' : 'assets/') + '[name]-[hash][extname]';
};
// A cold visit shows the bundled starter feed first. Fetch it and its worker
// alongside the app instead of after it.
const startupPreloads = (): Plugin => ({
  name: 'startup-preloads', apply: 'build',
  transformIndexHtml: { order: 'post', handler(_html, {bundle}) {
    const link = (attrs: Record<string, string | boolean>) => ({tag: 'link', attrs, injectTo: 'head' as const});
    return [
      ...Object.keys(bundle ?? {}).filter(file => /^assets\/relay\.worker-[^/]+\.js$/.test(file))
        .map(file => link({rel: 'modulepreload', href: '/' + file})),
      link({rel: 'preload', as: 'fetch', crossorigin: true, href: '/starter-feed.json'}),
    ];
  }},
});
export default defineConfig({
  plugins: [
    svelte(),
    startupPreloads(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // main.ts owns registration. Let a new worker wait for older tabs to close.
      injectRegister: false,
      registerType: 'prompt',
      manifest: {
        id: '/', name: 'Nostreddit', short_name: 'Nostreddit',
        description: 'Topic discussions on Nostr',
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
