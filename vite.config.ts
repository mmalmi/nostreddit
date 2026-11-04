import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Keep the optional model, runtime and worker out of the first-visit offline shell.
const assets = ({names}: {names: string[]}) => {
  const optional = names.some(name => /^(search-|ort-wasm-)/.test(name));
  return (optional ? 'assets/search/' : 'assets/') + '[name]-[hash][extname]';
};
export default defineConfig({
  plugins: [svelte()],
  build: {rollupOptions:{output:{assetFileNames:assets}}},
  worker: {format:'es', rollupOptions:{output:{
    assetFileNames:assets,
    entryFileNames: chunk => (chunk.name === 'meaning.worker' ? 'assets/search/' : 'assets/') + '[name]-[hash].js',
  }}},
  server: { host: '127.0.0.1', port: 43162, strictPort: true },
  preview: { host: '127.0.0.1', port: 43162, strictPort: true }
});
