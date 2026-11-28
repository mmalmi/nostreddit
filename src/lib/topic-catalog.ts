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

type ChangeState = {mutated:boolean; perTagOver:boolean; before?:string};

/** Bounded local evidence from verified posts, never a network-wide census.
 * IDs belong to this dictionary, not the replaceable social-graph snapshot. */
export class TopicCatalog {
  private ids = new UniqueIds();
  private tags = new Map<string,Map<number,number>>();
  private pairs = 0;
  private oldest = Infinity;

  private addPair(slug:string, key:string, at:number, now:number, state:ChangeState) {
    const users = this.tags.get(slug);
    const known = this.ids.has(key);
    const existingId = known ? this.ids.id(key) : -1;
    const prev = known && users ? users.get(existingId) : undefined;
    if (prev !== undefined && at <= prev) return;
    const isNew = prev === undefined;
    if (state.before === undefined && isNew && (
      this.pairs >= catalogLimits.pairs ||
      (!users && this.tags.size >= catalogLimits.tags) ||
      (!known && this.ids.size >= catalogLimits.authors) ||
      (users !== undefined && users.size >= catalogLimits.perTag)
    )) {
      state.before = this.fingerprint();
    }
    const id = known ? existingId : this.ids.id(key);
    const target = users ?? new Map<number,number>();
    if (!users) this.tags.set(slug, target);
    target.set(id, at);
    if (isNew) {
      this.pairs++;
      if (target.size > catalogLimits.perTag) state.perTagOver = true;
    }
    if (at < this.oldest) this.oldest = at;
    state.mutated = true;
    // Bound intermediate memory as well as the final persisted representation.
    if (this.pairs > catalogLimits.pairs * 2 || this.tags.size > catalogLimits.tags * 2 || this.ids.size > catalogLimits.authors * 2) {
      this.prune(now);
      state.perTagOver = false;
    }
  }

  private finish(now:number, state:ChangeState):boolean {
    const expired = this.oldest < now - catalogLimits.days * 86400;
    const overLimit = state.perTagOver || this.pairs > catalogLimits.pairs ||
      this.tags.size > catalogLimits.tags || this.ids.size > catalogLimits.authors;
    if (!state.mutated && !expired) return false;
    if (expired || overLimit) this.prune(now);
    return state.before !== undefined ? this.fingerprint() !== state.before : true;
  }

  observe(posts:readonly Post[], now=Math.floor(Date.now()/1000)):boolean {
    const state: ChangeState = {mutated:false, perTagOver:false};
    for(const post of posts) {
      if(!hex.test(post.pubkey) || !recent(post.created_at,now))continue;
      let count=0;
      for(const slug of postTopics(post)) {
        this.addPair(slug, post.pubkey, post.created_at, now, state);
        if(++count>=catalogLimits.perPost)break;
      }
    }
    return this.finish(now, state);
  }

  private prune(now:number) {
    const all:[string,number,number][]=[];
    for(const [slug,users] of this.tags) {
      for(const [id,at] of users)if(recent(at,now))all.push([slug,id,at]);
    }
    all.sort((a,b)=>b[2]-a[2] || compare(a[0],b[0]) || compare(this.ids.str(a[1]),this.ids.str(b[1])));
    const tags=new Map<string,Map<number,number>>(), authors=new Set<number>();
    let pairs=0, oldest=Infinity;
    for(const [slug,id,at] of all) {
      if(pairs>=catalogLimits.pairs)break;
      if(!authors.has(id) && authors.size>=catalogLimits.authors)continue;
      if(!tags.has(slug) && tags.size>=catalogLimits.tags)continue;
      const users=tags.get(slug) ?? new Map<number,number>();
      if(users.size>=catalogLimits.perTag)continue;
      users.set(id,at);tags.set(slug,users);authors.add(id);pairs++;
      if(at<oldest)oldest=at;
    }
    this.tags=tags;
    this.pairs=pairs;
    this.oldest=oldest;
    for(const [id] of this.ids)if(!authors.has(id))this.ids.remove(id);
  }

  entries(allowed:(key:string)=>boolean=()=>true,now=Math.floor(Date.now()/1000)):CatalogEntry[] {
    const out: CatalogEntry[] = [];
    for(const [slug,users] of this.tags) {
      let authors=0, latest=0;
      for(const [id,at] of users) {
        if(!recent(at,now) || !allowed(this.ids.str(id)))continue;
        authors++;
        if(at>latest)latest=at;
      }
      if(authors)out.push({slug,authors,latest});
    }
    return out.sort((a,b)=>b.authors-a.authors || b.latest-a.latest || compare(a.slug,b.slug));
  }
  authors() {return [...this.ids].map(([,key])=>key);}
  snapshot():CatalogSnapshot {
    const authors=this.authors().sort(compare), indexes=new Map(authors.map((key,i)=>[key,i]));
    return {version:1,authors,tags:[...this.tags].sort(([a],[b])=>compare(a,b)).map(([slug,users])=>
      [slug,[...users].map(([id,at]):Pair=>[indexes.get(this.ids.str(id))!,at]).sort((a,b)=>a[0]-b[0])])};
  }
  private fingerprint() {return JSON.stringify(this.snapshot());}

  merge(value:unknown,now=Math.floor(Date.now()/1000)):boolean {
    if(!value || typeof value!=='object')return false;
    const input=value as Partial<CatalogSnapshot>;
    if(input.version!==1 || !Array.isArray(input.authors) || !Array.isArray(input.tags) ||
      input.authors.length>catalogLimits.authors || input.tags.length>catalogLimits.tags)return false;
    const state: ChangeState = {mutated:false, perTagOver:false};
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
        this.addPair(slug, key, at, now, state);
      }
      if(pairs>catalogLimits.pairs)break;
    }
    return this.finish(now, state);
  }
}
