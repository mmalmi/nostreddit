import { writable, type Readable } from 'svelte/store';
import { TopicCatalog, type CatalogEntry } from './topic-catalog';
import type { Post } from './posts';
import { readLocal, writeLocal } from './ui';

export const seenTopics = writable<CatalogEntry[]>([]);
const storageKey='seenTopics.v1';
export function startTopicCatalog(posts:Readable<Post[]>, comments:Readable<Post[]>, policy:Readable<(key:string)=>boolean>, observeAuthors:(keys:string[])=>void) {
  const catalog=new TopicCatalog();
  catalog.merge(readLocal(storageKey,null));
  observeAuthors(catalog.authors());
  let roots:Post[]=[], replies:Post[]=[], allowed:(key:string)=>boolean=()=>false;
  let updateTimer:ReturnType<typeof setTimeout>|undefined, saveTimer:ReturnType<typeof setTimeout>|undefined;
  let dirty=false, rendered='';
  const render=()=>{
    const entries=catalog.entries(allowed), next=JSON.stringify(entries);
    if(next!==rendered){rendered=next;seenTopics.set(entries);}
  };
  function flush() {
    clearTimeout(saveTimer);saveTimer=undefined;
    if(!dirty)return;
    // Merge another tab's compact dictionary before writing this tab's evidence.
    catalog.merge(readLocal(storageKey,null));
    writeLocal(storageKey,catalog.snapshot());dirty=false;render();
  }
  function update() {
    clearTimeout(updateTimer);updateTimer=undefined;
    dirty=catalog.observe([...roots,...replies].filter(p=>allowed(p.pubkey))) || dirty;
    render();
    if(dirty && !saveTimer)saveTimer=setTimeout(flush,1000);
  }
  const schedule=()=>{if(!updateTimer)updateTimer=setTimeout(update,80);};
  const stops=[posts.subscribe(value=>{roots=value;schedule();}),comments.subscribe(value=>{replies=value;schedule();}),
    policy.subscribe(value=>{allowed=value;schedule();})];
  const storage=(event:StorageEvent)=>{
    if(event.key!=='nostreddit.ui.'+storageKey)return;
    if(catalog.merge(readLocal(storageKey,null))){observeAuthors(catalog.authors());render();}
  };
  const leave=()=>{update();flush();};
  const visibility=()=>{if(document.hidden)leave();else schedule();};
  window.addEventListener('storage',storage);
  window.addEventListener('pagehide',leave);
  document.addEventListener('visibilitychange',visibility);
  return ()=>{
    stops.forEach(stop=>stop());leave();clearTimeout(updateTimer);clearTimeout(saveTimer);
    window.removeEventListener('storage',storage);window.removeEventListener('pagehide',leave);
    document.removeEventListener('visibilitychange',visibility);
  };
}
