// Replay verified public events without networking or writing application state.
// Usage: pnpm exec tsx scripts/compare-ranking.ts SNAPSHOT ROOT EVENTS.json[l] ...
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {SocialGraph} from 'nostr-social-graph';
import {calculateRanking,createRankingSnapshot} from 'nostr-social-graph/ranking';
import {verifyEvent,type Event} from 'nostr-tools/pure';
import {asPost} from '../src/lib/posts';
import {badgesFor} from '../src/lib/graph-model';
import {hotScores,rankHot,type HotSignal} from '../src/lib/hot';
const [file,root,...inputs]=process.argv.slice(2);
if(!file||!root||!inputs.length)throw Error('Provide a graph snapshot, public root, and signed JSON/JSONL event files');
const all=new Map<string,Event>();
for(const path of inputs){
 const text=readFileSync(path,'utf8').trim();
 const rows:Event[]=text.startsWith('[')?JSON.parse(text):text.split('\n').filter(Boolean).map(line=>JSON.parse(line));
 for(const event of rows){if(!verifyEvent(event))throw Error('Invalid signed event');all.set(event.id,event);}
}
const graph=await SocialGraph.fromBinary(root,readFileSync(file));
const badges=badgesFor(graph,[...new Set([...all.values()].map(e=>e.pubkey))]);
const visible=(key:string)=>{const b=badges[key];return b&&b.distance!==null&&b.distance<=5&&!b.muted&&!b.overmuted;};
const posts=[...all.values()].map(asPost).filter(p=>p&&!p.parent&&visible(p.pubkey));
const signals:HotSignal[]=[];
for(const e of all.values()){
 if(!visible(e.pubkey))continue;
 if(e.kind===7&&['+',''].includes(e.content)){const target=e.tags.filter(t=>t[0]==='e').at(-1)?.[1];if(target)signals.push({target,actor:e.pubkey,at:e.created_at,kind:'like'});}
 const reply=asPost(e);
 if(reply?.parent)for(const target of new Set([reply.parent,reply.root]))if(target)signals.push({target,actor:e.pubkey,at:e.created_at,kind:'reply'});
}
const start=performance.now(),snapshot=createRankingSnapshot(graph),prepareMs=performance.now()-start;
const now=Date.now()/1000;
const options={now,signals,distance:(key:string)=>badges[key]?.distance,knownBy:(key:string)=>badges[key]?.followedByFriends??0};
const variants:any={};
for(const name of ['distance_no_replies','distance','pagerank','graperank'] as const){
 const at=performance.now();
 const ranks=name==='pagerank'||name==='graperank'?calculateRanking(snapshot,{algorithm:name}):undefined;
 const option={...options,signals:name==='distance_no_replies'?signals.filter(s=>s.kind!=='reply'):signals,
   influence:ranks?(key:string)=>ranks.directSeed>0?Math.min(1,ranks.get(key)/ranks.directSeed):0:undefined};
 const scored=new Map(hotScores(posts,option).map(row=>[row.post.id,row]));
 const ordered=rankHot(posts,option);
 variants[name]={calculationMs:performance.now()-at,converged:ranks?.converged,
   top:ordered.slice(0,15).map(post=>({id:post.id,title:post.title,engagement:scored.get(post.id)!.engagement,score:scored.get(post.id)!.score})),
   ranks:ordered.map((post,index)=>({id:post.id,rank:index+1,engagement:scored.get(post.id)!.engagement}))};
}
console.log(JSON.stringify({events:all.size,posts:posts.length,signals:signals.length,now,prepareMs,variants},null,2));
