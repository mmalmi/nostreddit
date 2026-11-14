import { get } from 'svelte/store';
import { imageProxySettings, imageRequest, type ImageOptions } from './image-proxy';
import { cachedPhoto, rememberPhoto } from './photo-cache';

interface LoadOptions extends ImageOptions {
  url:string; reset?:()=>void; offline?:boolean; remember?:boolean; unavailable?:()=>void;
}
export function proxyImage(node:HTMLImageElement, initial:LoadOptions) {
  let options=initial, settings=get(imageProxySettings), version=0, signature='', current='', fallback='', objectUrl='';
  let readingCache=false, visible=node.loading!=='lazy';
  let timer:ReturnType<typeof setTimeout>|undefined;
  function clearTimeoutForLoad() {if (timer!==undefined) clearTimeout(timer); timer=undefined;}
  function timeFallback() {
    clearTimeoutForLoad();
    if (!visible || !fallback || !current || current===fallback || node.complete && node.naturalWidth) return;
    timer=setTimeout(()=>{if (!document.hidden && !(node.complete && node.naturalWidth)) void error();},2000);
  }
  const observer=!visible && typeof IntersectionObserver!=='undefined' ? new IntersectionObserver(entries=>{
    visible=entries.some(entry=>entry.isIntersecting);timeFallback();
  }) : null;
  observer?.observe(node);
  function releaseObject() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl='';
  }
  function show(src:string) {
    current=src;
    if (src) node.src=src; else node.removeAttribute('src');
    timeFallback();
  }
  async function readCache(revision:number) {
    const blob=await cachedPhoto(options.url).catch(()=>undefined);
    if (!blob || revision!==version) return false;
    releaseObject();
    objectUrl=URL.createObjectURL(blob); show(objectUrl);
    return true;
  }
  function refresh() {
    const chosen=imageRequest(options.url,options,settings);
    const next=JSON.stringify([options.url,chosen.src,chosen.fallback,options.offline]);
    if (next===signature) return;
    signature=next;
    const revision=++version;
    releaseObject(); options.reset?.(); fallback=chosen.fallback; readingCache=false; node.hidden=false;
    if (!chosen.src) {show(''); node.hidden=true; options.unavailable?.();return;}
    if (options.offline && navigator.onLine===false) {
      show('');
      void readCache(revision).then(found=>{ if (!found && revision===version) show(chosen.src); });
    } else {show(chosen.src);}
  }
  async function error() {
    clearTimeoutForLoad();
    if (readingCache) return;
    const revision=version;
    if (options.offline && !objectUrl) {
      readingCache=true;
      const found=await readCache(revision);
      if (revision!==version) return;
      readingCache=false;
      if (found) return;
    }
    if (fallback && current!==fallback) {const direct=fallback; fallback='';show(direct);return;}
    node.hidden=true; options.unavailable?.();
  }
  function loaded() {
    clearTimeoutForLoad();
    if (options.remember && current && current!==objectUrl) {
      void rememberPhoto(options.url,current).catch(()=>{});
    }
  }
  node.addEventListener('error',error);
  node.addEventListener('load',loaded);
  const stop=imageProxySettings.subscribe(value=>{settings=value; refresh();});
  return {
    update(next:LoadOptions) {
      const newlyOpened=next.remember && !options.remember;
      const previousVersion=version;
      options=next; refresh();
      if (newlyOpened && version===previousVersion && node.complete && node.naturalWidth) loaded();
    },
    destroy() {
      version++; stop(); observer?.disconnect(); clearTimeoutForLoad(); node.removeEventListener('error',error); node.removeEventListener('load',loaded);
      releaseObject();
    }
  };
}

// <video> does not report errors from its poster request. Load the selected poster once
// through the same fallback policy, then let the player use the loaded resource.
export function proxyPoster(node:HTMLVideoElement, options:LoadOptions) {
  const image=new Image();
  image.referrerPolicy='no-referrer';
  const display=()=>{node.poster=image.currentSrc || image.src;};
  const clear=()=>node.removeAttribute('poster');
  image.addEventListener('load',display);
  const loader=proxyImage(image,{...options,reset:clear,unavailable:clear});
  return {
    update(next:LoadOptions) {loader.update({...next,reset:clear,unavailable:clear});},
    destroy() {loader.destroy();image.removeEventListener('load',display);image.removeAttribute('src');}
  };
}
