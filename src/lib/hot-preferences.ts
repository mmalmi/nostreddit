import { writable } from 'svelte/store';
import { readLocal, writeLocal } from './ui';
export interface HotPreferences { ai:boolean; interests:string }
function clean(raw:Partial<HotPreferences>|null):HotPreferences {
  return {ai:raw?.ai===true,interests:typeof raw?.interests==='string'?raw.interests.slice(0,300):''};
}
export const hotPreferences=writable(clean(readLocal('hot',{})));
export function setHotPreferences(value:HotPreferences) {
  const next=clean(value); hotPreferences.set(next); writeLocal('hot',next);
}
export function watchHotPreferences() {
  const changed=(event:StorageEvent)=>{
    if(event.key===null || event.key==='nostreddit.ui.hot') hotPreferences.set(clean(readLocal('hot',{})));
  };
  window.addEventListener('storage',changed);
  return ()=>window.removeEventListener('storage',changed);
}
