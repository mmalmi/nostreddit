import type { Post } from './posts';
import { matchesTopic } from './posts';
import { discussionDocument, keywordScore } from './discovery/discussions';
import { planPostSearch } from './discovery/query';

export interface HotSignal { target:string; actor:string; at:number; kind:'like'|'reply'|'zap' }
export interface HotOptions {
  now?:number; follows?:ReadonlySet<string>; saved?:readonly Post[];
  distance?:(key:string)=>number|null|undefined; signals?:readonly HotSignal[];
  knownBy?:(key:string)=>number;
  influence?:(key:string)=>number|undefined;
  ai?:ReadonlyMap<string,number>; topic?:string; seen?:ReadonlySet<string>;
}
const HOUR=3600;
const documents=new WeakMap<Post,string>();
function fingerprint(post:Post) {
  let value=documents.get(post);
  if(value===undefined) {
    value=(post.title+' '+post.body+' '+post.url).normalize('NFKC').toLowerCase()
      .replace(/(?:nostr:)?(?:npub|note|nevent)1\w+|#[\p{L}\p{N}_-]+/gu,' ')
      .replace(/\s+/g,' ').trim().slice(0,500);
    documents.set(post,value);
  }
  return value;
}

/** Only graph-permitted inputs belong here. Count each reacting profile once;
 * replies have half weight and payment amounts do not add influence. */
export function hotScores(posts:readonly Post[], options:HotOptions={}) {
  const {now=Date.now()/1000,follows=new Set<string>(),signals=[],distance=()=>null}=options;
  const targets=new Map(posts.map(post=>[post.id,post]));
  const actors=new Map<string,Map<string,number>>();
  const trust=new Map<string,number>();
  const weight=(key:string)=>{
    if(!trust.has(key)) {
      const steps=distance(key);
      // Visibility is not endorsement. A single large follow list can put
      // thousands of unrelated profiles two hops away. Weight indirect support
      // by how many direct contacts independently follow the actor.
      const known=Math.max(0,options.knownBy?.(key) ?? 0);
      const influence=options.influence?.(key);
      trust.set(key,follows.has(key)||steps===1 ? 1.4
        :typeof influence==='number'&&Number.isFinite(influence) ? 1.4*Math.min(1,Math.max(0,influence))
        : steps===2 ? .06+.74*Math.min(1,known/20) : steps===3 ? .08 : .05);
    }
    return trust.get(key)!;
  };
  for(const signal of signals) {
    const post=targets.get(signal.target);
    if(!post || signal.actor===post.pubkey || !Number.isFinite(signal.at) || signal.at>now+600 || signal.at<post.created_at-600) continue;
    const crowd=actors.get(post.id)||new Map<string,number>();
    const age=Math.max(0,now-signal.at)/HOUR;
    const strength=(signal.kind==='reply'?.5:1)*weight(signal.actor)*Math.pow(.5,age/24);
    crowd.set(signal.actor,Math.max(crowd.get(signal.actor)||0,strength));
    actors.set(post.id,crowd);
  }
  const interests=new Set<string>();
  for(const post of (options.saved||[]).slice(0,32)) interests.add(post.topic);
  return posts.map(post=>{
    const age=Math.max(0,now-post.created_at)/HOUR;
    const crowd=actors.get(post.id);
    const engagement=[...(crowd?.values()||[])].reduce((sum,value)=>sum+value,0);
    const steps=distance(post.pubkey);
    const social=follows.has(post.pubkey)||steps===1 ? .65 : steps===2 ? .3 : 0;
    const interested=[...interests].some(topic=>matchesTopic(post,topic)) ? .45 : 0;
    const rawAI=options.ai?.get(post.id);
    // Weak incidental similarities are common on real timelines. They should
    // not amplify an unrelated shop announcement or a topical greeting.
    const ai=typeof rawAI==='number'&&Number.isFinite(rawAI)?Math.min(1,Math.max(0,(rawAI-.18)/.82)):0;
    // Freshness never freezes at a loading-time timestamp. Old high totals must
    // give way to conversations people are engaging with today.
    const meaning=options.ai?.size ? .35+4*ai : 1;
    const score=(1+3*Math.log1p(engagement)+social+interested+8*ai)*meaning*Math.pow(.5,Math.min(age,24*90)/36)
      *(options.seen?.has(post.id)?.65:1);
    return {post,score,engagement,age};
  });
}

export function rankHot(posts:readonly Post[],options:HotOptions={}) {
  const rows=hotScores(posts,options).sort((a,b)=>b.score-a.score||b.post.created_at-a.post.created_at||a.post.id.localeCompare(b.post.id));
  const authors=new Map<string,number>(), topics=new Map<string,number>(), copies=new Set<string>();
  const output:Post[]=[];
  // Diversity only needs a short frontier. At most 120 * 700 cheap comparisons;
  // no graph traversal, inference, timers, or content tokenization in this loop.
  while(rows.length && output.length<120) {
    let best=0, score=-Infinity;
    const explore=output.length%5===4 && rows.some(row=>row.age<24 && row.engagement===0 && !authors.has(row.post.pubkey) && !options.seen?.has(row.post.id));
    for(let i=0;i<rows.length;i++) {
      const row=rows[i], post=row.post;
      if(explore && (row.age>=24||row.engagement>0||authors.has(post.pubkey)||options.seen?.has(post.id))) continue;
      const value=row.score*Math.pow(.48,Math.min(4,authors.get(post.pubkey)||0))
        *(options.topic?1:Math.pow(.9,Math.min(5,topics.get(post.topic)||0)))
        *(fingerprint(post).length>30 && copies.has(fingerprint(post))?.08:1);
      if(value>score) {score=value;best=i;}
    }
    const {post}=rows.splice(best,1)[0];
    output.push(post); authors.set(post.pubkey,(authors.get(post.pubkey)||0)+1);
    topics.set(post.topic,(topics.get(post.topic)||0)+1); copies.add(fingerprint(post));
  }
  return [...output,...rows.map(row=>row.post)];
}

/** Membership is decided before AI. The model can never pull unrelated posts
 * into /t/topic or bypass a graph or mute filter. */
export function hotQuery(topic:string, preference:string, saved:readonly Post[]) {
  const explicit=preference.trim().slice(0,300);
  if(explicit) return explicit;
  if(topic) return topic.replace(/[_-]+/g,' ');
  return saved.slice(0,3).map(post=>post.title.slice(0,100)).join('. ').slice(0,500);
}

export function hotCandidates(posts:readonly Post[],social:readonly Post[],query:string) {
  if(!query)return [];
  const plan=planPostSearch(query);
  const literal=posts.filter(post=>hotMeaningText(post)).map(post=>({post,score:keywordScore(plan,post,'')})).filter(row=>row.score>0)
    .sort((a,b)=>b.score-a.score||b.post.created_at-a.post.created_at||a.post.id.localeCompare(b.post.id));
  // Give matching subjects a path into inference even when they are outside
  // the most-popular window. Include social leaders and some fresh discovery.
  const readable=social.filter(post=>hotMeaningText(post));
  const rows=[...readable.slice(0,24),...literal.slice(0,16).map(row=>row.post),...readable];
  return [...new Map(rows.map(post=>[post.id,post])).values()].slice(0,48);
}

const meaningTexts=new WeakMap<Post,string>();
export function hotMeaningText(post:Post) {
  let text=meaningTexts.get(post);
  if(text!==undefined)return text;
  // A hashtag is useful for retrieval, but isn't evidence of the meaning of
  // an otherwise empty photo, a block-height bot or a "GM #nostr" greeting.
  // Keep those posts in social ranking; don't invent an AI recommendation.
  text=discussionDocument(post).text.replace(/#[\p{L}\p{M}\p{N}_-]+/gu,' ').replace(/\s+/g,' ').trim();
  const terms=new Set(text.toLowerCase().match(/[\p{L}\p{M}]{2,}/gu)||[]);
  if(terms.size<4)text='';
  meaningTexts.set(post,text);
  return text;
}
