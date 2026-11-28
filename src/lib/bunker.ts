import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { EventTemplate } from 'nostr-tools/pure';
import type { RemoteNostrIdentitySigner } from '@iris/identity/remoteSigner';

export interface BunkerSession { connection: string; clientKey: string }
interface Interaction { signal: AbortSignal; onAuth: (url: string) => void }

function validBunkerUrl(value: string, allowSecret: boolean): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'bunker:' || !/^[a-f0-9]{64}$/.test(url.hostname) ||
        (url.pathname && url.pathname !== '/') || url.username || url.password || url.port || url.hash) return false;
    if (!allowSecret && url.searchParams.get('secret')) return false;
    const relays = new Set<string>();
    for (const raw of url.searchParams.getAll('relay')) {
      const relay = new URL(raw);
      if (!['wss:', 'ws:'].includes(relay.protocol) || relay.username || relay.password || relay.hash) return false;
      relays.add(relay.toString());
    }
    return relays.size > 0 && relays.size <= 8;
  } catch { return false; }
}

export function readBunkerSession(value: unknown): BunkerSession | undefined {
  if (!value || typeof value !== 'object') return;
  const session = value as BunkerSession;
  if (typeof session.connection !== 'string' || typeof session.clientKey !== 'string' || !/^[a-f0-9]{64}$/.test(session.clientKey)) return;
  return validBunkerUrl(session.connection, false) ? { connection: session.connection, clientKey: session.clientKey } : undefined;
}

// This channel has no feed relays, persistent event store or publication queue.
// Keep only its client credential between actions; close every network exchange.
async function withSigner<T>(session: BunkerSession, resume: boolean, interaction: Interaction,
  action: (signer: RemoteNostrIdentitySigner) => Promise<T>): Promise<T> {
  interaction.signal.throwIfAborted();
  const [{ MemoryEventStore, NostrRuntime }, { connectRemoteNostrIdentitySigner }] = await Promise.all([
    import('nostr-pubsub'),
    import('@iris/identity/remoteSigner'),
  ]);
  interaction.signal.throwIfAborted();
  const runtime = new NostrRuntime({relays:[], store:new MemoryEventStore(32), publishTimeoutMs:10_000});
  const key = hexToBytes(session.clientKey);
  let signer: RemoteNostrIdentitySigner | undefined;
  let listening = Promise.resolve(false);
  try {
    signer = await connectRemoteNostrIdentitySigner({
      connection:session.connection, clientSecretKey:key, resume, switchRelays:!resume,
      permissions:'sign_event', clientMetadata:{name:'Nostreddit', url:'https://nostreddit.iris.to'},
      timeoutMs:90_000, signal:interaction.signal, onAuth:interaction.onAuth,
      transport: {
        subscribe: (relays, filters, receive) => {
          let ready!: (value:boolean) => void;
          listening = new Promise(resolve => {ready = resolve;});
          const subscription = runtime.subscribe(filters, {
            onEvent:receive,
            onEose:status => ready(status.sources.some(source => source.complete)),
          }, {relays, sources:[], cache:'network-only', localEcho:false, signal:interaction.signal, deadline:Date.now()+10_000});
          return {close:() => {ready(false); subscription.close();}};
        },
        publish: async (relays, event) => {
          // The runtime batches subscriptions. Wait for relay readiness so a
          // fast signer cannot answer before its response subscription exists.
          if (!await listening) throw new Error('Could not reach signer');
          interaction.signal.throwIfAborted();
          const result = await runtime.publish(event, {relays, sources:[], requireAck:true, queue:false, localEcho:false});
          if (!result.remoteAccepted) throw new Error('Could not reach signer');
        },
      },
    });
    return await action(signer);
  } catch (error) {
    if (interaction.signal.aborted) throw new Error('Signer request cancelled.');
    if (error instanceof Error && /did not respond/.test(error.message)) throw new Error('The signer did not respond. Open your signer and try again.');
    // Remote errors can contain the pairing token or event data.
    throw new Error('Could not complete the signer request. Check your signer and try again.');
  } finally {
    await signer?.close();
    key.fill(0);
    await runtime.close();
  }
}

export async function pairBunker(connection: string, interaction: Interaction) {
  if (!validBunkerUrl(connection, true)) throw new Error('Enter a valid bunker:// link from your signer, including its relay.');
  interaction.signal.throwIfAborted();
  const { generateSecretKey } = await import('nostr-tools/pure');
  const key = generateSecretKey();
  const session = {connection:connection.trim(), clientKey:bytesToHex(key)};
  key.fill(0);
  return withSigner(session, false, interaction, async signer => ({
    pubkey:await signer.getPublicKey(),
    bunker:{...session, connection:signer.connection},
  }));
}

export async function signWithBunker(session: BunkerSession, pubkey: string, draft: EventTemplate, interaction: Interaction) {
  return withSigner(session, true, interaction, async signer => {
    if (await signer.getPublicKey() !== pubkey) throw new Error('Signer profile changed');
    return signer.signEvent(draft);
  });
}
