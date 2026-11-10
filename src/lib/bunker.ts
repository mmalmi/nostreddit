import { generateSecretKey, type EventTemplate } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { MemoryEventStore, NostrRuntime } from 'nostr-pubsub';
import { connectRemoteNostrIdentitySigner, parseBunkerConnection, type RemoteNostrIdentitySigner } from '@iris/identity/remoteSigner';

export interface BunkerSession { connection: string; clientKey: string }
interface Interaction { signal: AbortSignal; onAuth: (url: string) => void }

export function readBunkerSession(value: unknown): BunkerSession | undefined {
  if (!value || typeof value !== 'object') return;
  const session = value as BunkerSession;
  if (typeof session.connection !== 'string' || typeof session.clientKey !== 'string' || !/^[a-f0-9]{64}$/.test(session.clientKey)) return;
  try {
    if (parseBunkerConnection(session.connection).secret) return;
    return { connection: session.connection, clientKey: session.clientKey };
  } catch { return; }
}

// This channel has no feed relays, persistent event store or publication queue.
// Keep only its client credential between actions; close every network exchange.
async function withSigner<T>(session: BunkerSession, resume: boolean, interaction: Interaction,
  action: (signer: RemoteNostrIdentitySigner) => Promise<T>): Promise<T> {
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
  try { parseBunkerConnection(connection); }
  catch { throw new Error('Enter a valid bunker:// link from your signer, including its relay.'); }
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
