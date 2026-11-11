import type { Expansion } from './discovery/discussions';
import type { SearchCursors } from './discovery/relay-search';
import type { NostrEvent, NostrFilter } from 'nostr-pubsub';

const override = import.meta.env?.VITE_NOSTR_RELAYS?.trim();
export const testRelays = Boolean(override);
export const previousRelayUrls = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://temp.iris.to'];
export const relayUrls = override ? [...new Set<string>(override.split(/[\s,]+/))].slice(0, 8) :
  ['wss://relay.ditto.pub', ...previousRelayUrls];
export const searchRelayUrls = testRelays ? relayUrls : ['wss://relay.ditto.pub', 'wss://search.nos.today'];
export type ContactQuery = { type:'contacts'; subject:string; mode:'followers'|'following'|'mutual'|'check'; authors?: string[]; cacheOnly?: boolean };
export type Request =
  | { type: 'watch'; id: number; filters: NostrFilter[]; live: boolean }
  | { type: 'configure'; urls: string[] }
  | { type: 'close'; id: number }
  | { type: 'publish'; id: number; event: NostrEvent }
  | (ContactQuery & {id:number})
  | { type: 'search'; id: number; query: string; expansion: Expansion; cursors?: SearchCursors }
  | { type: 'latest'; id: number; kind: number; pubkey: string };
export type Response =
  | { type: 'events'; events: NostrEvent[] }
  | { type: 'status'; value: 'live' | 'offline' }
  // Results of a request that is still reading relays. Its 'result' follows.
  | { type: 'found'; id: number; events: NostrEvent[] }
  | { type: 'result'; id: number; events: NostrEvent[]; cursors?: SearchCursors; error?: string };
