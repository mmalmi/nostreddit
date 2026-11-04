import type { NostrEvent, NostrFilter } from 'nostr-pubsub';

const override = import.meta.env?.VITE_NOSTR_RELAYS?.trim();
export const testRelays = Boolean(override);
export const relayUrls = override ? [...new Set<string>(override.split(/[\s,]+/))].slice(0, 8) :
  ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://temp.iris.to'];
export type Request =
  | { type: 'watch'; id: number; filters: NostrFilter[]; live: boolean }
  | { type: 'close'; id: number }
  | { type: 'publish'; id: number; event: NostrEvent }
  | { type: 'latest'; id: number; kind: number; pubkey: string };
export type Response =
  | { type: 'events'; events: NostrEvent[] }
  | { type: 'status'; value: 'live' | 'offline' }
  | { type: 'result'; id: number; events: NostrEvent[]; error?: string };
