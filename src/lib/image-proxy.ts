import { writable } from 'svelte/store';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64urlnopad, hex } from '@scure/base';
import { DEFAULT_IMGPROXY_CONFIG } from '@iris/svelte-ui/imgproxy';
import { hasTreeCapability } from './tree-embeds';

export interface ImageProxySettings {
  enabled:boolean; fallbackToOriginal:boolean; url:string; vidproxyUrl:string; key:string; salt:string;
}
export interface ImageOptions {width?:number; height?:number; square?:boolean; videoThumbnail?:boolean}
const storageKey = 'nostreddit.ui.imageProxy';
export const defaults:ImageProxySettings = {enabled:true, fallbackToOriginal:true, url:'', vidproxyUrl:'', key:'', salt:''};
export const defaultImageServer = DEFAULT_IMGPROXY_CONFIG.url;
export const defaultVideoServer = 'https://vidproxy.iris.to';

function server(value:string) {
  if (!value.trim()) return '';
  const url=new URL(value.trim());
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS proxy URL without credentials, a query, or a fragment.');
  }
  return url.href.replace(/\/+$/,'');
}
function hexSetting(value:string) {
  const clean=value.trim().toLowerCase();
  if (clean && !/^(?:[0-9a-f]{2})+$/.test(clean)) throw new Error('Signing key and salt must use hexadecimal byte pairs.');
  return clean;
}
export function validateProxy(settings:ImageProxySettings):ImageProxySettings {
  return {enabled:settings.enabled, fallbackToOriginal:settings.fallbackToOriginal,
    url:server(settings.url), vidproxyUrl:server(settings.vidproxyUrl), key:hexSetting(settings.key), salt:hexSetting(settings.salt)};
}
function readSettings() {
  try {
    if (typeof window==='undefined') return {...defaults};
    const raw=JSON.parse(localStorage.getItem(storageKey) || '{}');
    return validateProxy({...defaults,...raw,enabled:typeof raw.enabled==='boolean'?raw.enabled:true,
      fallbackToOriginal:typeof raw.fallbackToOriginal==='boolean'?raw.fallbackToOriginal:true});
  } catch {return {...defaults};}
}
const mutable = writable<ImageProxySettings>(readSettings());
export const imageProxySettings = {subscribe:mutable.subscribe};
export function saveImageProxy(settings:ImageProxySettings) {
  const saved=validateProxy(settings);
  try {localStorage.setItem(storageKey,JSON.stringify(saved));} catch { /* Current-tab settings still apply. */ }
  mutable.set(saved);
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage',event => {
    if (event.key === storageKey || event.key === null) mutable.set(readSettings());
  });
}

function privateHost(host:string) {
  const h=host.toLowerCase().replace(/\.$/,'');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || !h.includes('.') ||
    /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h);
}
const signedPaths = new Map<string,string>();
const encoder = new TextEncoder();
function sign(base:string,path:string,settings:ImageProxySettings) {
  const key=settings.key || DEFAULT_IMGPROXY_CONFIG.key, salt=settings.salt || DEFAULT_IMGPROXY_CONFIG.salt;
  const cacheKey=JSON.stringify([base,path,key,salt]);
  const cached=signedPaths.get(cacheKey);
  if (cached) return cached;
  const bytes=encoder.encode(path);
  const saltBytes=hex.decode(salt), input=new Uint8Array(saltBytes.length+bytes.length);
  input.set(saltBytes); input.set(bytes,saltBytes.length);
  const signed=base + '/' + base64urlnopad.encode(hmac(sha256,hex.decode(key),input)) + path;
  if (signedPaths.size >= 1024) signedPaths.delete(signedPaths.keys().next().value!);
  signedPaths.set(cacheKey,signed);
  return signed;
}
export function imageRequest(value:string, options:ImageOptions, settings:ImageProxySettings, origin=globalThis.location?.origin) {
  const empty={src:'', fallback:''};
  const raw=value.trim();
  if (!raw || hasTreeCapability(raw)) return empty;
  if (raw.startsWith('blob:') || /^data:image\//i.test(raw) || /^\/(?!\/)/.test(raw)) {
    return options.videoThumbnail ? empty : {src:raw, fallback:''};
  }
  let url:URL;
  try {url=new URL(raw);} catch {return empty;}
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) return empty;
  // Fragments are never sent to an origin by the browser. Never encode them into a remote proxy request.
  const original=raw.split('#',1)[0];
  const parameters=[...url.searchParams.keys()];
  if (parameters.some(key=>/^(?:key|iv|secret|decrypt|decryption[-_]?key|aes[-_]?key)$/i.test(key))) return empty;
  const privateParams=parameters.some(key=>/^(?:token|access_token|signature|x-amz-signature)$/i.test(key));
  const base=settings.url || defaultImageServer, videoBase=settings.vidproxyUrl || defaultVideoServer;
  const alreadyProxied=[base, videoBase, defaultImageServer, defaultVideoServer].some(root=>original.startsWith(root.replace(/\/$/,'')+'/'));
  if (!settings.enabled || privateParams || privateHost(url.hostname) || url.origin === origin || alreadyProxied) {
    return options.videoThumbnail ? empty : {src:original, fallback:''};
  }
  const encoded=base64urlnopad.encode(encoder.encode(original));
  if (options.videoThumbnail) return {src:sign(videoBase,'/thumb/'+encoded,settings), fallback:''};
  const w=Math.round(options.width || options.height || 0), h=Math.round(options.height || options.width || 0);
  const resize=w>0 && h>0 ? '/rs:'+(options.square?'fill':'fit')+':'+w+':'+h : '';
  return {src:sign(base,resize+'/dpr:2/'+encoded,settings), fallback:settings.fallbackToOriginal ? original : ''};
}
