import type { Expansion } from './discovery/discussions';
import type { NostrEvent, NostrFilter } from 'nostr-pubsub';

const override = import.meta.env?.VITE_NOSTR_RELAYS?.trim();
export const testRelays = Boolean(override);
export const relayUrls = override ? [...new Set<string>(override.split(/[\s,]+/))].slice(0, 8) :
  ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://temp.iris.to'];
export const searchRelayUrls = testRelays ? relayUrls : ['wss://relay.ditto.pub', 'wss://search.nos.today'];
export type ContactQuery = { type:'contacts'; subject:string; mode:'followers'|'following'|'mutual'|'check'; authors?: string[]; cacheOnly?: boolean };
export type Request =
  | { type: 'watch'; id: number; filters: NostrFilter[]; live: boolean }
  | { type: 'close'; id: number }
  | { type: 'publish'; id: number; event: NostrEvent }
  | (ContactQuery & {id:number})
  | { type: 'search'; id: number; query: string; expansion: Expansion }
  | { type: 'latest'; id: number; kind: number; pubkey: string };
export type Response =
  | { type: 'events'; events: NostrEvent[] }
  | { type: 'status'; value: 'live' | 'offline' }
  | { type: 'result'; id: number; events: NostrEvent[]; error?: string };
