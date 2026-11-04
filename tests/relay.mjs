// Loopback NIP-01 relay for the publishing acceptance test. Every run uses a fresh identity.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, verifyEvent, matchFilters } from 'nostr-tools';

const http = createServer((_req, res) => { res.end('Ready'); });
const relay = new WebSocketServer({ server: http });
const secret = generateSecretKey(), now = Math.floor(Date.now()/1000);
const signed = (kind, content, tags) => finalizeEvent({ kind, content, tags, created_at: now }, secret);
const records = [
  signed(0, JSON.stringify({name:'Field Observer', about:'Field notes from the coast.'}), []),
  signed(1, 'Notes from the coast\n\nWhat did you see on the trail this morning?', [['subject','Notes from the coast'],['t','photography']]),
  signed(1, 'An ephemeris on the archive shelf', [['subject','An ephemeris on the archive shelf'],['t','observatory']])
];
const sessions = new Map();
const send = (socket, ...parts) => socket.send(JSON.stringify(parts));
relay.on('connection', socket => {
  const subscriptions = new Map();
  sessions.set(socket, subscriptions);
  socket.on('close', () => sessions.delete(socket));
  socket.on('message', (raw) => {
    const [command, id, ...filters] = JSON.parse(raw.toString());
    if (command === 'REQ') {
      subscriptions.set(id, filters);
      for (const record of records) if (matchFilters(filters, record)) send(socket,'EVENT',id,record);
      send(socket,'EOSE',id);
    } else if (command === 'CLOSE') subscriptions.delete(id);
    else if (command === 'EVENT') {
      const event = id;
      if (!verifyEvent(event)) { send(socket,'OK',event.id,false,'invalid: signature'); return; }
      if (event.content.includes('/reject-for-test/')) { send(socket,'OK',event.id,false,'blocked: acceptance test'); return; }
      if (!records.some(record => record.id === event.id)) records.push(event);
      send(socket,'OK',event.id,true,'');
      for (const [subscriber, queries] of sessions) {
        for (const [key, filter] of queries) if (matchFilters(filter, event)) send(subscriber,'EVENT',key,event);
      }
    }
  });
});
http.listen(Number(process.env.TEST_RELAY_PORT || 43164),'127.0.0.1');
