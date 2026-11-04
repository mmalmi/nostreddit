import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

mount(App, { target: document.getElementById('app')! });

// Only public release builds install an app shell; custom relay tests stay isolated.
if (import.meta.env.PROD && !import.meta.env.VITE_NOSTR_RELAYS && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, { once: true });
}
