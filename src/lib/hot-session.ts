import { writable } from 'svelte/store';
import type { Post } from './posts';
import { readLocal, writeLocal } from './ui';
import { hotMeaningText } from './hot';
import type { HotWork, HotReply } from './discovery/hot.worker';

type Status='idle'|'loading'|'ready'|'unavailable';
interface State {status:Status;scores:ReadonlyMap<string,number>}
type Cache={query:string;scores:[string,number][]}[];
const empty=():State=>({status:'idle',scores:new Map()});
export function createHotSession() {
  const store=writable<State>(empty());
  let state=empty(),query='',scope='',ids='',run=0,spent=0,active=false;
  let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>,watchdog:ReturnType<typeof setTimeout>;
  let latest:Post[]=[];
  const raw=readLocal<Cache>('hotMeaning.v2',[]);
  const cache:Cache=Array.isArray(raw)?raw.filter(row=>typeof row?.query==='string'&&Array.isArray(row.scores))
    .slice(0,3).map(row=>({query:row.query.slice(0,500),scores:row.scores.filter(pair=>Array.isArray(pair)&&
      /^[a-f0-9]{64}$/.test(pair[0])&&Number.isFinite(pair[1])&&pair[1]>=0&&pair[1]<=1).slice(-96)})):[];
  function set(next:State){state=next;store.set(next);}
  function stop(){clearTimeout(timer);clearTimeout(watchdog);worker?.terminate();worker=undefined;active=false;run++;}
  function save(){
    const index=cache.findIndex(row=>row.query===query);if(index>=0)cache.splice(index,1);
    cache.unshift({query,scores:[...state.scores].slice(-96)});cache.splice(3);
    writeLocal('hotMeaning.v2',cache);
  }
  function failed(){stop();set({...state,status:'unavailable'});}
  function work(){
    if(active||state.status==='unavailable'||!query)return;
    const documents=latest.filter(post=>!state.scores.has(post.id)).slice(0,Math.min(48,72-spent))
      .map(post=>({id:post.id,text:hotMeaningText(post)}));
    if(!documents.length){set({...state,status:'ready'});return;}
    active=true;spent+=documents.length;run++;set({...state,status:'loading'});
    try {
      if(!worker){
        worker=new Worker(new URL('./discovery/hot.worker.ts',import.meta.url),{type:'module'});
        worker.onerror=failed;worker.onmessageerror=failed;
        worker.onmessage=({data}:MessageEvent<HotReply>)=>{
          if(data.run!==run)return;
          if('error'in data){failed();return;}
          const scores=new Map(state.scores);for(const [id,value] of data.scores)scores.set(id,value);
          set({status:data.done?'ready':'loading',scores});
          if(data.done){
            active=false;clearTimeout(watchdog);save();
            // Free the runtime when no more documents arrive. No idle polling.
            clearTimeout(timer);timer=setTimeout(()=>{worker?.terminate();worker=undefined;},20_000);
            if(latest.some(post=>!scores.has(post.id))&&spent<72){clearTimeout(timer);timer=setTimeout(work,600);}
          }
        };
      }
      watchdog=setTimeout(failed,45_000);
      worker.postMessage({run,query,documents} satisfies HotWork);
    } catch {failed();}
  }
  function update(nextQuery:string,posts:Post[],nextScope:string){
    if(!nextQuery){if(query||worker){stop();query='';ids='';set(empty());}return;}
    if(nextQuery!==query||scope!==nextScope){
      stop();query=nextQuery;scope=nextScope;spent=0;ids='';
      set({status:'idle',scores:new Map(cache.find(row=>row.query===query)?.scores||[])});
    }
    latest=posts.slice(0,48);
    const nextIds=latest.map(post=>post.id).sort().join(',');
    if(ids===nextIds)return;
    ids=nextIds;
    if(!active){clearTimeout(timer);timer=setTimeout(work,600);}
  }
  return {subscribe:store.subscribe,update,reset:()=>{stop();query='';scope='';ids='';set(empty());}};
}
