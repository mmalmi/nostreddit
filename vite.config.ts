import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 43162, strictPort: true },
  preview: { host: '127.0.0.1', port: 43162, strictPort: true }
});
