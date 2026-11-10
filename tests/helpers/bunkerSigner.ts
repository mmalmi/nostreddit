import {once} from 'node:events';
import {WebSocketServer, type WebSocket} from 'ws';
import {finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type Event} from 'nostr-tools/pure';
import {matchFilters, type Filter} from 'nostr-tools/filter';
import {v2 as nip44} from 'nostr-tools/nip44';

/** Real NIP-46 encryption and signatures; all traffic stays on an isolated loopback relay. */
export async function createBunkerSigner() {
  const server = new WebSocketServer({host:'127.0.0.1', port:0});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No signer port');
  const relay = `ws://127.0.0.1:${address.port}/`;
  const transportKey = generateSecretKey(), accountKey = generateSecretKey();
  const pubkey = getPublicKey(accountKey), remotePubkey = getPublicKey(transportKey);
  const clients = new Set<string>();
  const requests: {method:string; params:string[]; client:string}[] = [];
  const commands: string[] = [];
  const signed: Event[] = [], traffic: Event[] = [];
  const subscriptions = new Map<WebSocket, Map<string, Filter[]>>();
  const approvals: (() => void)[] = [];
  const control = {silent:false, denied:false, mutate:false, auth:false, authUrl:'https://signer.example/approve', owner:pubkey};
  let paired = false;
  const send = (socket:WebSocket, ...values:unknown[]) => {if (socket.readyState === 1) socket.send(JSON.stringify(values));};
  function broadcast(event:Event) {
    for (const [socket, interests] of subscriptions) for (const [id, filters] of interests) {
      if (matchFilters(filters,event)) send(socket,'EVENT',id,event);
    }
  }
  server.on('connection', socket => {
    const interests = new Map<string,Filter[]>(); subscriptions.set(socket,interests);
    socket.on('close', () => subscriptions.delete(socket));
    socket.on('message', raw => {
      const [type, value, ...filters] = JSON.parse(raw.toString());
      commands.push(type);
      if (type === 'REQ') {interests.set(value,filters); send(socket,'EOSE',value); return;}
      if (type === 'CLOSE') {interests.delete(value); return;}
      if (type !== 'EVENT') return;
      const event = value as Event; traffic.push(event);
      if (!verifyEvent(event) || event.kind !== 24133 || !event.tags.some(tag => tag[0] === 'p' && tag[1] === remotePubkey)) {
        send(socket,'OK',event.id,false,'invalid: signing channel only'); return;
      }
      send(socket,'OK',event.id,true,'');
      const conversation = nip44.utils.getConversationKey(transportKey,event.pubkey);
      const request = JSON.parse(nip44.decrypt(event.content,conversation));
      requests.push({...request,client:event.pubkey});
      const respond = (result?:string,error?:string) => broadcast(finalizeEvent({kind:24133, created_at:Math.floor(Date.now()/1000),
        tags:[['p',event.pubkey]], content:nip44.encrypt(JSON.stringify({id:request.id,result,error}),conversation)},transportKey));
      const complete = () => {
        if (control.denied) {respond(undefined,'Denied by user'); return;}
        if (request.method === 'connect') {
          if (paired || request.params[1] !== 'single-use-secret') {respond(undefined,'Pairing token already used'); return;}
          paired = true; clients.add(event.pubkey); respond('ack'); return;
        }
        if (!clients.has(event.pubkey)) {respond(undefined,'Not paired'); return;}
        if (request.method === 'switch_relays') respond('null');
        else if (request.method === 'get_public_key') respond(control.owner);
        else if (request.method === 'sign_event') {
          const draft = JSON.parse(request.params[0]);
          if (control.mutate) draft.content = 'Replaced by signer';
          const result = finalizeEvent(draft,accountKey); signed.push(result); respond(JSON.stringify(result));
        } else respond(undefined,'Unsupported method');
      };
      if (control.silent) {approvals.push(complete); return;}
      if (control.auth && ['connect','sign_event'].includes(request.method)) {
        respond('auth_url',control.authUrl); approvals.push(complete);
      } else complete();
    });
  });
  return {
    link:`bunker://${remotePubkey}?relay=${encodeURIComponent(relay)}&secret=single-use-secret`,
    relay, pubkey, remotePubkey, requests, signed, traffic, control, commands,
    get connections() {return subscriptions.size;},
    approve() {for (const complete of approvals.splice(0)) complete();},
    async close() {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
