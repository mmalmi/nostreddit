// Populate an isolated loopback relay before (never during) performance samples.
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
const url=process.argv[2];
if(!url || new URL(url).hostname!=='127.0.0.1') throw new Error('Provide an isolated loopback relay URL');
const socket=new WebSocket(url);
try {
  await once(socket,'open');
  const now=Math.floor(Date.now()/1000), events=[];
  for(let author=1;author<=12;author++) {
    const secret=new Uint8Array(32);secret[31]=author;
    const sign=(kind,content,tags,created_at)=>finalizeEvent({kind,content,tags,created_at},secret);
    events.push(sign(0,JSON.stringify({name:'Benchmark author '+author}),[],now));
    for(let post=0;post<6;post++) {
      const root=sign(1,`Field observation ${author}-${post}\n\nA reproducible discussion about light, landscapes, and photography.`,[['subject',`Field observation ${author}-${post}`],['t','photography']],now-post);
      events.push(root,sign(1,'A measured reply to the field notes.',[['e',root.id,'','root']],now+1));
    }
  }
  for(const event of events) {
    const reply=once(socket,'message');socket.send(JSON.stringify(['EVENT',event]));
    const [raw]=await reply; const ack=JSON.parse(raw.toString());
    if(ack[0]!=='OK'||ack[2]!==true) throw new Error('Fixture event rejected');
  }
  console.log(JSON.stringify({events:events.length,authors:12,posts:72,replies:72}));
} finally {socket.close();}
