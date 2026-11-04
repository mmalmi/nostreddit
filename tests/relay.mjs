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
// NIP-50 search on the loopback relay must filter before applying the client's
// result budget, just as a public full-text relay would.
function matches(filters, event) {
  return filters.some(filter => matchFilters([filter], event) && (!filter.search ||
    [event.content, ...event.tags.filter(t => ['subject','title','t'].includes(t[0])).map(t => t[1])]
      .join(' ').toLowerCase().includes(filter.search.toLowerCase())));
}
const sessions = new Map();
const send = (socket, ...parts) => socket.send(JSON.stringify(parts));
relay.on('connection', (socket, request) => {
  // Playwright's offline network setting does not always disconnect worker WebSockets.
  // Gate just the isolated browser carrying this cookie; independent clients stay online.
  if (request.headers.cookie?.split(/;\s*/).includes('nostreddit_offline_fixture=1')) {
    socket.close(1013, 'Offline test browser');
    return;
  }
  const subscriptions = new Map();
  sessions.set(socket, subscriptions);
  socket.on('close', () => sessions.delete(socket));
  socket.on('message', (raw) => {
    const [command, id, ...filters] = JSON.parse(raw.toString());
    if (command === 'REQ') {
      subscriptions.set(id, filters);
      for (const record of records) if (matches(filters, record)) send(socket,'EVENT',id,record);
      send(socket,'EOSE',id);
    } else if (command === 'CLOSE') subscriptions.delete(id);
    else if (command === 'EVENT') {
      const event = id;
      if (!verifyEvent(event)) { send(socket,'OK',event.id,false,'invalid: signature'); return; }
      if (event.content.includes('/reject-for-test/')) { send(socket,'OK',event.id,false,'blocked: acceptance test'); return; }
      if (!records.some(record => record.id === event.id)) records.push(event);
      send(socket,'OK',event.id,true,'');
      for (const [subscriber, queries] of sessions) {
        for (const [key, filter] of queries) if (matches(filter, event)) send(subscriber,'EVENT',key,event);
      }
    }
  });
});
http.listen(Number(process.env.TEST_RELAY_PORT || 43164),'127.0.0.1');
