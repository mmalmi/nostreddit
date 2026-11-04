import { UniqueIds } from 'nostr-social-graph';
import { topicSlug } from './hashtags';
import { postTopics, type Post } from './posts';

export const catalogLimits = {tags:512, authors:2048, perTag:64, pairs:8192, perPost:16, days:30} as const;
export type CatalogEntry = {slug:string; authors:number; latest:number};
type Pair = [id:number, at:number];
export type CatalogSnapshot = {version:1; authors:string[]; tags:[string,Pair[]][]};
const hex = /^[a-f0-9]{64}$/;
const compare = (a:string,b:string) => a < b ? -1 : a > b ? 1 : 0;
const recent = (at:unknown,now:number):at is number => typeof at==='number' && Number.isSafeInteger(at) && at>=now-catalogLimits.days*86400 && at<=now;

/** Bounded local evidence from verified posts, never a network-wide census.
 * IDs belong to this dictionary, not the replaceable social-graph snapshot. */
export class TopicCatalog {
  private ids = new UniqueIds();
  private tags = new Map<string,Map<number,number>>();

  observe(posts:readonly Post[], now=Math.floor(Date.now()/1000)):boolean {
    const before=this.fingerprint();
    let batch=0;
    for(const post of posts) {
      if(!hex.test(post.pubkey) || !recent(post.created_at,now))continue;
      const slugs=[...postTopics(post)].slice(0,catalogLimits.perPost);
      if(!slugs.length)continue;
      const id=this.ids.id(post.pubkey);
      for(const slug of slugs) {
        let users=this.tags.get(slug);
        if(!users){users=new Map();this.tags.set(slug,users);}
        users.set(id,Math.max(users.get(id) ?? 0,post.created_at));
      }
      // Bound intermediate memory as well as the final persisted representation.
      if(++batch%32===0)this.prune(now);
    }
    this.prune(now);
    return this.fingerprint()!==before;
  }

  private prune(now:number) {
    const all:[string,number,number][]=[];
    for(const [slug,users] of this.tags) {
      for(const [id,at] of users)if(recent(at,now))all.push([slug,id,at]);
    }
    all.sort((a,b)=>b[2]-a[2] || compare(a[0],b[0]) || compare(this.ids.str(a[1]),this.ids.str(b[1])));
    const tags=new Map<string,Map<number,number>>(), authors=new Set<number>();
    let pairs=0;
    for(const [slug,id,at] of all) {
      if(pairs>=catalogLimits.pairs)break;
      if(!authors.has(id) && authors.size>=catalogLimits.authors)continue;
      if(!tags.has(slug) && tags.size>=catalogLimits.tags)continue;
      const users=tags.get(slug) ?? new Map<number,number>();
      if(users.size>=catalogLimits.perTag)continue;
      users.set(id,at);tags.set(slug,users);authors.add(id);pairs++;
    }
    this.tags=tags;
    for(const [id] of this.ids)if(!authors.has(id))this.ids.remove(id);
  }

  entries(allowed:(key:string)=>boolean=()=>true,now=Math.floor(Date.now()/1000)):CatalogEntry[] {
    return [...this.tags].flatMap(([slug,users])=>{
      const visible=[...users].filter(([id,at])=>recent(at,now) && allowed(this.ids.str(id)));
      return visible.length ? [{slug,authors:visible.length,latest:Math.max(...visible.map(([,at])=>at))}] : [];
    }).sort((a,b)=>b.authors-a.authors || b.latest-a.latest || compare(a.slug,b.slug));
  }
  authors() {return [...this.ids].map(([,key])=>key);}
  snapshot():CatalogSnapshot {
    const authors=this.authors().sort(compare), indexes=new Map(authors.map((key,i)=>[key,i]));
    return {version:1,authors,tags:[...this.tags].sort(([a],[b])=>compare(a,b)).map(([slug,users])=>
      [slug,[...users].map(([id,at]):Pair=>[indexes.get(this.ids.str(id))!,at]).sort((a,b)=>a[0]-b[0])])};
  }
  private fingerprint() {return JSON.stringify(this.snapshot());}

  merge(value:unknown,now=Math.floor(Date.now()/1000)):boolean {
    const before=this.fingerprint();
    if(!value || typeof value!=='object')return false;
    const input=value as Partial<CatalogSnapshot>;
    if(input.version!==1 || !Array.isArray(input.authors) || !Array.isArray(input.tags) ||
      input.authors.length>catalogLimits.authors || input.tags.length>catalogLimits.tags)return false;
    let pairs=0;
    for(const item of input.tags) {
      if(!Array.isArray(item) || item.length!==2)continue;
      const [slug,users]=item;
      if(typeof slug!=='string' || !slug || topicSlug(slug)!==slug || !Array.isArray(users) || users.length>catalogLimits.perTag)continue;
      for(const pair of users) {
        if(++pairs>catalogLimits.pairs)break;
        if(!Array.isArray(pair) || pair.length!==2)continue;
        const [index,at]=pair;
        if(!Number.isSafeInteger(index) || index<0 || !recent(at,now))continue;
        const key=input.authors[index];
        if(typeof key!=='string' || !hex.test(key))continue;
        const id=this.ids.id(key), target=this.tags.get(slug) ?? new Map<number,number>();
        target.set(id,Math.max(target.get(id) ?? 0,at));this.tags.set(slug,target);
      }
      this.prune(now);
      if(pairs>catalogLimits.pairs)break;
    }
    this.prune(now);
    return before!==this.fingerprint();
  }
}
